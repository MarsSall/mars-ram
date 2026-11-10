import { describe, expect, it, vi } from "vitest";
import { HostUploadsFolder, UPDATE_REQUIRED_MESSAGE, parseUploadsFolder, supportsTempUploads } from "../src/core/uploads-folder";
import type { HostConnection } from "../src/core/ports";
import { failure } from "./fakes";

const record = JSON.stringify({ node: "/usr/bin/node", cli: "/opt/mars-ram/main.ts" });
type Exec = Awaited<ReturnType<HostConnection["exec"]>>;
const ran = (stdout: string, exitStatus: number | null = 0): Exec => ({ ok: true, stdout, stderr: "", exitStatus });
function host(result: Exec | (() => Promise<Exec>), hostJson: string | null = record) {
	const exec = vi.fn(async (_id: string, _command: string) => typeof result === "function" ? result() : result);
	const readFile = vi.fn(async () => hostJson === null ? failure("NOT_FOUND") : { ok: true as const, content: hostJson });
	return { exec, readFile, port: { exec, readFile } as unknown as HostConnection };
}
const updateRequired = { ok: false, code: "UPDATE_REQUIRED", message: UPDATE_REQUIRED_MESSAGE };

describe("uploads folder output", () => {
	it("accepts an absolute POSIX folder as both terminal and SFTP path", () => {
		expect(parseUploadsFolder(ran('{"v":1,"path":"/tmp/mars-ram-1000/uploads"}\n'))).toEqual({ ok: true, folder: { path: "/tmp/mars-ram-1000/uploads", sftpPath: "/tmp/mars-ram-1000/uploads", windows: false } });
		expect(parseUploadsFolder(ran('{"v":1,"path":"/var/folders/x y/T/mars-ram-501/uploads"}'))).toMatchObject({ ok: true, folder: { windows: false } });
	});
	it.each(["C:\\Users\\dev\\AppData\\Local\\Temp\\mars-ram\\uploads", "C:\\Users/dev\\AppData/Local\\Temp\\mars-ram\\uploads", "/C:/Users/dev/AppData/Local/Temp/mars-ram/uploads"])("maps the Windows folder %s to its native and SFTP forms", path => {
		expect(parseUploadsFolder(ran(JSON.stringify({ v: 1, path })))).toEqual({ ok: true, folder: {
			path: "C:\\Users\\dev\\AppData\\Local\\Temp\\mars-ram\\uploads", sftpPath: "/C:/Users/dev/AppData/Local/Temp/mars-ram/uploads", windows: true } });
	});
	it.each([
		"tmp/mars-ram-1000/uploads", "", "/", "/tmp/../etc", "/tmp/./x", "/tmp//x", "/tmp/x/", "/tmp/x\n", "/tmp/x\u0000y", "/tmp/a\\b", "/tmp/a:b/x",
		"C:\\", "C:\\Temp\\..\\x", "C:\\Temp\\\\x", "C:\\Temp\\a\"b", "C:\\Temp\\a:b", "\\\\server\\share\\uploads", "C:relative", "C:/Users/dev/uploads", `/${"a".repeat(1100)}`,
	])("refuses the unsafe or malformed path %j", path => {
		expect(parseUploadsFolder(ran(JSON.stringify({ v: 1, path })))).toEqual(updateRequired);
	});
	it.each([
		"not json", "", "[]", "null", '{"v":2,"path":"/tmp/x"}', '{"v":1}', '{"v":1,"path":3}', '{"v":1,"path":"/tmp/x"}\n{"v":1,"path":"/tmp/y"}', `{"v":1,"path":"/tmp/x"}${" ".repeat(5000)}`,
	])("treats invalid output %j as an old host", stdout => {
		expect(parseUploadsFolder(ran(stdout))).toEqual(updateRequired);
	});
	it.each([[1, "Unknown command: uploads-dir\nUsage: mars-ram <command>"], [2, ""], [127, "sh: mars-ram: not found"], [null, '{"v":1,"path":"/tmp/x"}']] as const)("treats exit %s from an older CLI as update required", (exit, stdout) => {
		expect(parseUploadsFolder(ran(stdout, exit))).toEqual(updateRequired);
	});
	it("shows the host's message for an unsafe folder, without control characters", () => {
		expect(parseUploadsFolder(ran('{"v":1,"error":"unsafe_folder","message":"/tmp/mars-ram-1000 is owned by another user.\\u001b[2J"}', 1)))
			.toEqual({ ok: false, code: "PERMISSION_DENIED", message: "Uploads folder refused: /tmp/mars-ram-1000 is owned by another user.[2J" });
		expect(parseUploadsFolder(ran('{"v":1,"error":"unavailable","message":"No temporary folder."}', 1)))
			.toEqual({ ok: false, code: "SSH_ERROR", message: "Uploads folder unavailable: No temporary folder." });
	});
	it.each(['{"v":1,"error":"unsafe_folder"}', '{"v":1,"error":"unsafe_folder","message":""}', '{"v":1,"error":"other","message":"x"}', '{"v":2,"error":"unsafe_folder","message":"x"}'])("keeps a malformed refusal %j as update required", stdout => {
		expect(parseUploadsFolder(ran(stdout, 1))).toEqual(updateRequired);
	});
	it("accepts a refusal only with exit 1", () => {
		expect(parseUploadsFolder(ran('{"v":1,"error":"unsafe_folder","message":"x"}', 0))).toEqual(updateRequired);
	});
});

