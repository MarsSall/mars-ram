// Adds the phone's key to the file the SSH server reads for the pairing user.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, win32 } from "node:path";
import { APP_ID } from "@workspace/protocol";
import { rewriteKeyFile, type RewriteOptions } from './authorized-key-file.ts';
import { keyOf } from './authorized-key-parser.ts';
export { keyRunner, restrictToSystemAndAdministrators, type KeyRunner } from './authorized-key-file.ts';
export { keyOf, keyParts } from './authorized-key-parser.ts';

export type KeyTarget = { path: string; kind: "user" | "windows-administrators" };

/** Tunnels for the bridge and a terminal for the fallback; no agent or X11 forwarding. */
const KEY_OPTIONS = "restrict,port-forwarding,pty";

export function buildKeyLine(publicKey: string, deviceName: string, date: Date): string {
 const [type, blob] = publicKey.trim().split(/\s+/);
 return `${KEY_OPTIONS} ${type} ${blob} ${APP_ID}:${deviceName}:${date.toISOString().slice(0, 10)}`;
}

/** Windows OpenSSH reads a shared file for members of the Administrators group. */
export function keyTarget(platform: NodeJS.Platform, env: { home: string; programData: string | undefined; administrator: boolean }): KeyTarget {
 if (platform === "win32" && env.administrator) {
  return { path: win32.join(env.programData ?? "C:\\ProgramData", "ssh", "administrators_authorized_keys"), kind: "windows-administrators" };
 }
 return { path: (platform === "win32" ? win32.join : join)(env.home, ".ssh", "authorized_keys"), kind: "user" };
}

/** Membership and elevation use SIDs because whoami group names/attributes are localized. */
export function parseWindowsPrivileges(csv: string): { administrator: boolean; elevated: boolean } {
 const sids = new Set([...csv.matchAll(/"(S-1-[0-9-]+)"/g)].map((m) => m[1]));
 return { administrator: sids.has("S-1-5-32-544"), elevated: sids.has("S-1-16-12288") || sids.has("S-1-16-16384") };
}

export function readWindowsPrivileges(): { administrator: boolean; elevated: boolean } {
 return parseWindowsPrivileges(execFileSync("whoami", ["/groups", "/fo", "csv"], { encoding: "utf8", windowsHide: true }));
}

export function authorizeKey(target: KeyTarget, line: string, options: RewriteOptions = {}): { ok: true } | { ok: false; message: string } {
 try {
  const key = keyOf(line);
  if (!key) throw Error('Invalid public key.');
  mkdirSync(dirname(target.path), { recursive: true, mode: 0o700 });
  return rewriteKeyFile(target, '.bak-before-pairing', true, bytes => {
   // Preserve even non-UTF8 comments; only the new (UTF8) line is encoded afresh.
   const current = bytes.toString('latin1');
   if (current.split(/\r?\n/).some(existing => keyOf(existing) === key)) return { result: { ok: true as const } };
   return { bytes: Buffer.concat([bytes, Buffer.from(`${current === '' || current.endsWith('\n') ? '' : '\n'}${line}\n`)]), result: { ok: true as const } };
  }, options);
 } catch (error) { return { ok: false, message: (error as Error).message }; }
}
