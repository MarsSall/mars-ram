import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkUploadsFolder, currentHost, prepareUploadsFolder, uploadsFolderPath, type FolderEntry, type UploadsFolderFs, type UploadsFolderHost } from "../src/uploads-folder.ts";

const linux: UploadsFolderHost = { platform: "linux", tmpdir: "/tmp", uid: 1000 };
const windows: UploadsFolderHost = { platform: "win32", tmpdir: "C:\\Users\\alex\\AppData\\Local\\Temp" };
const parent = "/tmp/mars-ram-1000";
const folder = "/tmp/mars-ram-1000/uploads";

/** Folders by path; the port has no chmod or chown, so the policy cannot repair a component. */
class FakeFolders implements UploadsFolderFs {
	readonly entries = new Map<string, FolderEntry>();
	readonly created: [string, number][] = [];
	failure: { path: string; code: string } | undefined;
	add(path: string, entry: Partial<{ directory: boolean; link: boolean; uid: number; mode: number }> = {}): void {
		const { directory = true, link = false, uid = 1000, mode = 0o700 } = entry;
		this.entries.set(path, { isDirectory: () => directory && !link, isSymbolicLink: () => link, uid, mode: (directory ? 0o040000 : 0o100000) | mode });
	}
	async lstat(path: string): Promise<FolderEntry | undefined> {
		if (this.failure?.path === path) throw Object.assign(new Error("denied"), { code: this.failure.code });
		return this.entries.get(path);
	}
	async mkdir(path: string, mode: number): Promise<void> {
		if (this.entries.has(path)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
		this.created.push([path, mode]);
		this.add(path, { mode: mode & 0o755 });
	}
}

describe("uploads folder path", () => {
	it("is a per-user folder under the system temp directory", () => {
		expect(uploadsFolderPath(linux)).toBe(folder);
		expect(uploadsFolderPath({ platform: "darwin", tmpdir: "/var/folders/xy/T", uid: 501 })).toBe("/var/folders/xy/T/mars-ram-501/uploads");
		expect(uploadsFolderPath(windows)).toBe("C:\\Users\\alex\\AppData\\Local\\Temp\\mars-ram\\uploads");
	});

	// The CLI runs in the SSH session and the bridge inside Pi: TMPDIR can differ between them
	// (macOS sets a per-user one), so POSIX always uses /tmp and both name the same folder.
	it.skipIf(process.platform === "win32")("uses /tmp on POSIX whatever TMPDIR says", () => {
		const saved = process.env.TMPDIR;
		process.env.TMPDIR = "/var/folders/xy/T";
		try { expect(currentHost().tmpdir).toBe("/tmp"); } finally { if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved; }
	});
});

describe("prepare uploads folder (POSIX)", () => {
	it("creates both missing components with mode 0700 and returns the absolute path", async () => {
		const fs = new FakeFolders();
		expect(await prepareUploadsFolder(linux, fs)).toEqual({ ok: true, path: folder });
		expect(fs.created).toEqual([[parent, 0o700], [folder, 0o700]]);
	});

	it("accepts existing private components without creating anything", async () => {
		const fs = new FakeFolders();
		fs.add(parent);
		fs.add(folder);
		expect(await prepareUploadsFolder(linux, fs)).toEqual({ ok: true, path: folder });
		expect(fs.created).toEqual([]);
	});

	it.each([
		["a link", { link: true }, "link", "is a link"],
		["a file", { directory: false, mode: 0o600 }, "not_folder", "is not a folder"],
		["owned by someone else", { uid: 0 }, "owner", "belongs to another user"],
		["group-writable", { mode: 0o770 }, "permissions", "can be opened by other users"],
		["world-readable", { mode: 0o705 }, "permissions", "can be opened by other users"],
	] as const)("refuses a parent that is %s, never creating inside it", async (_label, entry, reason, text) => {
		const fs = new FakeFolders();
		fs.add(parent, entry);
		const state = await prepareUploadsFolder(linux, fs);
		expect(state).toEqual({ ok: false, error: "unsafe_folder", path: folder, component: parent, reason, message: `The attachments folder ${parent} ${text}. Remove it and try again.` });
		expect(fs.created).toEqual([]);
	});

	it.each([
		["a link", { link: true }, "link"],
		["a file", { directory: false, mode: 0o600 }, "not_folder"],
		["owned by someone else", { uid: 1001 }, "owner"],
		["group-writable", { mode: 0o720 }, "permissions"],
	] as const)("refuses an uploads folder that is %s", async (_label, entry, reason) => {
		const fs = new FakeFolders();
		fs.add(parent);
		fs.add(folder, entry);
		expect(await prepareUploadsFolder(linux, fs)).toMatchObject({ ok: false, error: "unsafe_folder", component: folder, reason });
	});

	it("re-checks a component someone else created first instead of trusting mkdir", async () => {
		const fs = new FakeFolders();
		fs.mkdir = async (path) => { fs.add(path, { uid: 0, mode: 0o777 }); throw Object.assign(new Error("exists"), { code: "EEXIST" }); };
		expect(await prepareUploadsFolder(linux, fs)).toMatchObject({ ok: false, error: "unsafe_folder", component: parent, reason: "owner" });
	});

	it("reports an unreadable component as unavailable", async () => {
		const fs = new FakeFolders();
		fs.failure = { path: parent, code: "EACCES" };
		expect(await prepareUploadsFolder(linux, fs)).toEqual({ ok: false, error: "unavailable", path: folder, message: `Could not prepare the attachments folder ${folder} (EACCES).` });
	});

	it("is unavailable without a user id or with a relative temp directory", async () => {
		expect(await prepareUploadsFolder({ platform: "linux", tmpdir: "/tmp" }, new FakeFolders())).toMatchObject({ ok: false, error: "unavailable" });
		expect(await prepareUploadsFolder({ platform: "linux", tmpdir: "tmp", uid: 1000 }, new FakeFolders())).toMatchObject({ ok: false, error: "unavailable" });
	});
});

describe("check uploads folder", () => {
	it("never creates: a missing component is reported as missing", async () => {
		const fs = new FakeFolders();
		expect(await checkUploadsFolder(linux, fs)).toEqual({ ok: false, error: "missing", path: folder });
		fs.add(parent);
		expect(await checkUploadsFolder(linux, fs)).toEqual({ ok: false, error: "missing", path: folder });
		expect(fs.created).toEqual([]);
	});

	it("applies the same rules as prepare", async () => {
		const fs = new FakeFolders();
		fs.add(parent);
		fs.add(folder);
		expect(await checkUploadsFolder(linux, fs)).toEqual({ ok: true, path: folder });
		fs.add(folder, { mode: 0o755 });
		expect(await checkUploadsFolder(linux, fs)).toMatchObject({ ok: false, error: "unsafe_folder", reason: "permissions" });
	});
});

describe("prepare uploads folder (Windows)", () => {
	const base = "C:\\Users\\alex\\AppData\\Local\\Temp\\mars-ram";
	it("creates the folders and relies on the user temp ACL instead of POSIX modes and owners", async () => {
		const fs = new FakeFolders();
		expect(await prepareUploadsFolder(windows, fs)).toEqual({ ok: true, path: `${base}\\uploads` });
		expect(fs.created.map(([path]) => path)).toEqual([base, `${base}\\uploads`]);
		fs.add(base, { uid: 0, mode: 0o777 });
		expect(await prepareUploadsFolder(windows, fs)).toMatchObject({ ok: true });
	});

	it("refuses a reparse point (junction or symbolic link) and a file", async () => {
		const fs = new FakeFolders();
		fs.add(base, { link: true });
		expect(await prepareUploadsFolder(windows, fs)).toMatchObject({ ok: false, error: "unsafe_folder", component: base, reason: "link" });
		fs.add(base);
		fs.add(`${base}\\uploads`, { directory: false });
		expect(await prepareUploadsFolder(windows, fs)).toMatchObject({ ok: false, error: "unsafe_folder", reason: "not_folder" });
	});
});

describe.skipIf(process.platform === "win32")("prepare uploads folder on the real file system", () => {
	let root = "";
	afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });
	const host = () => ({ platform: process.platform, tmpdir: root, uid: process.getuid!() });

