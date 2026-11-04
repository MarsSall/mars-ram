import { describe, expect, it } from 'vitest';
import { scanRepos, allowedRepo, type RepoFiles } from '../../src/core/repos.ts';

import { fakeFiles } from './fixtures/repo-files.ts';
const tree = () => fakeFiles({ '/work': 'dir', '/work/z': 'dir', '/work/z/.git': 'file', '/work/a': 'dir', '/work/a/.git': 'dir', '/work/a/nested': 'dir', '/work/a/nested/.git': 'dir', '/work/.hidden': 'dir', '/work/.hidden/.git': 'dir', '/work/node_modules': 'dir', '/work/node_modules/.git': 'dir', '/work/link': 'link', '/work/plain': 'dir', '/work/plain/deep': 'dir', '/work/plain/deep/repo': 'dir', '/work/plain/deep/repo/.git': 'dir', '/work/plain/deep/other': 'dir', '/work/plain/deep/other/too-deep': 'dir', '/work/plain/deep/other/too-deep/.git': 'dir' });
describe('repository confinement', () => {
 it('permits root editing only in local interactive terminals', async () => {
  const { localRootEdit } = await import('../../src/adapters/repos.ts');
  expect(localRootEdit({}, true)).toBe(true);
  expect(localRootEdit({}, false)).toBe(false);
  for (const key of ['SSH_CONNECTION', 'SSH_CLIENT', 'SSH_TTY']) expect(localRootEdit({ [key]: 'present' }, true)).toBe(false);
 });
 it('rejects symlink aliases and .git links', async () => {
  const files = fakeFiles({ '/work': 'dir', '/work/a': 'dir', '/work/a/.git': 'link', '/alias': 'link' }, { '/alias': '/work/a' });
  expect((await scanRepos(['/work'], files)).repos).toEqual([]);
  expect(await allowedRepo('/alias', ['/work'], files)).toBeNull();
 });
 it('orders repos, stops at repos, skips hidden/dependencies/links and limits depth to three', async () => {
  expect((await scanRepos(['/work'], tree())).repos.map(r => r.path)).toEqual(['/work/a', '/work/plain/deep/repo', '/work/z']);
 });
 it('caps results deterministically at 500', async () => {
  const entries: Record<string, 'dir'> = { '/work': 'dir' };
  for (let i = 0; i < 510; i++) { entries[`/work/r${i}`] = 'dir'; entries[`/work/r${i}/.git`] = 'dir'; }
  const result = await scanRepos(['/work'], fakeFiles(entries));
  expect(result.repos).toHaveLength(500); expect(result.truncated).toBe(true);
 });
 it.each(['/outside', '/work/plain', '/work/../work/a', 'relative', '/work/link'])('rejects %s', async path => {
  expect(await allowedRepo(path, ['/work'], tree())).toBeNull();
 });
 it('rejects a directory realpath escaping the root', async () => {
  const files = fakeFiles({ '/work': 'dir', '/work/escape': 'dir', '/work/escape/.git': 'dir' }, { '/work/escape': '/outside' });
  expect((await scanRepos(['/work'], files)).repos).toEqual([]);
 });
 it('deduplicates overlapping roots', async () => {
  expect((await scanRepos(['/work', '/work/a'], tree())).repos.filter(r => r.path === '/work/a')).toHaveLength(1);
 });
 it('applies depth independently to overlapping roots in either order', async () => {
  const files = fakeFiles({ '/w': 'dir', '/w/a': 'dir', '/w/a/b': 'dir', '/w/a/b/c': 'dir', '/w/a/b/c/d': 'dir', '/w/a/b/c/d/e': 'dir', '/w/a/b/c/d/e/.git': 'dir', '/w/a/b/near': 'dir', '/w/a/b/near/.git': 'dir' });
  const first = await scanRepos(['/w', '/w/a/b'], files);
  const second = await scanRepos(['/w/a/b', '/w'], files);
  expect(first).toEqual(second);
  expect(first.repos.map(r => r.path)).toEqual(['/w/a/b/c/d/e', '/w/a/b/near']);
 });
 it('uses platform path semantics for Windows', async () => {
  const { win32 } = await import('node:path');
  const files: RepoFiles = { ...tree(), absolute: win32.isAbsolute, join: win32.join, name: win32.basename, key: p => p.toLowerCase(), within: (r, p) => !win32.relative(r, p).startsWith('..') && !win32.isAbsolute(win32.relative(r, p)), realpath: async p => p, kind: async p => p === 'C:\\Work\\.git' ? null : p.endsWith('.git') ? 'file' : 'dir', list: async p => p === 'C:\\Work' ? ['Repo'] : [] };
  expect((await scanRepos(['C:\\Work'], files)).repos).toEqual([{ path: 'C:\\Work\\Repo', name: 'Repo', root: 'C:\\Work' }]);
 });
});
