import { mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UploadsFolderState } from "@workspace/protocol/uploads-folder";
import { decodeUploadsDir } from "@workspace/protocol";
import { uploadsDirCommand } from "../../src/uploads-command.ts";

function output() {
	const lines: string[] = [];
	return { lines, write: (chunk: string, done: (error?: Error | null) => void) => { lines.push(chunk); done(); return true; } };
}

describe("mars-ram uploads-dir --json", () => {
	it("prints exactly one JSON line with the folder and exits 0", async () => {
		const out = output();
		expect(await uploadsDirCommand(out, async () => ({ ok: true, path: "/tmp/mars-ram-1000/uploads" }))).toBe(0);
		expect(out.lines).toEqual(['{"v":1,"path":"/tmp/mars-ram-1000/uploads"}\n']);
		expect(decodeUploadsDir(out.lines[0]!)).toEqual({ ok: true, path: "/tmp/mars-ram-1000/uploads" });
	});

	it.each([
		[{ ok: false, error: "unsafe_folder", path: "/tmp/mars-ram-1000/uploads", component: "/tmp/mars-ram-1000", reason: "owner", message: "The attachments folder /tmp/mars-ram-1000 belongs to another user. Remove it and try again." }],
		[{ ok: false, error: "unavailable", path: "/tmp/mars-ram-1000/uploads", message: "Could not prepare the attachments folder /tmp/mars-ram-1000/uploads (EACCES)." }],
	] as UploadsFolderState[][])("prints the refusal code and message and exits 1: %#", async (state) => {
		const out = output();
		expect(await uploadsDirCommand(out, async () => state)).toBe(1);
		const { error, message } = state as { error: string; message: string };
		expect(out.lines).toEqual([`${JSON.stringify({ v: 1, error, message })}\n`]);
	});

	it("never reports a missing folder: prepare creates it", async () => {
		const out = output();
		expect(await uploadsDirCommand(out, async () => ({ ok: false, error: "missing", path: "/x" }))).toBe(1);
		expect(JSON.parse(out.lines[0]!)).toMatchObject({ v: 1, error: "unavailable" });
	});

	describe.skipIf(process.platform === "win32")("on the real file system", () => {
		let root = "";
		afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });
		it("creates the private folder, then refuses a linked one", async () => {
			root = realpathSync(mkdtempSync(join(tmpdir(), "uploads-command-")));
			const host = { platform: process.platform, tmpdir: root, uid: process.getuid!() };
			const path = join(root, `mars-ram-${host.uid}`, "uploads");
			const out = output();
			expect(await uploadsDirCommand(out, undefined, host)).toBe(0);
			expect(out.lines).toEqual([`${JSON.stringify({ v: 1, path })}\n`]);
			expect(statSync(path).mode & 0o777).toBe(0o700);
			rmSync(path, { recursive: true });
			mkdirSync(join(root, "elsewhere"), { mode: 0o700 });
			symlinkSync(join(root, "elsewhere"), path);
			const refused = output();
			expect(await uploadsDirCommand(refused, undefined, host)).toBe(1);
			expect(JSON.parse(refused.lines[0]!)).toEqual({ v: 1, error: "unsafe_folder", message: `The attachments folder ${path} is a link. Remove it and try again.` });
		});
	});
});
