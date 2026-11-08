#!/usr/bin/env node
// mars-ram npm launcher. Node refuses to strip TypeScript types under node_modules, so this package carries the
// release archive and runs it from a private temporary folder, as install.sh does. Node built-ins only; rendered by
// host/cli/scripts/build-release.ts, which writes the version, the archive SHA-256 and the CLI fingerprint below.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { constants, homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const VERSION = '@MARS_RAM_VERSION@';
const ARCHIVE_SHA256 = '@MARS_RAM_SHA256@';
const CLI_FINGERPRINT = '@MARS_RAM_CLI_FINGERPRINT@';

// Same locale rule as the CLI (host/cli/src/adapters/terminal.ts); an empty variable counts as unset.
const spanish = (process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale).toLowerCase().startsWith('es');
const say = (en, es) => spanish ? es : en;
function fail(message) {
 process.stderr.write(`${message}\n`);
 process.exit(1);
}

const args = process.argv.slice(2);
const packageRoot = join(import.meta.dirname, '..');

// The copy `mars-ram install` wrote runs directly when it is this package's CLI; install and uninstall always run
// from the package, so they never replace or remove the code that is running them.
function installedMain() {
 if (args[0] === 'install' || args[0] === 'uninstall') return undefined;
 const cli = join(homedir(), '.mars-ram', 'cli');
 try {
  if (readFileSync(join(cli, 'fingerprint.sha256'), 'utf8').trim() !== CLI_FINGERPRINT) return undefined;
  // Two releases may share source bytes; never run another release's installed metadata.
  if (readFileSync(join(cli, 'VERSION'), 'utf8').trim() !== VERSION) return undefined;
  const main = join(cli, 'src', 'main.ts'), stat = lstatSync(main);
  return stat.isFile() && !stat.isSymbolicLink() ? main : undefined;
 } catch { return undefined; }
}

// Checks the embedded archive against the SHA-256 pinned at build time, then unpacks the checked bytes (not the file
// again) into a new folder only this user can read.
function extract() {
 const name = `mars-ram-${VERSION}`;
 const bytes = readFileSync(join(packageRoot, 'archive', `${name}.tar.gz`));
 const actual = createHash('sha256').update(bytes).digest('hex');
 if (actual !== ARCHIVE_SHA256) fail(say(
  `The mars-ram package is damaged: its archive does not match the expected SHA-256.\nExpected: ${ARCHIVE_SHA256}\nActual:   ${actual}\nNothing was run. Reinstall it: pnpm add -g mars-ram (or npm i -g mars-ram).`,
  `El paquete mars-ram está dañado: su archivo no coincide con el SHA-256 esperado.\nEsperado: ${ARCHIVE_SHA256}\nObtenido: ${actual}\nNo se ejecutó nada. Instalalo de nuevo: pnpm add -g mars-ram (o npm i -g mars-ram).`));
 const dir = mkdtempSync(join(tmpdir(), 'mars-ram-'));
 try {
  writeFileSync(join(dir, 'archive.tar.gz'), bytes, { mode: 0o600, flag: 'wx' });
  // Windows 10+ ships bsdtar as System32\tar.exe; name it so an earlier tar on PATH is never picked.
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  // Relative names with cwd: GNU tar would read "C:\..." as a remote host.
  execFileSync(tar, ['-xzf', 'archive.tar.gz'], { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'], shell: false, windowsHide: true });
  rmSync(join(dir, 'archive.tar.gz'));
 } catch (error) {
  rmSync(dir, { recursive: true, force: true });
  fail(say(`mars-ram could not unpack its files: ${error.message}`, `mars-ram no pudo descomprimir sus archivos: ${error.message}`));
 }
 return { main: join(dir, name, 'cli', 'src', 'main.ts'), dir };
}

// Signal handlers come first, before the archive is unpacked: a SIGTERM or SIGHUP that arrives during startup then waits
// for the synchronous unpacking, reaches the CLI as soon as it starts, and the temporary copy is still removed. Only
// SIGKILL leaves it behind. Ctrl+C reaches the whole process group, so the CLI gets it directly and decides; this
// process only waits. Signals sent to this process alone are passed on.
let child, dir;
const cleanup = () => { if (dir) rmSync(dir, { recursive: true, force: true }); };
const forward = signal => {
 if (child) child.kill(signal);
 else { cleanup(); process.exit(128 + (constants.signals[signal] ?? 0)); }
};
const handlers = { SIGINT: () => {}, SIGTERM: forward, SIGHUP: forward };
for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler);

const installed = installedMain();
let main = installed;
if (!installed) ({ main, dir } = extract());

// MARS_RAM_PACKAGE_BIN tells `mars-ram install` that this package's bin is the command, so it writes no launcher of
// its own (one earlier on PATH would keep running the old version).
child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', main, ...args], { stdio: 'inherit', shell: false, env: { ...process.env, MARS_RAM_PACKAGE_BIN: import.meta.filename } });
child.on('error', error => {
 cleanup();
 fail(say(`mars-ram could not start Node: ${error.message}`, `mars-ram no pudo iniciar Node: ${error.message}`));
});
child.on('exit', (code, signal) => {
 cleanup();
 for (const [name, handler] of Object.entries(handlers)) process.off(name, handler);
 if (signal) {
  // End the same way, so a calling shell sees the signal.
  process.kill(process.pid, signal);
  process.exit(128 + (constants.signals[signal] ?? 0));
 }
 process.exit(code ?? 1);
});
