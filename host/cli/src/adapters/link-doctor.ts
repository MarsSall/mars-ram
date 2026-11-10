// Only a fingerprint-current copy may execute the non-mutating status command.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname } from "node:path";
import { isAbsolute, join } from "node:path";
import { lstatSync, readFileSync, readdirSync, accessSync, constants, statSync } from "node:fs";
import { isIpv4 } from "@workspace/protocol/private-network";
import { linkCopyIsCurrent } from "./link-installation.ts";

/** Per network: Tailscale, and each ZeroTier address of this computer. */
export type NetworkSet = { tailscale: boolean; zerotier: string[] };
/** listeners/notifyNetworks: which listeners answer and which networks have «Siempre atento» registrations, when known. */
export type LinkObservation = { present: boolean; current: boolean; configured: boolean; validLinks: number; listener: boolean; notificationsRegistered?: boolean; listeners?: NetworkSet; notifyNetworks?: NetworkSet };
const regular = (path: unknown): path is string => {
 try { return typeof path === "string" && isAbsolute(path) && lstatSync(path).isFile(); } catch { return false; }
};
const read = (path: string): unknown => {
 const stat = lstatSync(path);
 if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw new Error("Invalid diagnostic file.");
 return JSON.parse(readFileSync(path, "utf8"));
};
async function status(node: string, main: string, home: string): Promise<{ serving: boolean; links: number }> {
 const output = await promisify(execFile)(node, [main, "status"], { timeout: 10000, windowsHide: true, shell: false, env: { ...process.env, HOME: home, USERPROFILE: home } });
 const value = JSON.parse(output.stdout);
 if (typeof value.serving !== "boolean" || !Number.isSafeInteger(value.links) || value.links < 0) throw new Error("Invalid link-server status.");
 return value;
}
const networkSet = (value: unknown): value is NetworkSet => !!value && typeof value === "object" && typeof (value as NetworkSet).tailscale === "boolean"
 && Array.isArray((value as NetworkSet).zerotier) && (value as NetworkSet).zerotier.length <= 64 && (value as NetworkSet).zerotier.every(ip => typeof ip === "string" && isIpv4(ip));
async function networks(node: string, main: string, home: string): Promise<{ listeners: NetworkSet; notify: NetworkSet }> {
 const output = await promisify(execFile)(node, [main, "networks"], { timeout: 15000, windowsHide: true, shell: false, env: { ...process.env, HOME: home, USERPROFILE: home } });
 return JSON.parse(output.stdout);
}
export async function observeLinkServer(root: string, options: { now?: number; status?: typeof status; networks?: typeof networks } = {}): Promise<LinkObservation> {
 const copy = join(root, "link-server"), main = join(copy, "src/main.ts"), store = join(root, "links");
 const result: LinkObservation = { present: regular(main), current: linkCopyIsCurrent(copy), configured: false, validLinks: 0, listener: false };
 // Presence is diagnostic only, never authorization to read secrets or deliver a notice.
 try {
  const notify = join(root, 'notify'); const info = lstatSync(notify);
  if (info.isDirectory() && !info.isSymbolicLink() && readdirSync(notify).some(n => /^[a-f0-9]{64}\.json$/.test(n))) result.notificationsRegistered = true;
 } catch { /* No registration directory. */ }
 try {
  const value = read(join(root, "host.json")) as Record<string, unknown>;
  // node may be a stable symlink (e.g. a Nix profile's bin/node); follow it. The installed copy must be a plain file.
  const executable = (path: unknown) => { try { return typeof path === "string" && isAbsolute(path) && statSync(path).isFile(); } catch { return false; } };
  result.configured = executable(value.node) && value.linkServer === main && regular(value.linkServer) && value.linkPort === 47811;
  if (result.configured) accessSync(value.node as string, process.platform === "win32" ? constants.F_OK : constants.X_OK);
 } catch { result.configured = false; }
 if (result.configured && result.current) {
  const value = read(join(root, "host.json")) as Record<string, unknown>;
  const observed = await (options.status ?? status)(value.node as string, main, dirname(root));
  const found: LinkObservation = { ...result, validLinks: observed.links, listener: observed.serving };
  if (!result.notificationsRegistered) return found;
  // Unknown (and the overall check used) when the copy cannot tell or answers anything unexpected.
  try {
   const facts: unknown = await (options.networks ?? networks)(value.node as string, main, dirname(root));
   if (facts && typeof facts === "object" && networkSet((facts as { listeners?: unknown }).listeners) && networkSet((facts as { notify?: unknown }).notify)) {
    const { listeners, notify } = facts as { listeners: NetworkSet; notify: NetworkSet };
    return { ...found, listeners: { tailscale: listeners.tailscale, zerotier: [...listeners.zerotier] }, notifyNetworks: { tailscale: notify.tailscale, zerotier: [...notify.zerotier] } };
   }
  } catch { /* See above. */ }
  return found;
 }
 let names: string[];
 try {
  const stat = lstatSync(store);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid link storage directory.");
  names = readdirSync(store);
 } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return result; throw error; }
 for (const id of names.filter(name => /^[A-Za-z0-9_-]{12}$/.test(name))) {
  const folder = join(store, id);
  if (!lstatSync(folder).isDirectory() || lstatSync(folder).isSymbolicLink()) throw new Error("Invalid link directory.");
  const value = read(join(folder, "link.json")) as Record<string, unknown>;
  if (value.id !== id || typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))) throw new Error("Invalid link metadata.");
  if (Date.parse(value.expiresAt) > (options.now ?? Date.now())) result.validLinks++;
 }
 return result;
}
