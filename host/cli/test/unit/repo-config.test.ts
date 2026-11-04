import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepoConfig, createRepoFiles } from '../../src/adapters/repos.ts';
import { scanRepos } from '../../src/core/repos.ts';

// Real filesystem: these are the configuration and root rules the docs promise.
describe('repo roots configuration', () => {
 let home: string;
 const config = () => createRepoConfig(home, createRepoFiles());
 const writeConfig = (text: string) => mkdir(join(home, '.mars-ram'), { recursive: true }).then(() => writeFile(join(home, '.mars-ram', 'host.json'), text));
 beforeEach(async () => { home = await realpath(await mkdtemp(join(tmpdir(), 'mr-roots-'))); });
 afterEach(async () => { await rm(home, { recursive: true, force: true }); });

 it('uses ~/Work when host.json does not exist', async () => {
  await mkdir(join(home, 'Work'));
  expect(await config().roots()).toEqual([join(home, 'Work')]);
 });

 it('has no roots when host.json does not exist and ~/Work does not either', async () => {
  expect(await config().roots()).toEqual([]);
 });

 it('rejects a malformed host.json instead of falling back to ~/Work', async () => {
  await mkdir(join(home, 'Work'));
  for (const text of ['{not json', '[]', '{"repoRoots":"~/Work"}', '{"repoRoots":["relative/path"]}']) {
   await writeConfig(text);
   await expect(config().roots()).rejects.toThrow();
  }
 });

 it('disables discovery with an explicit empty repoRoots', async () => {
  await mkdir(join(home, 'Work', 'app', '.git'), { recursive: true });
  await writeConfig('{"repoRoots":[]}');
  const roots = await config().roots();
  expect(roots).toEqual([]);
  expect((await scanRepos(roots, createRepoFiles())).repos).toEqual([]);
 });

 it('resolves a configured root that is a symlink, but skips directory links below a root', async () => {
  const target = join(home, 'real-work');
  await mkdir(join(target, 'app', '.git'), { recursive: true });
  await mkdir(join(home, 'elsewhere', 'outside', '.git'), { recursive: true });
  await symlink(target, join(home, 'Work'));
  await symlink(join(home, 'elsewhere'), join(target, 'linked'));
  const { repos } = await scanRepos([join(home, 'Work')], createRepoFiles());
  expect(repos).toEqual([{ path: join(target, 'app'), name: 'app', root: target }]);
 });
});
