import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArguments } from '../../src/arguments.ts';
import { buildCliCopy } from '../../src/adapters/cli-installation.ts';
import { readRelease } from '../../src/adapters/release-version.ts';

const roots: string[] = [];
const fresh = () => { const root = mkdtempSync(join(tmpdir(), 'host-version-')); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('accepts only version and version --json', () => {
 expect(parseArguments(['version'])).toEqual({ ok: true, command: 'version', json: false });
 expect(parseArguments(['version', '--json'])).toEqual({ ok: true, command: 'version', json: true });
 for (const args of [['version', 'extra'], ['version', '--json', '--json']]) expect(parseArguments(args)).toEqual({ ok: false });
});
it('reports dev without metadata and rejects malformed or oversized release metadata', () => {
 const root = fresh();
 expect(readRelease(root)).toBe('dev');
 for (const value of ['0.1.4\n', 'dev\n', '0.1.4;evil', 'x'.repeat(1000)]) {
  writeFileSync(join(root, 'VERSION'), value);
  expect(readRelease(root)).toBe(value === '0.1.4\n' ? '0.1.4' : 'dev');
 }
});
it('the installed entry reports the embedded release in bounded one-line JSON and plain text', () => {
 const root = fresh();
 buildCliCopy(root, '0.1.4');
 expect(readFileSync(join(root, 'cli/VERSION'), 'utf8').trim()).toBe('0.1.4');
 const run = (...args: string[]) => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(root, 'cli/src/main.ts'), 'version', ...args], { encoding: 'utf8', shell: false });
 expect(run('--json')).toBe('{"version":1,"release":"0.1.4"}\n');
 expect(run()).toBe('0.1.4\n');
 // Reinstalling from the archive's CLI copy preserves its release, with no npm launcher environment.
 const installed = fresh();
 execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', `import { buildCliCopy } from ${JSON.stringify(pathToFileURL(join(root, 'cli/src/adapters/cli-installation.ts')).href)}; buildCliCopy(${JSON.stringify(installed)});`], { shell: false });
 expect(readFileSync(join(installed, 'cli/VERSION'), 'utf8')).toBe('0.1.4\n');
});
