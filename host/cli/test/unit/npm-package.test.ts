import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildRelease } from '../../scripts/build-release.ts';
import { installLauncher } from '../../src/adapters/cli-installation.ts';

// Everything runs in temporary folders: HOME, TMPDIR and global prefixes; nothing is published and no registry is used.
const temporary: string[] = [];
const fresh = (prefix: string) => { const dir = mkdtempSync(join(tmpdir(), prefix)); temporary.push(dir); return dir; };
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

let out: string, release: ReturnType<typeof buildRelease>;
beforeAll(() => {
 out = mkdtempSync(join(tmpdir(), 'npm-package-out-'));
 release = buildRelease('1.2.3', out);
 return () => rmSync(out, { recursive: true, force: true });
}, 60_000);

const tgz = () => join(out, 'mars-ram-1.2.3.tgz');
const files = () => execFileSync('tar', ['-tzf', tgz()], { encoding: 'utf8' }).split('\n').filter(Boolean);
const read = (entry: string) => execFileSync('tar', ['-xzOf', tgz(), entry], { maxBuffer: 1024 ** 3 });
// Unpacked outside node_modules, as a test stand-in for the installed package folder.
function unpack(): string {
 const dir = fresh('npm-package-unpacked-');
 execFileSync('tar', ['-xzf', tgz(), '-C', dir]);
 return join(dir, 'package');
}
function launch(pkg: string, args: string[], env: Record<string, string>, input?: string) {
 return spawnSync(process.execPath, [join(pkg, 'bin/mars-ram.mjs'), ...args], { encoding: 'utf8', input, env: { PATH: dirname(process.execPath) + delimiter + '/usr/bin' + delimiter + '/bin', LANG: 'en_US.UTF-8', ...env }, timeout: 60_000 });
}

