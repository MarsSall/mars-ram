// install.sh rendered by buildRelease, run with sh/dash under `env -i` in a temporary HOME. Pi is a fake that only logs.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildRelease } from '../../scripts/build-release.ts';

const temporary: string[] = [];
const fresh = (prefix: string) => { const dir = mkdtempSync(join(tmpdir(), prefix)); temporary.push(dir); return dir; };
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const which = (name: string) => ['/usr/bin', '/bin'].map(dir => join(dir, name)).find(path => existsSync(path));
// sh is dash on Debian/Ubuntu; bash --posix stands in for macOS /bin/sh.
const shells = ([['sh', which('sh'), []], ['dash', which('dash'), []], ['bash --posix', which('bash'), ['--posix']]] as const)
 .filter(([, path]) => path !== undefined).map(([name, path, flags]) => [name, [path as string, ...flags]] as [string, string[]]);
const realCurl = which('curl');

let release: string;
let archive: string;
let sha256: string;
beforeAll(() => {
 release = mkdtempSync(join(tmpdir(), 'install-script-release-'));
 ({ archive, sha256 } = buildRelease('1.2.3', release));
}, 60_000);
afterAll(() => rmSync(release, { recursive: true, force: true }));

const fakeProgram = (dir: string, name: string, body: string) => {
 writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
 chmodSync(join(dir, name), 0o755);
};

interface Run { status: number | null; stdout: string; stderr: string; home: string; tmp: string; piLog: string; curlLog: string }

