// The SSH identity the phone must see when it connects, read from the SSH server's own key.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** OpenSSH-style SHA256 fingerprint of a public key line, like ssh-keygen -l. */
export function fingerprintOfPublicKey(line: string): string {
	const blob = line.trim().split(/\s+/)[1] ?? "";
	return `SHA256:${createHash("sha256").update(Buffer.from(blob, "base64")).digest("base64").replace(/=+$/, "")}`;
}

/** Ed25519 is the host key the app's SSH library prefers, on Linux and Windows alike. */
export function hostKeyPath(platform: NodeJS.Platform, programData = process.env.ProgramData): string {
	return platform === "win32" ? join(programData ?? "C:\\ProgramData", "ssh", "ssh_host_ed25519_key.pub") : "/etc/ssh/ssh_host_ed25519_key.pub";
}

export function readHostIdentity(platform: NodeJS.Platform = process.platform): { ok: true; fingerprint: string } | { ok: false; message: string } {
	const path = hostKeyPath(platform);
	try {
		return { ok: true, fingerprint: fingerprintOfPublicKey(readFileSync(path, "utf8")) };
	} catch {
		return { ok: false, message: `Cannot read the SSH server's identity at ${path}. Is the SSH server installed?` };
	}
}