describe('npm package mars-ram (built locally; nothing published)', () => {
 it('is written next to the release archive and returned', () => {
  expect(release.npmPackage).toBe(tgz());
  expect(readdirSync(out).sort()).toEqual(['SHA256SUMS', 'install.ps1', 'install.sh', 'mars-ram-1.2.3.tar.gz', 'mars-ram-1.2.3.tgz']);
 });

 it('holds exactly package.json, README, the launcher and the archive, all under package/', () => {
  expect(files()).toEqual(['package/README.md', 'package/archive/mars-ram-1.2.3.tar.gz', 'package/bin/mars-ram.mjs', 'package/package.json']);
  const types = execFileSync('tar', ['-tvzf', tgz()], { encoding: 'utf8' }).split('\n').filter(Boolean).map(line => line.slice(0, 10));
  expect(types).toEqual(['-rw-r--r--', '-rw-r--r--', '-rwxr-xr-x', '-rw-r--r--']);
 });

 it('declares a bin and Node 24, with no scripts and no dependencies', () => {
  const manifest = JSON.parse(read('package/package.json').toString('utf8'));
  expect(manifest).toEqual({
   name: 'mars-ram',
   version: '1.2.3',
   description: expect.any(String),
   license: 'UNLICENSED',
   type: 'module',
   bin: { 'mars-ram': 'bin/mars-ram.mjs' },
   engines: { node: '>=24' },
   files: ['archive', 'bin', 'README.md'],
   repository: { type: 'git', url: 'git+https://github.com/MarsSall/mars-ram.git' },
   homepage: 'https://marssall.github.io/mars-ram/install',
  });
  for (const key of ['scripts', 'dependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'gypfile']) expect(manifest).not.toHaveProperty(key);
 });

 it('embeds the release archive byte for byte and pins its SHA-256 and CLI fingerprint in the launcher', () => {
  const embedded = read('package/archive/mars-ram-1.2.3.tar.gz');
  expect(embedded.equals(readFileSync(release.archive))).toBe(true);
  const launcher = read('package/bin/mars-ram.mjs').toString('utf8');
  expect(launcher.startsWith('#!/usr/bin/env node\n')).toBe(true);
  expect(launcher).not.toContain('@MARS_RAM_');
  expect(launcher).toContain(`const ARCHIVE_SHA256 = '${sha256(embedded)}';`);
  expect(launcher).toContain("const VERSION = '1.2.3';");
  const fingerprint = execFileSync('tar', ['-xzOf', release.archive, 'mars-ram-1.2.3/cli/fingerprint.sha256'], { encoding: 'utf8' }).trim();
  expect(launcher).toContain(`const CLI_FINGERPRINT = '${fingerprint}';`);
  const readme = read('package/README.md').toString('utf8');
  for (const command of ['pnpm add -g mars-ram', 'npm i -g mars-ram', 'mars-ram install', 'mars-ram pair']) expect(readme).toContain(command);
 });

 it('is reproducible byte for byte', () => {
  const again = buildRelease('1.2.3', fresh('npm-package-again-'));
  expect(readFileSync(again.npmPackage).equals(readFileSync(tgz()))).toBe(true);
 });

 it('refuses to overwrite an existing package', () => {
  const dir = fresh('npm-package-exists-');
  writeFileSync(join(dir, 'mars-ram-1.0.0.tgz'), 'existing bytes');
  expect(() => buildRelease('1.0.0', dir)).toThrow(/already exists/);
  expect(readdirSync(dir)).toEqual(['mars-ram-1.0.0.tgz']);
 });

 it('runs the CLI from a private temporary copy, passes the exit code through and removes the copy', () => {
  const pkg = unpack(), home = fresh('npm-home-'), tmp = fresh('npm-tmp-');
  const run = launch(pkg, [], { HOME: home, TMPDIR: tmp });
  expect(run.status).toBe(2);
  expect(run.stderr.startsWith('Usage: mars-ram pair')).toBe(true);
  expect(run.stderr).not.toContain('ExperimentalWarning');
  expect(readdirSync(tmp)).toEqual([]);
 });

 it.each([
  ['en_US.UTF-8', 'The mars-ram package is damaged'],
  ['es_AR.UTF-8', 'El paquete mars-ram está dañado'],
 ])('refuses a tampered archive (%s): exit 1, nothing extracted or installed', (lang, message) => {
  const pkg = unpack(), home = fresh('npm-home-'), tmp = fresh('npm-tmp-');
  const archive = join(pkg, 'archive/mars-ram-1.2.3.tar.gz');
  const bytes = readFileSync(archive);
  bytes[bytes.length - 20] = bytes[bytes.length - 20]! ^ 0xff;
  writeFileSync(archive, bytes);
  mkdirSync(join(home, '.pi/agent'), { recursive: true });
  const run = launch(pkg, ['install'], { HOME: home, TMPDIR: tmp, LANG: lang }, '\ny\n');
  expect(run.status).toBe(1);
  expect(run.stdout).toBe('');
  expect(run.stderr).toContain(message);
  expect(run.stderr).toContain(release.sha256);
  expect(run.stderr).toContain(sha256(bytes));
  expect(existsSync(join(home, '.mars-ram'))).toBe(false);
  expect(readdirSync(tmp)).toEqual([]);
 });

 describe('an installed copy of the same CLI', () => {
  const fingerprint = () => execFileSync('tar', ['-xzOf', release.archive, 'mars-ram-1.2.3/cli/fingerprint.sha256'], { encoding: 'utf8' });
  function installedHome(print: string, recorded = fingerprint()): string {
   const home = fresh('npm-home-');
   mkdirSync(join(home, '.mars-ram/cli/src'), { recursive: true });
   writeFileSync(join(home, '.mars-ram/cli/fingerprint.sha256'), recorded);
   writeFileSync(join(home, '.mars-ram/cli/src/main.ts'), print);
   return home;
  }

  it('runs instead of the archive, with its arguments and exit code', () => {
   const pkg = unpack(), tmp = fresh('npm-tmp-');
   const home = installedHome("const args: string[] = process.argv.slice(2); console.log('installed copy', JSON.stringify(args)); process.exit(7);\n");
   const run = launch(pkg, ['doctor', '--x', 'a b'], { HOME: home, TMPDIR: tmp });
   expect(run.stdout).toBe('installed copy ["doctor","--x","a b"]\n');
   expect(run.status).toBe(7);
   expect(readdirSync(tmp)).toEqual([]);
  });

  it('ends the same way when the CLI is killed by a signal', () => {
   const pkg = unpack();
   const home = installedHome("process.kill(process.pid, 'SIGTERM'); setTimeout(() => {}, 5000);\n");
   const run = launch(pkg, ['pair'], { HOME: home, TMPDIR: fresh('npm-tmp-') });
   expect(run.signal).toBe('SIGTERM');
  });

  it.each(['install', 'uninstall'])('is not used for %s, which always runs from the package', command => {
   const pkg = unpack(), tmp = fresh('npm-tmp-');
   const home = installedHome("console.log('installed copy');\n");
   const run = launch(pkg, [command], { HOME: home, TMPDIR: tmp }, '');
   expect(run.stdout).not.toContain('installed copy');
   expect(readdirSync(tmp)).toEqual([]);
  });

  it('is not used when its fingerprint differs (another version)', () => {
   const pkg = unpack(), tmp = fresh('npm-tmp-');
   const home = installedHome("console.log('installed copy');\n", `${'0'.repeat(64)}\n`);
   const run = launch(pkg, [], { HOME: home, TMPDIR: tmp });
   expect(run.stdout).not.toContain('installed copy');
   expect(run.status).toBe(2);
   expect(run.stderr.startsWith('Usage: mars-ram pair')).toBe(true);
  });
 });

 it('removes the temporary copy when SIGTERM arrives while the archive is being unpacked', async () => {
  const pkg = unpack(), home = fresh('npm-home-'), tmp = fresh('npm-tmp-'), bin = fresh('npm-bin-');
  // A slow tar: the launcher is inside its own startup when the signal arrives.
  const tar = execFileSync('sh', ['-c', 'command -v tar'], { encoding: 'utf8' }).trim(), marker = join(bin, 'started');
  writeFileSync(join(bin, 'tar'), `#!/bin/sh\n: > '${marker}'\nsleep 2\nexec '${tar}' "$@"\n`, { mode: 0o755 });
  const child = spawn(process.execPath, [join(pkg, 'bin/mars-ram.mjs')], { env: { PATH: [bin, dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter), HOME: home, TMPDIR: tmp, LANG: 'en_US.UTF-8' }, stdio: 'ignore' });
  const exited = new Promise<[number | null, string | null]>(resolve => child.on('exit', (c, s) => resolve([c, s])));
  while (!existsSync(marker)) await new Promise(resolve => setTimeout(resolve, 20));
  expect(readdirSync(tmp)).toHaveLength(1);
  child.kill('SIGTERM');
  expect((await exited)[1]).toBe('SIGTERM');
  expect(readdirSync(tmp)).toEqual([]);
 }, 60_000);

 describe('install from the package', () => {
  function fixture() {
   const pkg = unpack(), home = fresh('npm-home-'), tmp = fresh('npm-tmp-'), bin = fresh('npm-bin-');
   mkdirSync(join(home, '.pi/agent'), { recursive: true });
   writeFileSync(join(bin, 'pi'), '#!/bin/sh\necho "$@" >> "$HOME/pi.log"\n', { mode: 0o755 });
   return { pkg, home, tmp, env: { HOME: home, TMPDIR: tmp, PATH: [bin, dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter) } };
  }
  it('writes no launcher of its own, removes the one an earlier install left, records the package; uninstall leaves the package', () => {
   const { pkg, home, tmp, env } = fixture();
   // As the curl script or a clone left it.
   const launcher = installLauncher(home, process.execPath, 'linux');
   const install = launch(pkg, ['install'], env, '\ny\n');
   expect(install.status).toBe(0);
   expect(existsSync(launcher)).toBe(false);
   for (const copy of ['cli/src/main.ts', 'link-server/src/main.ts', 'pi-bridge/src/extension.ts']) expect(existsSync(join(home, '.mars-ram', copy))).toBe(true);
   const record = JSON.parse(readFileSync(join(home, '.mars-ram/install.json'), 'utf8'));
   expect(record.packageBin).toBe(realpathSync(join(pkg, 'bin/mars-ram.mjs')));
   expect(record.launcher).toBeUndefined();
   expect(install.stdout).not.toContain('.local/bin is not on PATH');
   const uninstall = launch(pkg, ['uninstall'], env, 'y\n');
   expect(uninstall.status).toBe(0);
   expect(uninstall.stdout).toContain('pnpm remove -g mars-ram');
   expect(existsSync(join(home, '.mars-ram/cli'))).toBe(false);
   expect(existsSync(join(pkg, 'bin/mars-ram.mjs'))).toBe(true);
   expect(readdirSync(tmp)).toEqual([]);
  }, 120_000);
  it('keeps a file at the launcher path that install did not create, and says so', () => {
   const { pkg, home, env } = fixture();
   mkdirSync(join(home, '.local/bin'), { recursive: true });
   writeFileSync(join(home, '.local/bin/mars-ram'), '#!/bin/sh\necho mine\n', { mode: 0o755 });
   const install = launch(pkg, ['install'], env, '\ny\n');
   expect(install.status).toBe(0);
   expect(readFileSync(join(home, '.local/bin/mars-ram'), 'utf8')).toBe('#!/bin/sh\necho mine\n');
   expect(install.stdout).toContain(`Kept ${join(home, '.local/bin/mars-ram')}`);
  }, 120_000);
 });

 it('forwards SIGTERM to the CLI and still removes the temporary copy', async () => {
  const pkg = unpack(), home = fresh('npm-home-'), tmp = fresh('npm-tmp-'), bin = fresh('npm-bin-');
  mkdirSync(join(home, '.pi/agent'), { recursive: true });
  writeFileSync(join(bin, 'pi'), '#!/bin/sh\necho "$@" >> "$HOME/pi.log"\n');
  chmodSync(join(bin, 'pi'), 0o755);
  // install lists the Pi homes, then waits for an answer on stdin: a running CLI that has written nothing yet.
  const child = spawn(process.execPath, [join(pkg, 'bin/mars-ram.mjs'), 'install'], { env: { PATH: [bin, dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter), HOME: home, TMPDIR: tmp, LANG: 'en_US.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  await new Promise<void>(resolve => child.stdout.on('data', chunk => { stdout += chunk; if (stdout.includes(join(home, '.pi/agent'))) resolve(); }));
  expect(readdirSync(tmp)).toHaveLength(1);
  child.kill('SIGTERM');
  const [code, signal] = await new Promise<[number | null, string | null]>(resolve => child.on('exit', (c, s) => resolve([c, s])));
  expect([code, signal]).toEqual([null, 'SIGTERM']);
  expect(readdirSync(tmp)).toEqual([]);
  expect(existsSync(join(home, 'pi.log'))).toBe(false);
 }, 60_000);
});

// Real global installs from the local .tgz with npm and pnpm, each in its own temporary HOME and prefix, offline,
// under `env -i` with a minimal PATH and a fake `pi` that only logs. Skipped when the package manager is not found.
const npmNode = process.env.MARS_RAM_TEST_NPM_NODE ?? process.execPath;
const npmCli = join(dirname(npmNode), '../lib/node_modules/npm/bin/npm-cli.js');
const pnpmBinary = process.env.MARS_RAM_TEST_PNPM;
const transcript = (label: string, text: string) => { if (process.env.MARS_RAM_TEST_TRANSCRIPT) process.stdout.write(`--- ${label}\n${text}\n`); };

function realInstall(installPackage: (env: Record<string, string>, root: string) => { bin: string; launcher: string; log: string }) {
 const root = fresh('npm-global-');
 const home = join(root, 'home'), tmp = join(root, 'tmp'), fake = join(root, 'fake');
 for (const dir of [join(home, '.pi/agent'), tmp, fake]) mkdirSync(dir, { recursive: true });
 writeFileSync(join(fake, 'pi'), '#!/bin/sh\necho "$@" >> "$HOME/pi.log"\n');
 chmodSync(join(fake, 'pi'), 0o755);
 const env = { HOME: home, TMPDIR: tmp, LANG: 'en_US.UTF-8', PATH: [fake, dirname(npmNode), '/usr/bin', '/bin'].join(delimiter) };
 const { bin, launcher: installedLauncher, log } = installPackage(env, root);
 transcript('package install', log);
 // An owned launcher left by an earlier curl install: install from the package removes it.
 const oldLauncher = installLauncher(home, npmNode, 'linux');
 const withBin = { ...env, PATH: `${dirname(bin)}${delimiter}${env.PATH}` };
 const envArgs = (vars: Record<string, string>) => Object.entries(vars).map(([key, value]) => `${key}=${value}`);
 const install = spawnSync('env', ['-i', ...envArgs(withBin), bin, 'install'], { encoding: 'utf8', input: '\ny\n', timeout: 120_000 });
 transcript('mars-ram install', install.stdout + install.stderr);
 expect(install.status).toBe(0);
 for (const copy of ['cli/src/main.ts', 'link-server/src/main.ts', 'pi-bridge/src/extension.ts', 'host.json']) expect(existsSync(join(home, '.mars-ram', copy))).toBe(true);
 expect(existsSync(oldLauncher)).toBe(false);
 expect(realpathSync(JSON.parse(readFileSync(join(home, '.mars-ram/install.json'), 'utf8')).packageBin)).toBe(realpathSync(installedLauncher));
 expect(readFileSync(join(home, 'pi.log'), 'utf8')).toContain(`install ${join(home, '.mars-ram/pi-bridge')}`);
 // The installed copy carries the fingerprint the launcher pins, so later commands run it directly.
 const launcher = readFileSync(installedLauncher, 'utf8');
 expect(launcher).toContain(`const CLI_FINGERPRINT = '${readFileSync(join(home, '.mars-ram/cli/fingerprint.sha256'), 'utf8').trim()}';`);
 const doctor = spawnSync('env', ['-i', ...envArgs(withBin), bin, 'doctor'], { encoding: 'utf8', timeout: 120_000 });
 transcript(`mars-ram doctor through the package bin (exit ${doctor.status})`, doctor.stdout + doctor.stderr);
 expect(doctor.stdout).toContain('CLI copy matches current sources.');
 expect(doctor.stdout).toContain(`ok: mars-ram on PATH: ${bin}\n`);
 expect(doctor.stdout).not.toContain('.local/bin');
 // ~/.local/bin first on PATH changes nothing: install left no launcher there.
 const localFirst = spawnSync('env', ['-i', ...envArgs({ ...withBin, PATH: `${join(home, '.local/bin')}${delimiter}${withBin.PATH}` }), 'mars-ram', 'doctor'], { encoding: 'utf8', timeout: 120_000 });
 transcript(`mars-ram doctor with ~/.local/bin first (exit ${localFirst.status})`, localFirst.stdout + localFirst.stderr);
 expect(localFirst.stdout).toContain(`ok: mars-ram on PATH: ${bin}\n`);
 const uninstall = spawnSync('env', ['-i', ...envArgs(withBin), bin, 'uninstall'], { encoding: 'utf8', input: 'y\n', timeout: 120_000 });
 transcript(`mars-ram uninstall (exit ${uninstall.status})`, uninstall.stdout + uninstall.stderr);
 expect(uninstall.status).toBe(0);
 expect(uninstall.stdout).toContain('pnpm remove -g mars-ram');
 expect(existsSync(join(home, '.mars-ram/cli'))).toBe(false);
 expect(existsSync(installedLauncher)).toBe(true);
 for (const output of [install, doctor, localFirst, uninstall]) expect(output.stdout + output.stderr).not.toContain('ExperimentalWarning');
 expect(readdirSync(tmp).filter(name => name.startsWith('mars-ram-'))).toEqual([]);
}

describe.skipIf(!existsSync(npmCli))('npm install -g from the local package', () => {
 it('installs the bin, and mars-ram install and doctor work through it', () => {
  realInstall((env, root) => {
   const prefix = join(root, 'prefix');
   const log = execFileSync('env', ['-i', ...Object.entries({ ...env, npm_config_cache: join(root, 'npm-cache') }).map(([key, value]) => `${key}=${value}`), npmNode, npmCli, 'install', '-g', '--prefix', prefix, '--offline', '--no-audit', '--no-fund', '--no-update-notifier', tgz()], { encoding: 'utf8', cwd: root });
   const bin = join(prefix, 'bin/mars-ram');
   return { bin, launcher: realpathSync(bin), log };
  });
 }, 240_000);
});

describe.skipIf(!pnpmBinary)('pnpm add -g from the local package', () => {
 it('installs the bin, and mars-ram install and doctor work through it', () => {
  realInstall((env, root) => {
   const pnpmHome = join(root, 'pnpm-home');
   const vars = { ...env, PNPM_HOME: pnpmHome, XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), PATH: `${join(pnpmHome, 'bin')}${delimiter}${env.PATH}` };
   const log = execFileSync('env', ['-i', ...Object.entries(vars).map(([key, value]) => `${key}=${value}`), pnpmBinary!, 'add', '-g', '--offline', tgz()], { encoding: 'utf8', cwd: root });
   // pnpm 11 links global bins into $PNPM_HOME/bin as shell shims that name their target.
   const bin = join(pnpmHome, 'bin/mars-ram');
   const launcher = /^# cmd-shim-target=(.+)$/m.exec(readFileSync(bin, 'utf8'))?.[1];
   expect(launcher).toMatch(/node_modules\/mars-ram\/bin\/mars-ram\.mjs$/);
   return { bin, launcher: launcher!, log };
  });
 }, 240_000);
});