function run(shell: string[], options: { url?: string; lang?: string; pi?: boolean; oldNode?: boolean; piHome?: boolean; answers?: string } = {}): Run {
 const root = fresh('install-script-run-');
 const home = join(root, 'home'), bin = join(root, 'bin'), nodeBin = join(root, 'node'), tmp = join(root, 'tmp');
 for (const dir of [home, bin, nodeBin, tmp]) mkdirSync(dir);
 if (options.piHome !== false) mkdirSync(join(home, '.pi/agent'), { recursive: true });
 // Only Node in its own folder: the Node install folder may hold other programs (even pi).
 symlinkSync(process.execPath, join(nodeBin, 'node'));
 const piLog = join(root, 'pi.log'), curlLog = join(root, 'curl.log');
 if (options.pi !== false) fakeProgram(bin, 'pi', `printf '%s\\n' "$*" >> '${piLog}'`);
 if (realCurl) fakeProgram(bin, 'curl', `printf '%s\\n' "$*" >> '${curlLog}'\nexec '${realCurl}' "$@"`);
 if (options.oldNode) fakeProgram(bin, 'node', `if [ "$1" = -p ]; then echo 22.0.0; exit 0; fi\nexec '${process.execPath}' "$@"`);
 const input = join(root, 'input');
 writeFileSync(input, options.answers ?? '\ny\n');
 const vars = [`HOME=${home}`, `PATH=${bin}:${nodeBin}:/usr/bin:/bin`, `TMPDIR=${tmp}`, `MARS_RAM_DOWNLOAD_URL=${options.url ?? `file://${archive}`}`, `MARS_RAM_INPUT=${input}`];
 if (options.lang) vars.push(`LANG=${options.lang}`);
 const result = spawnSync('/usr/bin/env', ['-i', ...vars, ...shell, join(release, 'install.sh')], { encoding: 'utf8', cwd: root, timeout: 60_000 });
 return { status: result.status, stdout: result.stdout, stderr: result.stderr, home, tmp, piLog, curlLog };
}

function tampered(): string {
 const dir = fresh('install-script-bad-');
 const copy = join(dir, 'mars-ram-1.2.3.tar.gz');
 const bytes = readFileSync(archive);
 bytes[bytes.length - 10] = bytes[bytes.length - 10]! ^ 0xff;
 writeFileSync(copy, bytes);
 return copy;
}
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

describe('rendered install.sh', () => {
 it('embeds the version and the archive checksum and leaves no placeholder', () => {
  const script = readFileSync(join(release, 'install.sh'), 'utf8');
  expect(sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(script).toContain(`version='1.2.3'`);
  expect(script).toContain(`sha256='${sha256}'`);
  expect(script).not.toContain('@MARS_RAM_');
  expect(script.trimEnd().split('\n').at(-1)).toBe('main "$@"');
  expect(readFileSync(join(release, 'SHA256SUMS'), 'utf8')).toBe(`${sha256}  mars-ram-1.2.3.tar.gz\n`);
 });

 it('buildRelease refuses an existing install.sh and writes nothing', () => {
  const out = fresh('install-script-exists-');
  writeFileSync(join(out, 'install.sh'), 'existing script');
  expect(() => buildRelease('1.0.0', out)).toThrow(/install\.sh already exists/);
  expect(readFileSync(join(out, 'install.sh'), 'utf8')).toBe('existing script');
  expect(readdirSync(out)).toEqual(['install.sh']);
 });

 describe.each(shells)('with %s', (_name, shell) => {
  it('installs from a verified download into HOME and points to mars-ram pair', () => {
   const result = run(shell);
   expect(result.stderr).not.toContain('ExperimentalWarning');
   expect(result.stdout).not.toContain('ExperimentalWarning');
   expect(result.status).toBe(0);
   for (const dir of ['cli', 'link-server', 'pi-bridge']) expect(existsSync(join(result.home, '.mars-ram', dir))).toBe(true);
   expect(existsSync(join(result.home, '.local/bin/mars-ram'))).toBe(true);
   expect(readFileSync(result.piLog, 'utf8')).toContain(`install ${join(result.home, '.mars-ram/pi-bridge')}`);
   expect(result.stdout.trimEnd().endsWith('Now run: mars-ram pair')).toBe(true);
   expect(readdirSync(result.tmp)).toEqual([]);
  }, 60_000);

  it('refuses an archive whose checksum differs and installs nothing', () => {
   const bad = tampered();
   const result = run(shell, { url: `file://${bad}` });
   expect(result.status).toBe(1);
   expect(result.stderr).toContain(`The download does not match the expected checksum. Nothing was installed.\n  expected: ${sha256}\n  actual:   ${digest(bad)}`);
   expect(existsSync(join(result.home, '.mars-ram'))).toBe(false);
   expect(existsSync(result.piLog)).toBe(false);
   expect(readdirSync(result.tmp)).toEqual([]);
  }, 60_000);

  it('explains the mismatch in Spanish', () => {
   const bad = tampered();
   const result = run(shell, { url: `file://${bad}`, lang: 'es_AR.UTF-8' });
   expect(result.status).toBe(1);
   expect(result.stderr).toContain(`La descarga no coincide con la suma de verificación esperada. No se instaló nada.\n  esperada: ${sha256}\n  obtenida: ${digest(bad)}`);
   expect(existsSync(join(result.home, '.mars-ram'))).toBe(false);
  }, 60_000);

  it('stops before downloading when Node is older than 24', () => {
   const result = run(shell, { oldNode: true });
   expect(result.status).toBe(1);
   expect(result.stderr).toContain('mars-ram needs Node.js 24 or newer; this computer has 22.0.0. Update it from https://nodejs.org and run this again.');
   expect(existsSync(result.curlLog)).toBe(false);
   expect(existsSync(join(result.home, '.mars-ram'))).toBe(false);
   expect(readdirSync(result.tmp)).toEqual([]);
  }, 60_000);

  it('does not point to mars-ram pair when the person cancels a first install', () => {
   const result = run(shell, { answers: '\nn\n' });
   expect(result.status).toBe(0);
   expect(existsSync(join(result.home, '.local/bin/mars-ram'))).toBe(false);
   expect(result.stdout).not.toContain('mars-ram pair');
   expect(result.stdout.trimEnd().endsWith('mars-ram was not installed. Run this command again when you are ready.')).toBe(true);
   expect(readdirSync(result.tmp)).toEqual([]);
  }, 60_000);

  it('warns about a missing pi, still runs install and returns its exit code', () => {
   const result = run(shell, { pi: false, piHome: false });
   expect(result.stderr).toContain('Warning: pi was not found. mars-ram works with Pi: install it from https://pi.dev, then run mars-ram install again.');
   expect(result.stdout).toContain('mars-ram doctor');
   expect(existsSync(result.curlLog)).toBe(true);
   // install itself refuses without pi and changes nothing; the script passes its exit code through.
   expect(result.stderr).toContain('pi was not found on PATH. Install Pi and try again; nothing changed.');
   expect(result.status).toBe(1);
   expect(result.stdout).not.toContain('mars-ram pair');
   expect(readdirSync(result.tmp)).toEqual([]);
  }, 60_000);
 });

 it('without a terminal and without MARS_RAM_INPUT explains how to run it from a file', () => {
  const root = fresh('install-script-notty-');
  const home = join(root, 'home'), bin = join(root, 'bin'), tmp = join(root, 'tmp');
  for (const dir of [home, bin, tmp]) mkdirSync(dir);
  symlinkSync(process.execPath, join(bin, 'node'));
  fakeProgram(bin, 'pi', 'exit 0');
  // setsid: a new session without a controlling terminal, so /dev/tty cannot be opened.
  const result = spawnSync('setsid', ['/usr/bin/env', '-i', `HOME=${home}`, `PATH=${bin}:/usr/bin:/bin`, `TMPDIR=${tmp}`, `MARS_RAM_DOWNLOAD_URL=file://${archive}`, 'sh', join(release, 'install.sh')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('curl -fsSL https://marssall.github.io/mars-ram/install.sh -o install.sh');
  expect(result.stderr).toContain('sh install.sh');
  expect(existsSync(join(home, '.mars-ram'))).toBe(false);
  expect(readdirSync(tmp)).toEqual([]);
 }, 60_000);
});
