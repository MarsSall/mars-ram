// The SSH identity the phone must see when it connects, read from the SSH server's own key.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, win32 } from "node:path";
import { readWindowsPrivileges } from "./authorized-keys.ts";
import { spanish } from "./terminal.ts";

/** OpenSSH-style SHA256 fingerprint of a public key line, like ssh-keygen -l. */
export function fingerprintOfPublicKey(line: string): string {
	const blob = line.trim().split(/\s+/)[1] ?? "";
	return `SHA256:${createHash("sha256").update(Buffer.from(blob, "base64")).digest("base64").replace(/=+$/, "")}`;
}

/** Ed25519 is the host key the app's SSH library prefers, on Linux and Windows alike. */
export function hostKeyPath(platform: NodeJS.Platform, programData = process.env.ProgramData): string {
	return platform === "win32" ? win32.join(programData ?? "C:\\ProgramData", "ssh", "ssh_host_ed25519_key.pub") : join("/etc/ssh", "ssh_host_ed25519_key.pub");
}

export type HostIdentityIO = {
	programData?: string | undefined;
	read(path: string): string;
	/** Windows: whether this window has administrator rights; asked only after the key could not be read. */
	elevated(): boolean;
	spanish: boolean;
};

const defaultIO = (): HostIdentityIO => ({ programData: process.env.ProgramData, read: (path) => readFileSync(path, "utf8"), elevated: () => readWindowsPrivileges().elevated, spanish });

export function readHostIdentity(platform: NodeJS.Platform = process.platform, io: HostIdentityIO = defaultIO()): { ok: true; fingerprint: string } | { ok: false; message: string } {
	const path = hostKeyPath(platform, io.programData);
	try {
		return { ok: true, fingerprint: fingerprintOfPublicKey(io.read(path)) };
	} catch (error) {
		// Windows keeps the host key readable only by administrators; a missing key still means no SSH server.
		if (platform === "win32" && (error as NodeJS.ErrnoException).code !== "ENOENT" && notElevated(io)) {
			return {
				ok: false,
				message: io.spanish
					? `No se pudo leer la identidad del servidor SSH en ${path}: solo la pueden leer los administradores. Abrí la terminal como administrador y ejecutá mars-ram pair otra vez.`
					: `Cannot read the SSH server's identity at ${path}: only administrators can read it. Open the terminal as administrator and run mars-ram pair again.`,
			};
		}
		return { ok: false, message: `Cannot read the SSH server's identity at ${path}. Is the SSH server installed?` };
	}
}

function notElevated(io: HostIdentityIO): boolean {
	try { return !io.elevated(); } catch { return false; }
}
