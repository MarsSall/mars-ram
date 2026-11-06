// Per-user CLI copy and launcher. Registry edits are argv-only and preserve raw values/types.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { accessSync, closeSync, constants, cpSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, chmodSync, writeFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { dirname, join, posix, resolve, win32 } from 'node:path';

export const cliSource = resolve(import.meta.dirname, '../..');
export const protocolSource = existsSync(resolve(cliSource, '../../packages/protocol/package.json')) ? resolve(cliSource, '../../packages/protocol') : join(cliSource, 'protocol');
const marker = '# mars-ram installer-owned launcher v1';
const cmdMarker = '@rem mars-ram installer-owned launcher v1';
const paths = (platform: NodeJS.Platform) => platform === 'win32' ? win32 : { join, resolve };
export function launcherPath(home: string, platform: NodeJS.Platform): string {
 return platform === 'win32' ? win32.join(home, '.mars-ram/bin/mars-ram.cmd') : join(home, '.local/bin/mars-ram');
}
export function launcherContents(node: string, main: string, platform: NodeJS.Platform): string {
 if (/[\r\n]/.test(node + main)) throw new Error('Invalid launcher path.');
 if (platform === 'win32') {
  if (/["%]/.test(node + main)) throw new Error('Unsupported Windows launcher path.');
  return `${cmdMarker}\r\n@"${node}" "${main}" %*\r\n`;
 }
 const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
 return `#!/bin/sh\n${marker}\nexec ${quote(node)} ${quote(main)} "$@"\n`;
}
const smallFile = 64 * 1024;
/** A regular file of at most 64 KiB, read through one descriptor; a FIFO, device, directory, link or larger file is undefined. */
export function readSmallFile(path: string): string | undefined {
 let fd: number | undefined;
 try {
  if (!lstatSync(path).isFile()) return undefined;
  // Non-blocking and no-follow where available: a FIFO or link swapped in after lstat cannot block or redirect the open.
  fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.size > smallFile) return undefined;
  const buffer = Buffer.alloc(smallFile + 1);
  let length = 0, read: number;
  while ((read = readSync(fd, buffer, length, buffer.length - length, null)) > 0) if ((length += read) > smallFile) return undefined;
  return buffer.toString('utf8', 0, length);
 } catch { return undefined; } finally { if (fd !== undefined) closeSync(fd); }
}
function owned(path: string, platform: NodeJS.Platform): boolean {
 const stat = lstatSync(path);
 return !stat.isSymbolicLink() && stat.isFile() && !!readSmallFile(path)?.split(/\r?\n/).includes(platform === 'win32' ? cmdMarker : marker);
}
function present(path: string): boolean {
 try { lstatSync(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
export function checkLauncher(home: string, platform: NodeJS.Platform): void {
 const path = launcherPath(home, platform);
 // Never follow a linked launcher directory, even if the final launcher is absent.
 const directory = dirname(path);
 if (present(directory) && lstatSync(directory).isSymbolicLink()) throw new Error('Launcher directory is linked.');
 if (present(path) && !owned(path, platform)) throw new Error('Launcher is not installer-owned.');
}
export function installLauncher(home: string, node: string, platform: NodeJS.Platform): string {
 checkLauncher(home, platform);
 const path = launcherPath(home, platform);
 const directory = dirname(path);
 const newDirectory = !present(directory);
 mkdirSync(directory, { recursive: true, mode: 0o755 });
 if (newDirectory && platform !== 'win32') chmodSync(directory, 0o755);
 const main = paths(platform).join(home, '.mars-ram/cli/src/main.ts');
 const temporary = join(directory, `.mars-ram-${randomUUID()}.tmp`);
 // Exclusive, private staging: interruption cannot truncate the live launcher.
 const contents = launcherContents(node, main, platform);
 try {
  // Inside try: a failed or partial write must not leave the temp file behind.
  writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' });
  if (platform !== 'win32') chmodSync(temporary, 0o755);
  checkLauncher(home, platform);
  renameSync(temporary, path);
 } finally { rmSync(temporary, { force: true }); }
 return path;
}
export function removeLauncher(home: string, platform: NodeJS.Platform): void {
 const path = launcherPath(home, platform);
 if (present(dirname(path)) && lstatSync(dirname(path)).isSymbolicLink()) throw new Error('Launcher directory is linked.');
 if (present(path) && owned(path, platform)) rmSync(path);
}
/** From the npm package, the package's bin is the command: remove the installer's own launcher and, on Windows, the user
 * Path entry install added, both only when owned (marker, recorded addedPath). Returns a launcher kept because it is not
 * owned or sits behind a linked folder. */
export async function retireLauncher(record: { launcher?: string; addedPath?: string; pendingPath?: string }, home: string, platform: NodeJS.Platform, save: () => Promise<void>, io: UserPathIO = userPathIO): Promise<string | undefined> {
 const path = launcherPath(home, platform), directory = (platform === 'win32' ? win32 : posix).dirname(path);
 let kept: string | undefined;
 if (present(path)) {
  if (!lstatSync(directory).isSymbolicLink() && owned(path, platform)) rmSync(path);
  else kept = path;
 }
 delete record.launcher; await save();
 if (platform === 'win32') await updateOwnedUserPath(record, win32.join(home, '.mars-ram', 'bin'), home, false, save, io);
 return kept;
}
export function pathHint(home: string, path: string, shell: string, spanish: boolean): string | undefined {
 if (path.split(':').includes(join(home, '.local/bin'))) return undefined;
 const fix = /(?:^|\/)fish$/.test(shell) ? 'fish_add_path ~/.local/bin' : 'export PATH="$HOME/.local/bin:$PATH"';
 return spanish ? `~/.local/bin no está en PATH. Ejecutá ${fix} (y agregalo a la configuración de tu shell).` : `~/.local/bin is not on PATH. Run ${fix} (and add it to your shell configuration).`;
}

/** Only comparisons expand USERPROFILE; returned strings retain every original byte. */
export function editWindowsPath(raw: string, entry: string, add: boolean, home?: string): { value: string; changed: boolean } {
 const normalize = (value: string) => value.replace(/%USERPROFILE%/ig, home ?? '%USERPROFILE%').replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase();
 const parts = raw.split(';');
 const index = add ? parts.findIndex(part => normalize(part) === normalize(entry)) : parts.lastIndexOf(entry);
 if (add) return index >= 0 ? { value: raw, changed: false } : { value: raw + (raw ? ';' : '') + entry, changed: true };
 if (index < 0) return { value: raw, changed: false };
 // Install appends: remove the last exact owned entry, preserving earlier duplicates.
 parts.splice(index, 1);
 return { value: parts.join(';'), changed: true };
}
const psDecode = (value: string) => `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(value, 'utf8').toString('base64')}'))`;
export function windowsPathCommand(action: 'read' | 'write', value?: { raw: string; kind: string; value: string }): { command: string; args: string[] } {
 let script = "$ErrorActionPreference='Stop'; ";
 script += action === 'write' ? "$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$true); " : "$key=Get-Item 'HKCU:\\Environment'; ";
 script += "try { $raw=[string]$key.GetValue('Path','','DoNotExpandEnvironmentNames'); $kind=if ($key.GetValueNames() -contains 'Path') { $key.GetValueKind('Path').ToString() } else { 'String' }; ";
 if (action === 'read') script += '[pscustomobject]@{raw=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($raw));kind=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($kind))} | ConvertTo-Json -Compress';
 else {
  if (!value || !['String', 'ExpandString'].includes(value.kind)) throw new Error('Unsupported registry Path kind.');
  // Registry has no CAS. One handle and a read-back narrow, but cannot close, the race.
  const conflict = "throw 'User Path changed while installing; run install again'";
  script += `if ($raw -cne (${psDecode(value.raw)}) -or $kind -ne '${value.kind}') { ${conflict} }; $intended=(${psDecode(value.value)}); $key.SetValue('Path',$intended,[Microsoft.Win32.RegistryValueKind]::${value.kind}); if ([string]$key.GetValue('Path','','DoNotExpandEnvironmentNames') -cne $intended -or $key.GetValueKind('Path').ToString() -ne '${value.kind}') { ${conflict} }`;
 }
 script += ' } finally { $key.Close() }';
 return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script] };
}
export type RegistryPath = { raw: string; kind: string };
export type RegistryRunner = (command: string, args: string[], options: { encoding: 'utf8'; shell: false; windowsHide: true; timeout: number }) => string;
const registryRunner: RegistryRunner = (command, args, options) => execFileSync(command, args, options);
export function readUserPath(run: RegistryRunner = registryRunner): RegistryPath {
 const cmd = windowsPathCommand('read');
 const encoded = JSON.parse(run(cmd.command, cmd.args, { encoding: 'utf8', shell: false, windowsHide: true, timeout: 10000 }));
 if (typeof encoded.raw !== 'string' || typeof encoded.kind !== 'string') throw new Error('Invalid user Path.');
 const value = { raw: Buffer.from(encoded.raw, 'base64').toString('utf8'), kind: Buffer.from(encoded.kind, 'base64').toString('utf8') };
 if (!['String', 'ExpandString'].includes(value.kind)) throw new Error('Invalid user Path.');
 return value;
}
export function writeUserPath(previous: RegistryPath, value: string, run: RegistryRunner = registryRunner): void {
 const cmd = windowsPathCommand('write', { ...previous, value });
 run(cmd.command, cmd.args, { encoding: 'utf8', shell: false, windowsHide: true, timeout: 10000 });
}
export type UserPathIO = { read(): RegistryPath; write(previous: RegistryPath, value: string): void };
const userPathIO: UserPathIO = { read: () => readUserPath(), write: (previous, value) => writeUserPath(previous, value) };
/** Pending intent never grants ownership, including after a crash before promotion. */
export async function updateOwnedUserPath(record: { addedPath?: string; pendingPath?: string }, entry: string, home: string, add: boolean, save: () => Promise<void>, io: UserPathIO = userPathIO): Promise<void> {
 if (record.pendingPath) { delete record.pendingPath; await save(); }
 if (!add && !record.addedPath) return;
 const previous = io.read();
 const update = editWindowsPath(previous.raw, add ? entry : record.addedPath!, add, home);
 if (add && update.changed) {
  delete record.addedPath; record.pendingPath = entry; await save();
  try { io.write(previous, update.value); }
  catch (error) { delete record.pendingPath; await save(); throw error; }
  delete record.pendingPath; record.addedPath = entry; await save();
 } else if (update.changed) io.write(previous, update.value);
 if (!add) { delete record.addedPath; await save(); }
}
function packageRoot(name: string): string {
 const require = createRequire(join(cliSource, 'package.json'));
 let folder = dirname(realpathSync(require.resolve(name)));
 while (!existsSync(join(folder, 'package.json')) || JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).name !== name) {
  const parent = dirname(folder); if (parent === folder) throw new Error(`Cannot resolve ${name}`); folder = parent;
 }
 return folder;
}
function sources(): [string, string][] {
 return [[join(cliSource, 'src'), 'src'], [join(cliSource, 'package.json'), 'package.json'], [join(protocolSource, 'src'), 'node_modules/@workspace/protocol/src'], [join(protocolSource, 'package.json'), 'node_modules/@workspace/protocol/package.json'],
 // Keep original protocol bytes for bridge reinstall/freshness; Node's CLI runtime uses the emitted package.
 [join(protocolSource, 'src'), 'protocol/src'], [join(protocolSource, 'package.json'), 'protocol/package.json'], [packageRoot('typebox'), 'node_modules/typebox'], [packageRoot('uqr'), 'node_modules/uqr']];
}
const protocolKey = 'node_modules/@workspace/protocol/';
// Node warns once per process that stripTypeScriptTypes is experimental; keep mars-ram output clean
// by dropping only that warning, during this call only.
function stripTypes(source: string): string {
 const emit = process.emitWarning;
 process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  if ((typeof warning === 'string' ? warning : warning.message).includes('stripTypeScriptTypes')) return;
  return (emit as (...args: unknown[]) => void).call(process, warning, ...rest);
 }) as typeof process.emitWarning;
 try { return stripTypeScriptTypes(source); } finally { process.emitWarning = emit; }
}
function protocolJavaScript(source: string): string {
 return stripTypes(source).replace(/(["'][^"'\r\n]+)\.ts(["'])/g, '$1.js$2');
}
function protocolManifest(source: string): string {
 const value = JSON.parse(source);
 const jsExports = (entry: unknown): unknown => typeof entry === 'string' ? entry.replace(/\.ts$/, '.js') : entry && typeof entry === 'object' ? Object.fromEntries(Object.entries(entry).map(([key, child]) => [key, jsExports(child)])) : entry;
 value.exports = jsExports(value.exports);
 return `${JSON.stringify(value)}\n`;
}
function emitProtocol(folder: string): void {
 const visit = (path: string) => {
  if (lstatSync(path).isDirectory()) for (const name of readdirSync(path)) visit(join(path, name));
  else if (path.endsWith('.ts')) writeFileSync(path.slice(0, -3) + '.js', protocolJavaScript(readFileSync(path, 'utf8')));
 };
 visit(join(folder, 'src'));
 const manifest = join(folder, 'package.json');
 writeFileSync(manifest, protocolManifest(readFileSync(manifest, 'utf8')));
}
function fingerprint(entries: [string, string][], canonical = false): string {
 const hash = createHash('sha256');
 const files = new Map<string, string | Buffer>();
 const file = (key: string, bytes: string | Buffer) => { files.set(key, bytes); };
 const visit = (source: string, key: string) => {
  // Source workspace links are dereferenced exactly as in the copy operation.
  const path = realpathSync(source);
  if (lstatSync(path).isDirectory()) {
   const names = readdirSync(path).sort();
   for (const name of names) {
    if (canonical && key.startsWith(protocolKey) && name.endsWith('.js') && names.includes(name.slice(0, -3) + '.ts')) continue;
    visit(join(path, name), `${key}/${name}`);
   }
  } else {
   if (canonical && key === protocolKey + 'package.json') file(key, protocolManifest(readFileSync(path, 'utf8')));
   else file(key, readFileSync(path));
   if (canonical && key.startsWith(protocolKey) && key.endsWith('.ts')) file(key.slice(0, -3) + '.js', protocolJavaScript(readFileSync(path, 'utf8')));
  }
 };
 for (const [source, key] of entries) visit(source, key);
 for (const key of [...files.keys()].sort()) { hash.update(key); hash.update('\0'); hash.update(files.get(key)!); hash.update('\0'); }
 return hash.digest('hex');
}
export function cliCopyIsCurrent(copy: string): boolean {
 try { const entries = sources(); return fingerprint(entries, true) === fingerprint(entries.map(([, target]) => [join(copy, target), target])); } catch { return false; }
}
export function buildCliCopy(root: string): void {
 const copy = join(root, 'cli'), staging = `${copy}.staging`, backup = `${copy}.previous`;
 for (const path of [copy, staging, backup]) if (present(path) && lstatSync(path).isSymbolicLink()) throw new Error('Linked CLI installer path.');
 if (!existsSync(copy) && existsSync(backup)) renameSync(backup, copy);
 rmSync(staging, { recursive: true, force: true });
 const entries = sources(), expected = fingerprint(entries, true);
 mkdirSync(staging);
 let moved = false;
 try {
  for (const [source, target] of entries) { mkdirSync(dirname(join(staging, target)), { recursive: true }); cpSync(source, join(staging, target), { recursive: true, dereference: true }); }
  emitProtocol(join(staging, 'node_modules/@workspace/protocol'));
  if (fingerprint(entries.map(([, target]) => [join(staging, target), target])) !== expected) throw new Error('CLI source changed during installation.');
  writeFileSync(join(staging, 'fingerprint.sha256'), `${expected}\n`, { mode: 0o600 });
  if (existsSync(copy)) { rmSync(backup, { recursive: true, force: true }); renameSync(copy, backup); moved = true; }
  try { renameSync(staging, copy); } catch (error) { if (moved) renameSync(backup, copy); throw error; }
  if (moved) rmSync(backup, { recursive: true, force: true });
 } finally { rmSync(staging, { recursive: true, force: true }); }
}
/** Doctor also checks the SSH-exec entry recorded by install, without executing it. */
function cliConfigIsValid(home: string, platform: NodeJS.Platform): boolean {
 try {
  const p = paths(platform);
  const expected = p.resolve(home, '.mars-ram/cli/src/main.ts');
  const config = JSON.parse(readFileSync(p.join(home, '.mars-ram/host.json'), 'utf8'));
  return config.cli === expected && lstatSync(expected).isFile() && !lstatSync(expected).isSymbolicLink();
 } catch { return false; }
}
/** True when entry is a regular file whose package (two folders up) is named mars-ram. */
export function isPackageEntry(entry: string): boolean {
 try {
  const manifest = lstatSync(entry).isFile() ? readSmallFile(join(dirname(dirname(entry)), 'package.json')) : undefined;
  return manifest !== undefined && JSON.parse(manifest).name === 'mars-ram';
 } catch { return false; }
}
/** install.json says `mars-ram install` ran from the npm package, so the package's bin is the command. */
function packageMode(home: string, platform: NodeJS.Platform): boolean {
 try { return typeof JSON.parse(readSmallFile(paths(platform).join(home, '.mars-ram/install.json')) ?? '{}').packageBin === 'string'; } catch { return false; }
}
/** command: the first mars-ram on PATH, by path only; what it runs is never read or guessed. */
export function observeCli(home: string, platform: NodeJS.Platform, path = process.env.PATH ?? '', pathExt = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD'): { resolved: boolean; command?: string; current: boolean; localBin: boolean; packageMode: boolean } {
 const expected = launcherPath(home, platform);
 let found: string | undefined;
 const p = paths(platform);
 for (const dir of path.split(platform === 'win32' ? ';' : ':').filter(Boolean)) {
  // Match command lookup order without executing any candidate.
  const names = platform === 'win32' ? pathExt.split(';').filter(ext => /^\.[a-z0-9]+$/i.test(ext)).map(ext => `mars-ram${ext.toLowerCase()}`) : ['mars-ram'];
  for (const name of names) {
   const candidate = p.resolve(dir.replace(/^"|"$/g, ''), name);
   try { accessSync(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK); if (lstatSync(candidate).isDirectory()) continue; found = candidate; break; } catch { /* next */ }
  }
  if (found) break;
 }
 let resolved = false;
 try { resolved = !!found && realpathSync(found) === realpathSync(expected) && owned(expected, platform); } catch { /* absent */ }
 return { resolved, ...(found ? { command: found } : {}), current: cliConfigIsValid(home, platform) && cliCopyIsCurrent(p.join(home, '.mars-ram/cli')), localBin: path.split(':').includes(join(home, '.local/bin')), packageMode: packageMode(home, platform) };
}
