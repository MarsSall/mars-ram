// Dependency-free installed package: fingerprints cover exactly src/ and package.json.
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const linkSource = resolve(import.meta.dirname, "../../../link-server");
export function linkFingerprint(folder: string): string {
 const hash = createHash("sha256");
 const visit = (relative: string) => {
  const path = join(folder, relative);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error("Linked link-server source or installed file.");
  if (stat.isDirectory()) for (const name of readdirSync(path).sort()) visit(`${relative}/${name}`);
  else if (stat.isFile()) { hash.update(relative); hash.update("\0"); hash.update(readFileSync(path)); hash.update("\0"); }
  else throw new Error("Invalid link-server file.");
 };
 visit("package.json"); visit("src");
 return hash.digest("hex");
}
export function linkCopyIsCurrent(copy: string): boolean {
 try { return linkFingerprint(copy) === linkFingerprint(linkSource); } catch { return false; }
}
export function buildLinkCopy(root: string): void {
 const copy = join(root, "link-server"), staging = `${copy}.staging`, backup = `${copy}.previous`;
 // Validate before touching the usable installed copy.
 const fingerprint = linkFingerprint(linkSource);
 mkdirSync(staging);
 let moved = false;
 try {
  for (const name of ["src", "package.json"]) cpSync(join(linkSource, name), join(staging, name), { recursive: true });
  if (linkFingerprint(staging) !== fingerprint) throw new Error("Link-server source changed during installation.");
  // Fingerprint is part of the swap, never an independently published version marker.
  writeFileSync(join(staging, "fingerprint.sha256"), `${fingerprint}\n`, { mode: 0o600 });
  if (existsSync(copy)) { rmSync(backup, { recursive: true, force: true }); renameSync(copy, backup); moved = true; }
  try { renameSync(staging, copy); } catch (error) { if (moved) renameSync(backup, copy); throw error; }
  if (moved) rmSync(backup, { recursive: true, force: true });
 } finally { rmSync(staging, { recursive: true, force: true }); }
}