describe("uploads folder lookup", () => {
	it("runs the installed CLI once per connection and caches the folder", async () => {
		const h = host(ran('{"v":1,"path":"/tmp/mars-ram-1000/uploads"}'));
		const lookup = new HostUploadsFolder(h.port);
		const [a, b] = await Promise.all([lookup.folder("conn-1"), lookup.folder("conn-1")]);
		expect(a).toEqual(b);
		expect(await lookup.folder("conn-1")).toMatchObject({ ok: true });
		expect(h.exec).toHaveBeenCalledTimes(1);
		expect(h.exec).toHaveBeenCalledWith("conn-1", "'/usr/bin/node' '/opt/mars-ram/main.ts' uploads-dir --json");
		await lookup.folder("conn-2");
		expect(h.exec).toHaveBeenCalledTimes(2);
	});
	it("does not cache failures, so a later attempt can succeed", async () => {
		const results = [failure("NOT_CONNECTED"), ran("usage", 1), ran('{"v":1,"path":"/tmp/x"}')];
		const h = host(async () => results.shift()!);
		const lookup = new HostUploadsFolder(h.port);
		// A transport failure is not evidence of an old CLI.
		expect(await lookup.folder("c")).toEqual(failure("NOT_CONNECTED"));
		expect(await lookup.folder("c")).toEqual(updateRequired);
		expect(await lookup.folder("c")).toMatchObject({ ok: true, folder: { path: "/tmp/x" } });
	});
	it.each([null, "{}", '{"node":"node; id","cli":"/x/main.ts"}'])("needs a valid installer record %j", async hostJson => {
		const h = host(ran('{"v":1,"path":"/tmp/x"}'), hostJson);
		expect(await new HostUploadsFolder(h.port).folder("c")).toEqual(updateRequired);
		expect(h.exec).not.toHaveBeenCalled();
	});
	it("turns a thrown exec into a failure", async () => {
		const h = host(async () => { throw new Error("lost"); });
		expect(await new HostUploadsFolder(h.port).folder("c")).toMatchObject({ ok: false, code: "SSH_ERROR" });
	});
});

describe("bridge support for temp uploads", () => {
	it.each([["1.7", true], ["1.12", true], ["1.6", false], ["1.2", false], ["2.7", false], ["x", false]] as const)("%s → %s", (version, ok) => {
		expect(supportsTempUploads(version)).toBe(ok);
	});
});
