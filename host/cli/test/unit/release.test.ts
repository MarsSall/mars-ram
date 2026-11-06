import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRelease } from '../../scripts/build-release.ts';

const temporary: string[] = [];
const fresh = (prefix: string) => { const dir = mkdtempSync(join(tmpdir(), prefix)); temporary.push(dir); return dir; };
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('release archive, install.sh, install.ps1 and the npm package (temporary output only; nothing published)', () => {
 it('packs cli, link-server, pi-bridge and VERSION under one folder with a sha256sum-format checksum', () => {
  const out = fresh('release-out-');
  const result = buildRelease('1.2.3', out);
  const archive = join(out, 'mars-ram-1.2.3.tar.gz');
  expect(result.archive).toBe(archive);
  expect(readdirSync(out).sort()).toEqual(['SHA256SUMS', 'install.ps1', 'install.sh', 'mars-ram-1.2.3.tar.gz', 'mars-ram-1.2.3.tgz']);
  const digest = sha256(readFileSync(archive));
  expect(result.sha256).toBe(digest);
  expect(readFileSync(join(out, 'SHA256SUMS'), 'utf8')).toBe(`${digest}  mars-ram-1.2.3.tar.gz\n`);

  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const entry of entries) {
   expect(entry.startsWith('mars-ram-1.2.3/')).toBe(true);
   expect(entry.split('/')).not.toContain('..');
   expect(entry).not.toContain('.pnpm');
   expect(entry).not.toContain('/test/');
  }
  for (const file of ['VERSION', 'cli/src/main.ts', 'cli/package.json', 'cli/protocol/src/index.ts', 'cli/node_modules/@workspace/protocol/src/index.js', 'cli/node_modules/typebox/package.json', 'cli/node_modules/uqr/package.json', 'pi-bridge/src/extension.ts', 'pi-bridge/package.json', 'link-server/src/main.ts', 'link-server/package.json'])
   expect(entries).toContain(`mars-ram-1.2.3/${file}`);
  // Long listing: first character is the type; only regular files and directories.
  const types = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8' }).split('\n').filter(Boolean).map(line => line[0]);
  expect(new Set(types)).toEqual(new Set(['-', 'd']));

  const extracted = fresh('release-extract-');
  execFileSync('tar', ['-xzf', archive, '-C', extracted]);
  expect(readFileSync(join(extracted, 'mars-ram-1.2.3/VERSION'), 'utf8')).toBe('1.2.3\n');
 });

 it('is reproducible byte for byte', () => {
  const first = buildRelease('0.1.0', fresh('release-a-'));
  const second = buildRelease('0.1.0', fresh('release-b-'));
  expect(readFileSync(second.archive).equals(readFileSync(first.archive))).toBe(true);
  expect(second.sha256).toBe(first.sha256);
 });

 it.each(['1.0', 'v1.0.0', '1.0.0-beta', ''])('rejects version %j and writes nothing', version => {
  const out = fresh('release-bad-');
  expect(() => buildRelease(version, out)).toThrow(`Invalid version "${version}"; use MAJOR.MINOR.PATCH.`);
  expect(readdirSync(out)).toEqual([]);
 });

 it('refuses to overwrite an existing archive', () => {
  const out = fresh('release-exists-');
  const archive = join(out, 'mars-ram-1.0.0.tar.gz');
  writeFileSync(archive, 'existing bytes');
  expect(() => buildRelease('1.0.0', out)).toThrow(/already exists/);
  expect(readFileSync(archive, 'utf8')).toBe('existing bytes');
  expect(readdirSync(out)).toEqual(['mars-ram-1.0.0.tar.gz']);
 });

 it('runs with only Node from an extraction outside the repository', () => {
  const { archive } = buildRelease('1.0.0', fresh('release-run-'));
  const extracted = fresh('release-node-');
  mkdirSync(join(extracted, 'x'));
  execFileSync('tar', ['-xzf', archive, '-C', join(extracted, 'x')]);
  const run = spawnSync(process.execPath, [join(extracted, 'x/mars-ram-1.0.0/cli/src/main.ts')], { encoding: 'utf8', cwd: extracted });
  expect(run.status).toBe(2);
  expect(run.stderr.startsWith('Usage: mars-ram pair')).toBe(true);
 });
});
