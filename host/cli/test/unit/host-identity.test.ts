// `mars-ram pair` reads the SSH server's host key; on Windows a non-elevated window cannot read it.
import { describe, expect, it } from "vitest";
import { readHostIdentity } from "../../src/adapters/host-identity.ts";

const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl root@host";
const WIN_KEY = "C:\\ProgramData\\ssh\\ssh_host_ed25519_key.pub";
const failure = (code: string) => () => { throw Object.assign(new Error(code), { code }); };

describe("readHostIdentity (release 0.1.8 S3)", () => {
	it("on Windows without administrator, an unreadable host key asks for an administrator window (en/es)", () => {
		for (const code of ["EACCES", "EPERM"]) {
			expect(readHostIdentity("win32", { programData: "C:\\ProgramData", read: failure(code), elevated: () => false, spanish: false })).toEqual({
				ok: false,
				message: `Cannot read the SSH server's identity at ${WIN_KEY}: only administrators can read it. Open the terminal as administrator and run mars-ram pair again.`,
			});
		}
		expect(readHostIdentity("win32", { programData: "C:\\ProgramData", read: failure("EACCES"), elevated: () => false, spanish: true })).toEqual({
			ok: false,
			message: `No se pudo leer la identidad del servidor SSH en ${WIN_KEY}: solo la pueden leer los administradores. Abrí la terminal como administrador y ejecutá mars-ram pair otra vez.`,
		});
	});

	it("keeps the previous message for a missing key, an elevated window, Linux, or unknown elevation", () => {
		const old = (path: string) => ({ ok: false, message: `Cannot read the SSH server's identity at ${path}. Is the SSH server installed?` });
		expect(readHostIdentity("win32", { programData: "C:\\ProgramData", read: failure("ENOENT"), elevated: () => false, spanish: false })).toEqual(old(WIN_KEY));
		expect(readHostIdentity("win32", { programData: "C:\\ProgramData", read: failure("EACCES"), elevated: () => true, spanish: false })).toEqual(old(WIN_KEY));
		expect(readHostIdentity("win32", { programData: "C:\\ProgramData", read: failure("EACCES"), elevated: () => { throw Error("no whoami"); }, spanish: false })).toEqual(old(WIN_KEY));
		const never = () => { throw Error("Linux never asks about Windows elevation"); };
		expect(readHostIdentity("linux", { read: failure("EACCES"), elevated: never, spanish: false })).toEqual(old("/etc/ssh/ssh_host_ed25519_key.pub"));
	});

	it("reads the fingerprint when the key is readable", () => {
		const identity = readHostIdentity("win32", { programData: "C:\\ProgramData", read: () => KEY, elevated: () => false, spanish: false });
		expect(identity).toEqual({ ok: true, fingerprint: expect.stringMatching(/^SHA256:/) });
	});
});