	it("creates private folders, then refuses a widened or linked one without changing it", async () => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "uploads-folder-")));
		const path = join(root, `mars-ram-${process.getuid!()}`, "uploads");
		expect(await prepareUploadsFolder(host())).toEqual({ ok: true, path });
		for (const component of [join(root, `mars-ram-${process.getuid!()}`), path]) expect(statSync(component).mode & 0o777).toBe(0o700);
		expect(await checkUploadsFolder(host())).toEqual({ ok: true, path });

		chmodSync(path, 0o770);
		expect(await prepareUploadsFolder(host())).toMatchObject({ ok: false, error: "unsafe_folder", component: path, reason: "permissions" });
		expect(statSync(path).mode & 0o777).toBe(0o770);

		rmSync(path, { recursive: true });
		mkdirSync(join(root, "elsewhere"), { mode: 0o700 });
		symlinkSync(join(root, "elsewhere"), path);
		expect(await prepareUploadsFolder(host())).toMatchObject({ ok: false, error: "unsafe_folder", component: path, reason: "link" });

		rmSync(path);
		writeFileSync(path, "x", { mode: 0o600 });
		expect(await prepareUploadsFolder(host())).toMatchObject({ ok: false, error: "unsafe_folder", reason: "not_folder" });
	});
});
