// Only a fingerprint-current copy may execute the non-mutating status command.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname } from "node:path";
import { isAbsolute, join } from "node:path";
import { lstatSync, readFileSync, readdirSync, accessSync, constants, statSync } from "node:fs";
import { linkCopyIsCurrent } from "./link-installation.ts";

export type LinkObservation = { present: boolean; current: boolean; configured: boolean; validLinks: number; listener: boolean };
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
export async function observeLinkServer(root: string, options: { now?: number; status?: typeof status } = {}): Promise<LinkObservation> {
 const copy = join(root, "link-server"), main = join(copy, "src/main.ts"), store = join(root, "links");
 const result: LinkObservation = { present: regular(main), current: linkCopyIsCurrent(copy), configured: false, validLinks: 0, listener: false };
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
  return { ...result, validLinks: observed.links, listener: observed.serving };
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
