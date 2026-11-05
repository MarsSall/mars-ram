import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, renameSync, statSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>() }));
import { buildCliCopy, cliCopyIsCurrent, launcherContents, installLauncher, removeLauncher, editWindowsPath, windowsPathCommand, pathHint, observeCli, launcherPath, updateOwnedUserPath, readUserPath, writeUserPath } from '../../src/adapters/cli-installation.ts';
import type { DoctorPorts } from '../../src/core/doctor.ts';
import { createInstallAdapter } from '../../src/adapters/installation.ts';
import { checkCli } from '../../src/core/doctor.ts';

describe('installed CLI (isolated home; no real PATH changes)', () => {
 it('doctor requires host.json cli to point at the existing installed entry', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cli-config-'));
  try {
   const adapter = createInstallAdapter({ home }); await adapter.buildCopy();
   const config = join(home, '.mars-ram/host.json');
   const observe = () => observeCli(home, 'linux', '').current;
   expect(observe()).toBe(false);
   await adapter.writeHostConfig(); expect(observe()).toBe(true);
   const value = JSON.parse(readFileSync(config, 'utf8'));
   writeFileSync(config, JSON.stringify({ ...value, cli: 'relative/main.ts' })); expect(observe()).toBe(false);
   writeFileSync(config, JSON.stringify({ ...value, cli: join(home, 'missing.ts') })); expect(observe()).toBe(false);
   writeFileSync(config, 'invalid'); expect(observe()).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
 });
 it('copies runtime dependencies, fingerprints, updates, recovers interrupted swaps and uninstalls', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cli-copy-'));
  try {
   const root = join(home, '.mars-ram'); mkdirSync(root);
   buildCliCopy(root);
   const copy = join(root, 'cli');
   for (const file of ['src/main.ts', 'node_modules/@workspace/protocol/src/index.ts', 'node_modules/typebox/package.json', 'node_modules/uqr/package.json', 'fingerprint.sha256']) expect(existsSync(join(copy, file)), file).toBe(true);
   expect(cliCopyIsCurrent(copy)).toBe(true);
   writeFileSync(join(copy, 'node_modules/@workspace/protocol/src/index.js'), '// tampered generated dependency');
   expect(cliCopyIsCurrent(copy)).toBe(false); buildCliCopy(root);
   writeFileSync(join(copy, 'src/main.ts'), '// changed'); expect(cliCopyIsCurrent(copy)).toBe(false);
   buildCliCopy(root); expect(cliCopyIsCurrent(copy)).toBe(true);
   renameSync(copy, `${copy}.previous`); mkdirSync(`${copy}.staging`);
   await createInstallAdapter({ home }).recover();
   expect(cliCopyIsCurrent(copy)).toBe(true); expect(existsSync(`${copy}.staging`)).toBe(false);
   await createInstallAdapter({ home }).deleteInstallation(); expect(existsSync(copy)).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
 });
 it.runIf(process.platform !== 'win32')('persists launcher ownership, updates it and removes it on uninstall', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cli-owned-'));
  try {
   const adapter = createInstallAdapter({ home });
   const record = { homes: [], copy: join(home, '.mars-ram/pi-bridge'), version: 'fixture', date: 'today' };
   await adapter.writeRecord(record); await adapter.installCli(record);
   expect((await adapter.readRecord())?.launcher).toBe(launcherPath(home, process.platform));
   expect((await adapter.readRecord())?.cli).toBe(join(home, '.mars-ram/cli'));
   await adapter.installCli(record);
   await adapter.deleteInstallation(); expect(existsSync(launcherPath(home, process.platform))).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
 });
 it('runs the installed CLI entry and can rebuild from installed source without workspace imports', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cli-runtime-'));
  try {
   const adapter = createInstallAdapter({ home }); await adapter.buildCopy();
   const main = join(home, '.mars-ram/cli/src/main.ts');
   // Invalid arguments exercise the real entry and all runtime imports, without diagnostic OS commands.
   try { execFileSync(process.execPath, [main, '--invalid'], { env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: 'pipe' }); throw new Error('Expected usage failure'); }
   catch (error) { expect((error as { status?: number }).status).toBe(2); expect(String((error as { stderr?: Buffer }).stderr)).not.toContain('ERR_MODULE_NOT_FOUND'); }
   const entry = pathToFileURL(join(home, '.mars-ram/cli/src/adapters/installation.ts')).href;
   execFileSync(process.execPath, ['--input-type=module', '-e', `const {createInstallAdapter}=await import(${JSON.stringify(entry)}); await createInstallAdapter({home:${JSON.stringify(home)}}).buildCopy(); const {copyIsCurrent}=await import(${JSON.stringify(pathToFileURL(join(home, '.mars-ram/cli/src/adapters/doctor.ts')).href)}); if (!copyIsCurrent(${JSON.stringify(join(home, '.mars-ram/pi-bridge'))})) throw new Error('bridge freshness failed');`], { env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: 'pipe' });
   expect(cliCopyIsCurrent(join(home, '.mars-ram/cli'))).toBe(true);
  } finally { rmSync(home, { recursive: true, force: true }); }
 });
 it.runIf(process.platform !== 'win32')('creates executable shell launcher, protects unowned files and removes only its marker', () => {
  const home = mkdtempSync(join(tmpdir(), 'cli-launch-'));
  try {
   const path = join(home, '.local/bin/mars-ram');
   installLauncher(home, '/node path/node', 'linux');
   expect(readFileSync(path, 'utf8')).toBe(launcherContents('/node path/node', join(home, '.mars-ram/cli/src/main.ts'), 'linux'));
   expect(statSync(path).mode & 0o777).toBe(0o755);
   expect(statSync(join(home, '.local/bin')).mode & 0o777).toBe(0o755);
   installLauncher(home, '/new/node', 'linux'); expect(readFileSync(path, 'utf8')).toContain('/new/node');
   writeFileSync(path, 'user command'); expect(() => installLauncher(home, '/node', 'linux')).toThrow(/owned/i);
   removeLauncher(home, 'linux'); expect(readFileSync(path, 'utf8')).toBe('user command');
   rmSync(path); symlinkSync(join(home, 'outside'), path); expect(() => installLauncher(home, '/node', 'linux')).toThrow();
  } finally { rmSync(home, { recursive: true, force: true }); }
 });
 it.runIf(process.platform !== 'win32')('stages a private complete launcher before rename and preserves the old launcher if interrupted', () => {
  const home = mkdtempSync(join(tmpdir(), 'cli-atomic-'));
  try {
   const path = installLauncher(home, '/old/node', 'linux');
   const previous = readFileSync(path, 'utf8');
   const rename = vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
    expect(target).toBe(path);
    expect(join(String(source), '..')).toBe(join(path, '..'));
    expect(source).not.toBe(path);
    expect(statSync(source).mode & 0o777).toBe(0o755);
    expect(readFileSync(source, 'utf8')).toBe(launcherContents('/new/node', join(home, '.mars-ram/cli/src/main.ts'), 'linux'));
    expect(readFileSync(path, 'utf8')).toBe(previous);
    throw new Error('interrupted before rename');
   });
   expect(() => installLauncher(home, '/new/node', 'linux')).toThrow('interrupted before rename');
   expect(rename).toHaveBeenCalledOnce();
   expect(readFileSync(path, 'utf8')).toBe(previous);
   rename.mockRestore();
   const write = vi.spyOn(fs, 'writeFileSync');
   installLauncher(home, '/new/node', 'linux');
   expect(write).toHaveBeenCalledWith(expect.any(String), expect.any(String), { mode: 0o600, flag: 'wx' });
   expect(readFileSync(path, 'utf8')).toContain('/new/node');
   expect(statSync(path).mode & 0o777).toBe(0o755);
  } finally { vi.restoreAllMocks(); rmSync(home, { recursive: true, force: true }); }
 });
 it.runIf(process.platform !== 'win32')('keeps a live launcher intact when writing the temporary launcher is interrupted', () => {
  const home = mkdtempSync(join(tmpdir(), 'cli-write-interrupted-'));
  try {
   const path = installLauncher(home, '/old/node', 'linux'), previous = readFileSync(path, 'utf8');
   const realWrite = fs.writeFileSync;
   vi.spyOn(fs, 'writeFileSync').mockImplementationOnce((file, _contents, options) => {
    realWrite(file, '# partial launcher', options);
    expect(typeof file).toBe('string');
    expect(statSync(String(file)).mode & 0o777).toBe(0o600);
    throw new Error('interrupted write');
   });
   expect(() => installLauncher(home, '/new/node', 'linux')).toThrow('interrupted write');
   expect(readFileSync(path, 'utf8')).toBe(previous);
   expect(readdirSync(dirname(path)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  } finally { vi.restoreAllMocks(); rmSync(home, { recursive: true, force: true }); }
 });
 it('quotes launcher paths and gives shell-specific PATH advice', () => {
  expect(launcherContents("/a'b/node", "/a'b/main.ts", 'linux')).toContain("exec '/a'\\''b/node' '/a'\\''b/main.ts' \"$@\"");
  expect(launcherContents('C:\\Node\\node.exe', 'C:\\User\\cli\\src\\main.ts', 'win32')).toContain('@"C:\\Node\\node.exe" "C:\\User\\cli\\src\\main.ts" %*');
  expect(pathHint('/home/test', '/bin', '/bin/fish', false)).toContain('fish_add_path ~/.local/bin');
  expect(pathHint('/home/test', '/bin', '/bin/bash', false)).toContain('export PATH="$HOME/.local/bin:$PATH"');
  expect(pathHint('/home/test', '/home/test/.local/bin:/bin', '/bin/zsh', false)).toBeUndefined();
 });
 it.each(['C:\\tools', '', '%USERPROFILE%\\tools;C:\\Other;', 'C:\\Keep;;%FOO%\\x'])('preserves raw Windows Path and its uninstall inverse: %s', raw => {
  const entry = 'C:\\Users\\Test\\.mars-ram\\bin';
  const added = editWindowsPath(raw, entry, true); expect(added.changed).toBe(true);
  expect(added.value).toBe(raw + (raw ? ';' : '') + entry);
  expect(editWindowsPath(added.value, entry, false).value).toBe(raw);
 });
 it.each(['A;;B', ';A', 'A;', ';', ';;'])('preserves every empty Windows Path component: %s', raw => {
  const added = editWindowsPath(raw, 'entry', true);
  expect(added.value).toBe(raw + ';entry');
  expect(editWindowsPath(added.value, 'entry', false).value).toBe(raw);
 });
 it('removes only the last exact duplicate and only with confirmed ownership', async () => {
  const entry = 'C:\\Users\\Test\\.mars-ram\\bin', home = 'C:\\Users\\Test';
  let raw = `${entry};A;${entry}`;
  const io = { read: () => ({ raw, kind: 'String' }), write: (_previous: unknown, value: string) => { raw = value; } };
  await updateOwnedUserPath({}, entry, home, false, async () => {}, io);
  expect(raw).toBe(`${entry};A;${entry}`);
  await updateOwnedUserPath({ addedPath: entry }, entry, home, false, async () => {}, io);
  expect(raw).toBe(`${entry};A`);
  expect(editWindowsPath(`${entry};A;${entry.toUpperCase()}`, entry, false).value).toBe(`A;${entry.toUpperCase()}`);
 });
 it('recognizes different case, trailing slashes and unexpanded USERPROFILE entries', () => {
  const entry = 'C:\\Users\\Test\\.mars-ram\\bin';
  for (const raw of ['c:\\users\\test\\.MARS-RAM\\bin\\;C:\\keep', '%USERPROFILE%\\.mars-ram\\bin;C:\\keep']) expect(editWindowsPath(raw, entry, true, 'C:\\Users\\Test')).toEqual({ value: raw, changed: false });
  expect(editWindowsPath('C:\\keep', entry, false).changed).toBe(false);
 });
 it('builds PowerShell registry commands as argv, preserves raw kind, and checks for concurrent changes', () => {
  const cmd = windowsPathCommand('write', { raw: '%FOO%\\bin', kind: 'ExpandString', value: '%FOO%\\bin;C:\\new' });
  expect(cmd.command).toBe('powershell.exe'); expect(cmd.args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command']);
  expect(cmd.args[3]!).toContain('DoNotExpandEnvironmentNames'); expect(cmd.args[3]!).toContain('GetValueKind'); expect(cmd.args[3]!).toContain('SetValue'); expect(cmd.args[3]!).not.toContain('SetEnvironmentVariable');
 });
 it('compares, writes and verifies raw Path and kind through one writable registry handle', () => {
  const script = windowsPathCommand('write', { raw: 'A', kind: 'ExpandString', value: 'A;entry' }).args[3]!;
  expect(script.match(/OpenSubKey\('Environment',\$true\)/g)).toHaveLength(1);
  expect(script).not.toContain('Get-Item');
  const opened = script.indexOf('OpenSubKey'), read = script.indexOf("$key.GetValue('Path'"), compared = script.indexOf('if ($raw -cne'), written = script.indexOf('$key.SetValue'), verified = script.lastIndexOf("$key.GetValue('Path'"), closed = script.indexOf('$key.Close()');
  expect(opened).toBeLessThan(read); expect(read).toBeLessThan(compared);
  expect(compared).toBeLessThan(written); expect(written).toBeLessThan(verified); expect(verified).toBeLessThan(closed);
  expect(script.match(/\$key.GetValueKind\('Path'\)/g)).toHaveLength(2);
  expect(script).toContain('User Path changed while installing; run install again');
 });
 it('does not claim ownership after a post-write conflict', async () => {
  const record: { addedPath?: string; pendingPath?: string } = {};
  let raw = 'A';
  await expect(updateOwnedUserPath(record, 'entry', 'home', true, async () => {}, {
   read: () => ({ raw, kind: 'String' }),
   write: (_previous, value) => { raw = value + ';concurrent'; throw new Error('User Path changed while installing; run install again'); },
  })).rejects.toThrow('User Path changed while installing; run install again');
  expect(raw).toBe('A;entry;concurrent'); expect(record).toEqual({});
 });
 it('edits user Path through a shell-free argv runner only', () => {
  const calls: unknown[] = [];
  const run = (command: string, args: string[], options: object) => { calls.push({ command, args, options }); return JSON.stringify({ raw: Buffer.from('%FOO%;C:\\tools').toString('base64'), kind: Buffer.from('ExpandString').toString('base64') }); };
  const previous = readUserPath(run); writeUserPath(previous, previous.raw + ';new', run);
  expect(calls).toHaveLength(2);
  for (const call of calls) expect(call).toMatchObject({ command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', expect.any(String)], options: { shell: false, windowsHide: true, timeout: 10000 } });
 });
 it('records Windows Path intent before mutation, keeps preexisting entries unowned and removes only its entry', async () => {
  const home = 'C:\\Users\\Test', entry = home + '\\.mars-ram\\bin';
  const record: { addedPath?: string; pendingPath?: string } = {};
  let raw = '%FOO%\\bin;C:\\keep;', saved: typeof record = {};
  const io = { read: () => ({ raw, kind: 'ExpandString' }), write: (_previous: unknown, value: string) => { if (value.includes(entry)) { expect(saved.pendingPath).toBe(entry); expect(saved.addedPath).toBeUndefined(); } raw = value; } };
  const save = async () => { saved = { ...record }; };
  const original = raw;
  await updateOwnedUserPath(record, entry, home, true, save, io); expect(record.addedPath).toBe(entry);
  raw += ';C:\\user-added';
  await updateOwnedUserPath(record, entry, home, false, save, io); expect(raw).toBe(original + ';C:\\user-added'); expect(record.addedPath).toBeUndefined();
  raw = '%USERPROFILE%\\.mars-ram\\bin;C:\\keep';
  await updateOwnedUserPath(record, entry, home, true, save, io); expect(record.addedPath).toBeUndefined();
  await updateOwnedUserPath(record, entry, home, false, save, io); expect(raw).toBe('%USERPROFILE%\\.mars-ram\\bin;C:\\keep');
 });
 it('round trips non-ASCII registry values through ASCII-only base64 scripts', () => {
  const raw = 'C:\\Usuarios\\José\\bin;%USERPROFILE%\\x', kind = 'ExpandString';
  const encode = (text: string) => Buffer.from(text, 'utf8').toString('base64');
  const read = windowsPathCommand('read').args[3]!;
  for (const name of ['raw', 'kind']) expect(read).toContain(`[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($${name}))`);
  const previous = readUserPath(() => JSON.stringify({ raw: encode(raw), kind: encode(kind) }));
  expect(previous).toEqual({ raw, kind });
  const script = windowsPathCommand('write', { ...previous, value: raw + ';new' }).args[3]!;
  const values = [...script.matchAll(/\[Text.Encoding\]::UTF8.GetString\(\[Convert\]::FromBase64String\('([^']*)'\)\)/g)].map(match => Buffer.from(match[1]!, 'base64').toString('utf8'));
  expect(values).toEqual([raw, raw + ';new']); expect(script).not.toContain('José');
 });
 it.each([false, true])('never adopts user Path after a failed write or pending crash (crash=%s)', async crash => {
  const home = 'C:\\Users\\Test', entry = home + '\\.mars-ram\\bin';
  const record: { addedPath?: string; pendingPath?: string } = {};
  let raw = 'C:\\keep', saved: typeof record = {};
  const save = async () => { saved = { ...record }; };
  const io = { read: () => ({ raw, kind: 'String' }), write: (_previous: unknown, value: string) => { raw = value; } };
  if (crash) { record.pendingPath = entry; await save(); }
  else {
   await expect(updateOwnedUserPath(record, entry, home, true, save, { ...io, write: () => { throw new Error('registry denied'); } })).rejects.toThrow('registry denied');
   expect(saved).toEqual({});
  }
  raw += ';' + entry;
  const retry = { ...saved };
  await updateOwnedUserPath(retry, entry, home, true, async () => {}, io);
  expect(retry.addedPath).toBeUndefined();
  await updateOwnedUserPath(retry, entry, home, false, async () => {}, io);
  expect(raw).toBe('C:\\keep;' + entry);
 });
 it.runIf(process.platform !== 'win32')('observes PATH resolution without running it and emits bilingual doctor lines', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cli-doctor-'));
  try {
   installLauncher(home, process.execPath, 'linux');
   const observed = observeCli(home, 'linux', join(home, '.local/bin'));
   expect(observed.resolved).toBe(true); expect(observed.localBin).toBe(true); expect(observed.current).toBe(false);
   expect(observeCli(home, 'linux', '/missing').resolved).toBe(false);
   const lookup = vi.spyOn(fs, 'accessSync');
   for (const path of ['', ':', '::']) expect(observeCli(home, 'linux', path).resolved).toBe(false);
   expect(lookup).not.toHaveBeenCalled(); lookup.mockRestore();
   expect(observeCli(home, 'linux', ':/missing::').resolved).toBe(false);
   expect(observeCli(home, 'linux', `::${join(home, '.local/bin')}::`).resolved).toBe(true);
   for (const spanish of [false, true]) {
    const lines = await checkCli({ platform: 'linux', spanish, cli: async () => observed } as DoctorPorts);
    expect(lines.map(line => line.status)).toEqual(['ok', 'warning', 'ok']);
    expect(lines[1]!.finding).toContain(spanish ? 'desactualizada' : 'outdated'); expect(lines[1]!.fix).toBeTruthy();
    const missing = await checkCli({ platform: 'linux', spanish, cli: async () => ({ resolved: false, current: false, localBin: false }) } as DoctorPorts);
    expect(missing.map(line => line.status)).toEqual(['warning', 'warning', 'warning']);
    expect(missing[0]!.finding).toContain(spanish ? 'no corresponde' : 'does not resolve');
    expect(missing[2]!.fix).toContain('fish_add_path ~/.local/bin');
   }
  } finally { rmSync(home, { recursive: true, force: true }); }
 });
});

it('builds the CLI copy without printing Node\'s type-stripping ExperimentalWarning, and keeps other warnings', () => {
 const root = mkdtempSync(join(tmpdir(), 'mr-quiet-copy-'));
 try {
  const module = pathToFileURL(join(import.meta.dirname, '../../src/adapters/cli-installation.ts')).href;
  const script = `const m = await import(${JSON.stringify(module)}); m.buildCliCopy(${JSON.stringify(root)}); process.emitWarning('other warning'); console.log(m.cliCopyIsCurrent(${JSON.stringify(join(root, "cli"))}));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe('true');
  expect(result.stderr).not.toContain('ExperimentalWarning');
  expect(result.stderr).not.toContain('stripTypeScriptTypes');
  expect(result.stderr).toContain('Warning: other warning');
  expect(existsSync(join(root, 'cli/node_modules/@workspace/protocol/src/index.js'))).toBe(true);
 } finally { rmSync(root, { recursive: true, force: true }); }
}, 60_000);
