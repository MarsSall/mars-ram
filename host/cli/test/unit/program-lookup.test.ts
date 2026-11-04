import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findPrograms, installedProgram } from '../../src/adapters/repos.ts';

// Over SSH the PATH is often the non-interactive one, without ~/Library/pnpm/bin and the like.
describe.skipIf(process.platform === 'win32')('program lookup', () => {
 let dir: string;
 const tool = async (name: string, mode = 0o755) => { const file = join(dir, 'bin', name); await writeFile(file, '#!/bin/sh\n'); await chmod(file, mode); return file; };
 beforeEach(async () => { dir = await realpath(await mkdtemp(join(tmpdir(), 'mr-programs-'))); await mkdir(join(dir, 'bin')); });
 afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

 it('records the absolute paths of the allowlisted programs found on the install PATH', async () => {
  const pi = await tool('pi'); await tool('opencode'); await tool('rm');
  expect(await findPrograms(join(dir, 'bin'))).toEqual({ pi, opencode: join(dir, 'bin', 'opencode') });
 });

 it('finds a program through its recorded path when the SSH PATH lacks it', async () => {
  const pi = await tool('pi');
  expect(await installedProgram('pi', { pi }, '/usr/bin:/bin')).toBe(true);
 });

 it('does not find a program whose recorded path was deleted, is not executable or is a folder', async () => {
  const pi = await tool('pi', 0o644);
  expect(await installedProgram('pi', { pi }, '/usr/bin:/bin')).toBe(false);
  expect(await installedProgram('pi', { pi: join(dir, 'gone') }, '/usr/bin:/bin')).toBe(false);
  expect(await installedProgram('pi', { pi: join(dir, 'bin') }, '/usr/bin:/bin')).toBe(false);
 });

 it('ignores a recorded path for another program and malformed records', async () => {
  const opencode = await tool('opencode');
  expect(await installedProgram('pi', { opencode }, '/usr/bin:/bin')).toBe(false);
  expect(await installedProgram('pi', { pi: 'relative/pi' }, '/usr/bin:/bin')).toBe(false);
  expect(await installedProgram('pi', 'not an object', '/usr/bin:/bin')).toBe(false);
 });

 it('never reports a program outside the allowlist, through PATH or a record', async () => {
  const sh = await tool('sh');
  for (const name of ['sh', '__proto__', 'constructor', 'PI']) {
   expect(await installedProgram(name as 'pi', JSON.parse(`{"${name}":"${sh}"}`), join(dir, 'bin'))).toBe(false);
  }
 });

 it('still finds a program on PATH without any record', async () => {
  await tool('pi');
  expect(await installedProgram('pi', undefined, join(dir, 'bin'))).toBe(true);
 });
});
