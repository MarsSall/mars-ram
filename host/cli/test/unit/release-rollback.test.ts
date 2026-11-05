import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

// A write that fails halfway (disk full, I/O error) must not leave a partial file behind.
let failOn: RegExp | undefined;
vi.mock('node:fs', async original => {
 const fs = await original<typeof import('node:fs')>();
 const writeFileSync: typeof fs.writeFileSync = (path, data, options) => {
  if (failOn && typeof path === 'string' && failOn.test(path)) {
   fs.writeFileSync(path, 'partial', options);
   throw Object.assign(new Error('EIO: i/o error, write'), { code: 'EIO' });
  }
  fs.writeFileSync(path, data, options);
 };
 return { ...fs, default: { ...fs, writeFileSync }, writeFileSync };
});

const { buildRelease } = await import('../../scripts/build-release.ts');
const dirs: string[] = [];
afterEach(() => { failOn = undefined; for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it.each([
 ['the archive', /\.tar\.gz$/],
 ['SHA256SUMS', /SHA256SUMS$/],
 ['install.ps1', /install\.ps1$/],
])('removes every output, including a partially written %s, when a write fails', (_name, pattern) => {
 const out = mkdtempSync(join(tmpdir(), 'mr-release-rollback-'));
 dirs.push(out);
 failOn = pattern;

 expect(() => buildRelease('0.0.9', out)).toThrow('EIO');
 expect(readdirSync(out)).toEqual([]);
});
