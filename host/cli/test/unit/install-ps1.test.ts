// install.ps1 rendered by buildRelease. No PowerShell here: static checks only; real runs happen on a Windows host.
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildRelease } from '../../scripts/build-release.ts';

const temporary: string[] = [];
const fresh = (prefix: string) => { const dir = mkdtempSync(join(tmpdir(), prefix)); temporary.push(dir); return dir; };
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });

let release: string;
let sha256: string;
let script: string;
beforeAll(() => {
 release = mkdtempSync(join(tmpdir(), 'install-ps1-release-'));
 ({ sha256 } = buildRelease('1.2.3', release));
 script = readFileSync(join(release, 'install.ps1'), 'utf8');
}, 60_000);
afterAll(() => rmSync(release, { recursive: true, force: true }));

// Code lines only: drops `#` comment lines and the leading <# ... #> help block.
const code = () => script.replace(/<#[\s\S]*?#>/g, '').split('\n').filter(line => !line.trimStart().startsWith('#'));

describe('rendered install.ps1', () => {
 it('embeds the version and the archive checksum and leaves no placeholder', () => {
  expect(sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(script).toContain(`$version = '1.2.3'`);
  expect(script).toContain(`$sha256 = '${sha256}'`);
  expect(script).not.toContain('@MARS_RAM_');
 });

 it('downloads the pinned release by default and lets MARS_RAM_DOWNLOAD_URL replace it', () => {
  expect(script).toContain('https://github.com/MarsSall/mars-ram/releases/download/v$version/mars-ram-$version.tar.gz');
  expect(script).toContain('$env:MARS_RAM_DOWNLOAD_URL');
 });

 it('never closes the console it runs in through irm | iex', () => {
  const offending = code().filter(line => /\bexit\b/i.test(line));
  expect(offending).toEqual([]);
  expect(script).not.toMatch(/#Requires/i);
  expect(script.trimEnd().split('\n').at(-1)).toBe('Install-MarsRam');
 });

 it('is plain ASCII so Windows PowerShell 5.1 reads it the same from a file or from irm', () => {
  expect([...script].filter(char => char.charCodeAt(0) > 0x7e && char !== '\n')).toEqual([]);
 });

 it('verifies the SHA-256 before unpacking and refuses an elevated session', () => {
  expect(script).toContain('Get-FileHash');
  expect(script.indexOf('Get-FileHash')).toBeLessThan(script.indexOf('-xzf $archive'));
  expect(script).toContain('S-1-16-12288');
 });

 it('points to mars-ram pair only when the launcher exists after install', () => {
  const launcher = script.indexOf("Join-Path $env:USERPROFILE '.mars-ram\\bin\\mars-ram.cmd'");
  expect(launcher).toBeGreaterThan(-1);
  expect(script.indexOf('Now open a new terminal and run: mars-ram pair')).toBeGreaterThan(launcher);
  expect(script).toContain("'mars-ram was not installed. Run this command again when you are ready.'");
 });

 it('buildRelease refuses an existing install.ps1 and writes nothing', () => {
  const out = fresh('install-ps1-exists-');
  writeFileSync(join(out, 'install.ps1'), 'existing script');
  expect(() => buildRelease('1.0.0', out)).toThrow(/install\.ps1 already exists/);
  expect(readFileSync(join(out, 'install.ps1'), 'utf8')).toBe('existing script');
  expect(readdirSync(out)).toEqual(['install.ps1']);
 });
});
