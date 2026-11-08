// Dependency-free installed package: fingerprints cover exactly src/ and package.json.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const linkSource = resolve(import.meta.dirname, "../../../link-server");
// Materialize the two dependency-free canonical wire modules inside the installed copy.
// This keeps standalone Node execution independent of the checkout and node_modules.
export function linkRuntimeFiles(folder: string): Map<string, string> {
 const files = new Map<string, string>();
 const visit = (relative: string) => {
  const path = join(folder, relative);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error("Linked link-server source or installed file.");
  if (stat.isDirectory()) for (const name of readdirSync(path).sort()) visit(`${relative}/${name}`);
  else if (stat.isFile()) files.set(relative, readFileSync(path, 'utf8'));
  else throw new Error("Invalid link-server file.");
 };
 visit("package.json"); visit("src");
 if (resolve(folder) === linkSource && !existsSync(join(folder, 'src/wire/session-notice.ts'))) {
  for (const module of ['session-notice', 'notice-bridge']) {
   const wire = resolve(linkSource, '../../packages/protocol/src', `${module}.ts`);
   if (!lstatSync(wire).isFile() || lstatSync(wire).isSymbolicLink()) throw Error('Linked notice contract.');
   files.set(`src/wire/${module}.ts`, readFileSync(wire, 'utf8'));
  }
  for (const [path, source] of files) if (path.startsWith('src/adapters/') || path.startsWith('src/core/')) files.set(path, source.replaceAll('../../../../packages/protocol/src/', '../wire/'));
 }
 return files;
}
export function linkFingerprint(folder: string): string {
 const hash = createHash('sha256');
 for (const [path, data] of [...linkRuntimeFiles(folder)].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) { hash.update(path); hash.update('\0'); hash.update(data); hash.update('\0'); }
 return hash.digest('hex');
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
  for (const [path, data] of linkRuntimeFiles(linkSource)) { mkdirSync(dirname(join(staging, path)), { recursive: true }); writeFileSync(join(staging, path), data); }
  if (linkFingerprint(staging) !== fingerprint) throw new Error("Link-server source changed during installation.");
  // Fingerprint is part of the swap, never an independently published version marker.
  writeFileSync(join(staging, "fingerprint.sha256"), `${fingerprint}\n`, { mode: 0o600 });
  if (existsSync(copy)) { rmSync(backup, { recursive: true, force: true }); renameSync(copy, backup); moved = true; }
  try { renameSync(staging, copy); } catch (error) { if (moved) renameSync(backup, copy); throw error; }
  if (moved) rmSync(backup, { recursive: true, force: true });
 } finally { rmSync(staging, { recursive: true, force: true }); }
}
