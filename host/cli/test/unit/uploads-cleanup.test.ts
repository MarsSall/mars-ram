import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareUploadsFolder } from "@workspace/protocol/uploads-folder";
import { removeLegacyUploads, removeUploadsFolder } from "../../src/adapters/uploads-cleanup.ts";

let root: string;
let home: string;
let legacy: string;
const folder = "/tmp/mars-ram-1000/uploads";

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "uploads-cleanup-")));
	home = join(root, "home");
	legacy = join(home, ".mars-ram", "uploads");
	mkdirSync(join(home, ".mars-ram"), { recursive: true });
	writeFileSync(join(root, "outside.txt"), "keep");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe.skipIf(process.platform === "win32")("install removes the legacy attachments folder", () => {
	it("removes regular files, unfinished .part files and hard-linked names, then the empty folder, and says so", () => {
		mkdirSync(legacy);
		writeFileSync(join(legacy, "shot.png"), "x");
		writeFileSync(join(legacy, "half.png.part"), "x");
		linkSync(join(root, "outside.txt"), join(legacy, "hard.txt"));
		expect(removeLegacyUploads(home, false, folder)).toBe(`Removed old attachments folder ~/.mars-ram/uploads (attachments now live in ${folder}).`);
		expect(existsSync(legacy)).toBe(false);
		expect(readFileSync(join(root, "outside.txt"), "utf8")).toBe("keep");
		expect(existsSync(join(home, ".mars-ram"))).toBe(true);
	});

	it("says so in Spanish", () => {
		mkdirSync(legacy);
		expect(removeLegacyUploads(home, true, folder)).toBe(`Se eliminó la carpeta anterior de adjuntos ~/.mars-ram/uploads (ahora los adjuntos están en ${folder}).`);
	});

	it("removes only the link when the folder is a link, never what it points to", () => {
		mkdirSync(join(root, "target"));
		writeFileSync(join(root, "target", "keep.png"), "x");
		symlinkSync(join(root, "target"), legacy);
		expect(removeLegacyUploads(home, false, folder)).toMatch(/^Removed old attachments folder/);
		expect(existsSync(legacy)).toBe(false);
		expect(readFileSync(join(root, "target", "keep.png"), "utf8")).toBe("x");
	});

	it("never recurses into folders or follows links inside, keeping the folder and saying why", () => {
		mkdirSync(join(legacy, "sub"), { recursive: true });
		writeFileSync(join(legacy, "sub", "deep.png"), "x");
		writeFileSync(join(legacy, "shot.png"), "x");
		symlinkSync(join(root, "outside.txt"), join(legacy, "link.txt"));
		expect(removeLegacyUploads(home, false, folder)).toBe(`Kept ~/.mars-ram/uploads: it holds folders or links that mars-ram does not remove; delete it yourself (attachments now live in ${folder}).`);
		expect(existsSync(join(legacy, "shot.png"))).toBe(false);
		expect(readFileSync(join(legacy, "sub", "deep.png"), "utf8")).toBe("x");
		expect(lstatSync(join(legacy, "link.txt")).isSymbolicLink()).toBe(true);
		expect(readFileSync(join(root, "outside.txt"), "utf8")).toBe("keep");
	});

	it("prints nothing when there is no legacy folder", () => {
		expect(removeLegacyUploads(home, false, folder)).toBeUndefined();
	});

	it("keeps a file named uploads", () => {
		writeFileSync(legacy, "not ours");
		expect(removeLegacyUploads(home, false, folder)).toMatch(/^Kept ~\/\.mars-ram\/uploads/);
		expect(readFileSync(legacy, "utf8")).toBe("not ours");
	});

	it("touches nothing behind a linked ~/.mars-ram", () => {
		rmSync(join(home, ".mars-ram"), { recursive: true });
		mkdirSync(join(root, "elsewhere", "uploads"), { recursive: true });
		writeFileSync(join(root, "elsewhere", "uploads", "keep.png"), "x");
		symlinkSync(join(root, "elsewhere"), join(home, ".mars-ram"));
		expect(removeLegacyUploads(home, false, folder)).toBeUndefined();
		expect(readFileSync(join(root, "elsewhere", "uploads", "keep.png"), "utf8")).toBe("x");
	});
});

describe.skipIf(process.platform === "win32")("uninstall removes the private temp attachments folder", () => {
	const host = () => ({ platform: process.platform, tmpdir: join(root, "tmp"), uid: process.getuid!() });
	beforeEach(() => mkdirSync(join(root, "tmp")));

	it("removes the attachment files and both folders, and says so", async () => {
		const prepared = await prepareUploadsFolder(host());
		if (!prepared.ok) throw new Error(prepared.error);
		writeFileSync(join(prepared.path, "shot.png"), "x");
		expect(await removeUploadsFolder(false, host())).toBe(`Removed attachments folder ${prepared.path}.`);
		expect(await removeUploadsFolder(true, host())).toBeUndefined();
		expect(existsSync(join(root, "tmp", `mars-ram-${process.getuid!()}`))).toBe(false);
	});

	it("leaves a folder that fails the policy untouched and explains it", async () => {
		const prepared = await prepareUploadsFolder(host());
		if (!prepared.ok) throw new Error(prepared.error);
		writeFileSync(join(prepared.path, "shot.png"), "x");
		const parent = join(root, "tmp", `mars-ram-${process.getuid!()}`);
		chmodSync(parent, 0o755);
		expect(await removeUploadsFolder(false, host())).toBe(`Kept attachments folder ${prepared.path}: The attachments folder ${parent} can be opened by other users. Remove it and try again.`);
		expect(existsSync(join(prepared.path, "shot.png"))).toBe(true);
		expect(await removeUploadsFolder(true, host())).toMatch(/^Se conservó la carpeta de adjuntos /);
	});
});
