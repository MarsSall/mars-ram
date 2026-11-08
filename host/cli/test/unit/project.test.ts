import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, readdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runProcess } from '../../src/adapters/herdr-switcher.ts';
import { createProjectFiles } from '../../src/adapters/project.ts';
import { runProject, stagedName, workTreeOf, type ProjectDeps } from '../../src/core/project.ts';
import { projectCommand } from '../../src/project-command.ts';
import { parseArguments } from '../../src/arguments.ts';

let base: string; let repo: string; let staging: string;
const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
const signal = () => new AbortController().signal;
function deps(cwd = repo, extra: Partial<ProjectDeps> = {}): ProjectDeps {
 const herdr: Record<string, unknown> = {
  'workspace list': { workspaces: [{ workspace_id: 'w1', focused: false, active_tab_id: 'w1:t1' }, { workspace_id: 'w2', focused: true, active_tab_id: 'w2:t1' }] },
  'tab list --workspace w1': { tabs: [{ tab_id: 'w1:t1', focused: true }] },
  'tab list --workspace w2': { tabs: [{ tab_id: 'w2:t1', focused: true }] },
  'pane list': { panes: [{ tab_id: 'w1:t1', cwd: join(base, 'elsewhere') }, { tab_id: 'w2:t1', cwd }] },
 };
 return {
  herdr: '/usr/bin/herdr',
  run: async (file, args, options) => file === 'git' ? runProcess(file, args, options) : JSON.stringify({ result: herdr[args.join(' ')] }),
  files: createProjectFiles(staging), now: () => Date.UTC(2026, 9, 31, 12, 0, 0), random: () => 0.5, platform: process.platform, ...extra,
 };
}
const run = (args: string[], d = deps()) => runProject(args, d, signal());

beforeEach(() => {
 base = mkdtempSync(join(tmpdir(), 'mr-project-')); repo = join(base, 'mars-ram'); staging = join(base, 'staging');
 mkdirSync(join(repo, 'host', 'cli'), { recursive: true }); mkdirSync(staging); mkdirSync(join(base, 'elsewhere'));
 writeFileSync(join(repo, 'package.json'), '{"name":"mars-ram"}\n');
 writeFileSync(join(repo, 'host', 'cli', 'main.ts'), 'export const a = 1;\nexport const b = 2;\n');
 writeFileSync(join(repo, 'old.md'), 'old\n'); writeFileSync(join(repo, 'gone.md'), 'gone\n');
 git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'T'); git('config', 'commit.gpgsign', 'false');
 git('add', '.'); git('commit', '-q', '-m', 'first commit');
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('project arguments (L7)', () => {
 it('dispatches project from the CLI parser', () => {
  expect(parseArguments(['project', 'tree', '--path', 'host'])).toEqual({ ok: true, command: 'project', args: ['tree', '--path', 'host'] });
 });
 it.each([
  [[]], [['rm']], [['file']], [['show']], [['diff']], [['stage-link']],
  [['tree', '--path']], [['tree', '--workspace', 'x1']], [['tree', '--workspace', 'w1', '--workspace', 'w1']], [['status', '--path', 'a']],
  [['tree', '--path', '../x']], [['tree', '--path', '/etc']], [['tree', '--path', 'C:/x']], [['tree', '--path', 'a\\b']], [['tree', '--path', 'a//b']],
  [['tree', '--path', './a']], [['tree', '--path', '.git']], [['file', '--path', 'x/.GIT/config']], [['tree', '--path', 'a\u0007b']],
  [['file', '--path', 'GIT~1/config']], [['file', '--path', '.git./config']], [['file', '--path', '.git /config']], [['file', '--path', 'a.txt:stream']], [['diff', '--path', ':(glob)*.txt']],
  [['log', '--limit', '0']], [['log', '--limit', '101']], [['show', '--commit', 'zzzzzzz']], [['show', '--commit', 'abc']],
 ])('rejects %j as BAD_ARGUMENT without reading anything', async args => {
  let calls = 0;
  const d = deps(); const inner = d.run; d.run = async (...a) => { calls++; return inner(...a); };
  expect(await run(args, d)).toEqual({ version: 1, ok: false, code: 'BAD_ARGUMENT', message: expect.any(String) });
  expect(calls).toBe(0);
 });
});

describe('project --path-b64 (L10)', () => {
 const b64 = (text: string) => Buffer.from(text).toString('base64url');
 it('accepts the path as base64url so no remote shell can reinterpret it', async () => {
  writeFileSync(join(repo, "it's $HOME %PATH%.txt"), 'q');
  expect(await run(['file', '--path-b64', b64("it's $HOME %PATH%.txt")])).toMatchObject({ path: "it's $HOME %PATH%.txt", kind: 'text', content: 'q' });
 });
 it.each([[['file', '--path-b64', 'not base64!']], [['file', '--path-b64', b64('../x')]], [['file', '--path-b64', b64('a'), '--path', 'a']], [['file', '--path-b64', b64('a'), '--path-b64', b64('a')]]])('rejects %j', async args => {
  expect(await run(args)).toMatchObject({ ok: false, code: 'BAD_ARGUMENT' });
 });
});

describe('project root (L7)', () => {
 it('uses the focused workspace, or the named one; never a path from argv', async () => {
  expect(await run(['tree'])).toMatchObject({ root: { name: 'mars-ram', path: realpathSync(repo), workspace: 'w2', branch: 'main', git: true } });
  expect(await run(['tree', '--workspace', 'w1'])).toMatchObject({ root: { workspace: 'w1' } });
  expect(await run(['tree', '--workspace', 'w1'])).toMatchObject({ root: { name: 'elsewhere', branch: null, git: false } });
 });
 it('uses the git top-level when the pane sits in a subfolder', async () => {
  expect(await run(['tree'], deps(join(repo, 'host', 'cli')))).toMatchObject({ root: { name: 'mars-ram' }, path: '' });
 });
 it('reports a missing workspace, a missing Herdr and a bad pane cwd', async () => {
  expect(await run(['tree', '--workspace', 'w9'])).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect(await run(['tree'], deps(repo, { run: async () => { throw Object.assign(Error(), { code: 'ENOENT' }); } }))).toMatchObject({ ok: false, code: 'HERDR_NOT_FOUND' });
  expect(await run(['tree'], deps('relative/path'))).toMatchObject({ ok: false, code: 'NOT_FOUND' });
 });
});

describe('project tree and file (S2, L7)', () => {
 it('lists folders first, hides .git, reports kind, size and mtime', async () => {
  const result = await run(['tree']) as any;
  expect(result.entries.map((e: any) => [e.name, e.kind])).toEqual([['host', 'dir'], ['gone.md', 'file'], ['old.md', 'file'], ['package.json', 'file']]);
  expect(result.entries[3]).toMatchObject({ size: 20, mtime: expect.any(Number) });
  expect(result.entries[0].size).toBeNull();
  expect((await run(['tree', '--path', 'host/cli']) as any).entries.map((e: any) => e.name)).toEqual(['main.ts']);
 });
 it('caps a folder at 500 entries', async () => {
  mkdirSync(join(repo, 'many'));
  for (let i = 0; i < 501; i++) writeFileSync(join(repo, 'many', `f${i}`), '');
  const result = await run(['tree', '--path', 'many']) as any;
  expect(result.entries).toHaveLength(500); expect(result.truncated).toBe(true);
 });
 it('lists symlinks without following them, and refuses to read through one out of the root or into .git', async () => {
  writeFileSync(join(base, 'secret.txt'), 'secret');
  symlinkSync(join(base, 'secret.txt'), join(repo, 'out.txt'));
  symlinkSync(join(repo, '.git', 'config'), join(repo, 'cfg'));
  symlinkSync(join(repo, 'package.json'), join(repo, 'pkg'));
  expect((await run(['tree']) as any).entries.filter((e: any) => e.kind === 'link').map((e: any) => e.name)).toEqual(['cfg', 'out.txt', 'pkg']);
  expect(await run(['file', '--path', 'out.txt'])).toMatchObject({ ok: false, code: 'BAD_ARGUMENT' });
  expect(await run(['file', '--path', 'cfg'])).toMatchObject({ ok: false, code: 'BAD_ARGUMENT' });
  expect(await run(['stage-link', '--path', 'out.txt'])).toMatchObject({ ok: false, code: 'BAD_ARGUMENT' });
  expect(await run(['file', '--path', 'pkg'])).toMatchObject({ kind: 'text', content: '{"name":"mars-ram"}\n' });
 });
 it('returns text with its language, truncating at 256 KiB', async () => {
  expect(await run(['file', '--path', 'host/cli/main.ts'])).toEqual({ version: 1, path: 'host/cli/main.ts', size: 40, mtime: expect.any(Number), kind: 'text', language: 'typescript', content: 'export const a = 1;\nexport const b = 2;\n', truncated: false });
  writeFileSync(join(repo, 'big.txt'), 'x'.repeat(256 * 1024 + 10));
  expect(await run(['file', '--path', 'big.txt'])).toMatchObject({ kind: 'text', language: null, size: 256 * 1024 + 10, truncated: true, content: 'x'.repeat(256 * 1024) });
 });
 it('returns images as base64 up to 2 MiB, binaries without content, and errors for folders and missing files', async () => {
  writeFileSync(join(repo, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  expect(await run(['file', '--path', 'icon.png'])).toMatchObject({ kind: 'image', content: 'iVBORw==', truncated: false });
  writeFileSync(join(repo, 'huge.png'), ''); truncateSync(join(repo, 'huge.png'), 2 * 1024 * 1024 + 1);
  expect(await run(['file', '--path', 'huge.png'])).toMatchObject({ ok: false, code: 'TOO_LARGE' });
  writeFileSync(join(repo, 'blob.bin'), Buffer.from([1, 0, 2]));
  expect(await run(['file', '--path', 'blob.bin'])).toMatchObject({ kind: 'binary', content: null });
  expect(await run(['file', '--path', 'host'])).toMatchObject({ ok: false, code: 'BAD_ARGUMENT' });
  expect(await run(['file', '--path', 'nope.ts'])).toMatchObject({ ok: false, code: 'NOT_FOUND' });
 });
});

describe('project git, read-only (S1, L7)', () => {
 beforeEach(() => {
  writeFileSync(join(repo, 'host', 'cli', 'main.ts'), 'export const a = 1;\nexport const b = 3;\nexport const c = 4;\n');
  git('mv', 'old.md', 'renamed.md'); rmSync(join(repo, 'gone.md'));
  writeFileSync(join(repo, 'added.ts'), 'x\n'); git('add', 'added.ts');
  writeFileSync(join(repo, 'new.txt'), 'one\ntwo\n');
 });
 it('reports changes vs HEAD with counts, untracked, the branch and the last commit', async () => {
  const before = git('status', '--porcelain');
  const result = await run(['status']) as any;
  expect(result).toMatchObject({ version: 1, branch: 'main', ahead: 0, behind: 0, truncated: false, lastCommit: { subject: 'first commit', hash: expect.stringMatching(/^[0-9a-f]{7,}$/), time: expect.any(Number) } });
  expect([...result.changes].sort((a: any, b: any) => a.path.localeCompare(b.path))).toEqual([
   { path: 'added.ts', status: 'A', added: 1, removed: 0 },
   { path: 'gone.md', status: 'D', added: 0, removed: 1 },
   { path: 'host/cli/main.ts', status: 'M', added: 2, removed: 1 },
   { path: 'new.txt', status: '?', added: null, removed: null },
   { path: 'renamed.md', status: 'R', added: 0, removed: 0 },
  ]);
  expect(git('status', '--porcelain')).toBe(before);
 });
 it('diffs a tracked file, an untracked file and a commit', async () => {
  expect((await run(['diff', '--path', 'host/cli/main.ts']) as any).diff).toContain('-export const b = 2;\n+export const b = 3;\n+export const c = 4;');
  expect((await run(['diff', '--path', 'new.txt']) as any).diff).toContain('+one\n+two');
  const hash = git('rev-parse', '--short', 'HEAD').trim();
  expect(await run(['diff', '--path', 'package.json', '--commit', hash])).toMatchObject({ commit: hash, truncated: false, diff: expect.stringContaining('+{"name":"mars-ram"}') });
 });
 it('lists commits, a commit\'s files and local branches', async () => {
  git('commit', '-q', '-m', 'second commit'); git('branch', 'feat/x');
  expect((await run(['log', '--limit', '1']) as any).commits).toEqual([{ hash: expect.any(String), subject: 'second commit', time: expect.any(Number) }]);
  expect((await run(['log']) as any).commits.map((c: any) => c.subject)).toEqual(['second commit', 'first commit']);
  const hash = git('rev-parse', 'HEAD').trim();
  const shown = await run(['show', '--commit', hash]) as any;
  expect(shown.commit.subject).toBe('second commit');
  expect(shown.files.map((f: any) => [f.path, f.status]).sort()).toEqual([['added.ts', 'A'], ['renamed.md', 'R']]);
  expect(await run(['show', '--commit', 'deadbeef'])).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect(await run(['branches'])).toEqual({ version: 1, current: 'main', branches: [{ name: 'main', current: true, upstream: null, ahead: null, behind: null }, { name: 'feat/x', current: false, upstream: null, ahead: null, behind: null }], truncated: false });
 });
 it('answers NOT_GIT for git verbs outside a repository while tree and file still work', async () => {
  writeFileSync(join(base, 'elsewhere', 'a.txt'), 'a');
  for (const verb of [['status'], ['log'], ['branches'], ['diff', '--path', 'a.txt']]) expect(await run([...verb, '--workspace', 'w1'])).toMatchObject({ ok: false, code: 'NOT_GIT' });
  expect(await run(['file', '--path', 'a.txt', '--workspace', 'w1'])).toMatchObject({ kind: 'text', content: 'a' });
 });
});

describe('project stage-link (S2, L7)', () => {
 it('copies the file into the link staging dir under a link-server name', async () => {
  const result = await run(['stage-link', '--path', 'package.json']) as any;
  expect(result).toEqual({ version: 1, staged: expect.stringMatching(/^20261031-\d{6}-[a-z0-9]{6}-package\.json$/) });
  expect(readdirSync(staging)).toEqual([result.staged]);
  expect(readFileSync(join(staging, result.staged), 'utf8')).toBe('{"name":"mars-ram"}\n');
 });
 it('refuses folders and files over the 25 MiB link limit, staging nothing', async () => {
  writeFileSync(join(repo, 'big.iso'), ''); truncateSync(join(repo, 'big.iso'), 25 * 1024 * 1024 + 1);
  expect(await run(['stage-link', '--path', 'big.iso'])).toMatchObject({ ok: false, code: 'TOO_LARGE' });
  expect(await run(['stage-link', '--path', 'host'])).toMatchObject({ ok: false, code: 'BAD_ARGUMENT' });
  expect(readdirSync(staging)).toEqual([]);
 });
 it('builds names the link server accepts', () => {
  expect(stagedName('..my file (1).tar.part', Date.UTC(2026, 0, 2, 3, 4, 5), () => 0)).toMatch(/^20260102-\d{6}-aaaaaa-my-file-1-.tar-part$/);
  expect(stagedName('✓', 0, () => 0)).toMatch(/-aaaaaa-file$/);
 });
});

describe('project command output', () => {
 it('writes one JSON line and exits 0 on success, 1 on error', async () => {
  const lines: string[] = []; const out = { write: (chunk: string, done: () => void) => { lines.push(chunk); done(); } };
  expect(await projectCommand(['tree'], out, deps())).toBe(0);
  expect(await projectCommand(['nope'], out, deps())).toBe(1);
  expect(lines).toHaveLength(2); expect(lines.every(line => line.endsWith('}\n') && line.split('\n').length === 2)).toBe(true);
  expect(JSON.parse(lines[1]!)).toMatchObject({ version: 1, ok: false, code: 'BAD_ARGUMENT' });
 });
});

describe('project hardening (verify mvwxivu7-9-ous5)', () => {
 it('never runs repository-configured programs: fsmonitor, external diff, textconv', async () => {
  const marker = join(base, 'ran');
  writeFileSync(join(repo, '.gitattributes'), '*.md diff=leak\n'); git('add', '.gitattributes'); git('commit', '-q', '-m', 'attrs');
  // Configured after the fixture's own commit, which would otherwise run them.
  git('config', 'core.fsmonitor', `touch ${marker}`);
  git('config', 'diff.external', `sh -c 'touch ${marker}'`);
  git('config', 'diff.leak.textconv', `sh -c 'touch ${marker}; echo LEAK'`);
  writeFileSync(join(repo, 'old.md'), 'changed\n');
  expect(await run(['status'])).toMatchObject({ version: 1 });
  const diff = await run(['diff', '--path', 'old.md']) as any;
  expect(diff.diff).toContain('+changed'); expect(diff.diff).not.toContain('LEAK');
  const hash = git('rev-parse', 'HEAD').trim();
  expect((await run(['diff', '--path', '.gitattributes', '--commit', hash]) as any).diff).not.toContain('LEAK');
  expect(existsSync(marker)).toBe(false);
 });
 it('refuses a read when a parent folder is swapped for a link after the check', async () => {
  writeFileSync(join(base, 'secret.txt'), 'OUTSIDE_SECRET'); mkdirSync(join(base, 'outside')); writeFileSync(join(base, 'outside', 'main.ts'), 'OUTSIDE_SECRET');
  const files = createProjectFiles(staging);
  const swapping = { ...files, read: async (path: string, max: number) => {
   renameSync(join(repo, 'host', 'cli'), join(repo, 'host', 'cli-moved')); symlinkSync(join(base, 'outside'), join(repo, 'host', 'cli'));
   return files.read(path, max);
  } };
  const result = await run(['file', '--path', 'host/cli/main.ts'], deps(repo, { files: swapping }));
  expect(JSON.stringify(result)).not.toContain('OUTSIDE_SECRET');
  expect(result).toMatchObject({ ok: false, code: 'BAD_ARGUMENT' });
 });
 it('treats only commits as commits for show and diff --commit', async () => {
  const blob = git('rev-parse', 'HEAD:package.json').trim(); const tree = git('rev-parse', 'HEAD^{tree}').trim();
  for (const id of [blob, tree]) {
   expect(await run(['show', '--commit', id])).toMatchObject({ ok: false, code: 'NOT_FOUND' });
   expect(await run(['diff', '--path', 'package.json', '--commit', id])).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }
 });
 it('returns no commits for an empty repository but reports real log failures', async () => {
  const empty = join(base, 'empty'); mkdirSync(empty); execFileSync('git', ['-C', empty, 'init', '-q']);
  expect(await run(['log'], deps(empty))).toEqual({ version: 1, commits: [] });
  writeFileSync(join(repo, '.git', 'refs', 'heads', 'main'), '0'.repeat(40) + '\n'); rmSync(join(repo, '.git', 'packed-refs'), { force: true });
  expect(await run(['log'])).toMatchObject({ ok: false, code: 'PROJECT_FAILED' });
 });
 it('refuses a staging dir that is a link, writing nothing outside', async () => {
  const target = join(base, 'elsewhere-staging'); mkdirSync(target); rmSync(staging, { recursive: true }); symlinkSync(target, staging);
  expect(await run(['stage-link', '--path', 'package.json'])).toMatchObject({ ok: false, code: 'PROJECT_FAILED' });
  expect(readdirSync(target)).toEqual([]);
 });
 it('never ends a shortened staged name with a dot or dash', () => {
  const name = stagedName('a'.repeat(119) + '.b' + 'c'.repeat(50), 0, () => 0);
  expect(name).toMatch(/[A-Za-z0-9]$/); expect(name.length).toBeLessThanOrEqual(200);
 });
});

describe('project hardening, second round (verify mvwxivu7-9-ous5)', () => {
 it('never runs a clean filter named by .gitattributes during status or diff', async () => {
  const marker = join(base, 'filtered');
  writeFileSync(join(repo, '.gitattributes'), '*.md filter=x\n'); git('add', '.gitattributes'); git('commit', '-q', '-m', 'attrs');
  git('config', 'filter.x.clean', `sh -c 'touch ${marker}; cat'`);
  writeFileSync(join(repo, 'old.md'), 'changed\n');
  expect(await run(['status'])).toMatchObject({ version: 1 });
  expect(await run(['diff', '--path', 'old.md'])).toMatchObject({ version: 1 });
  expect(existsSync(marker)).toBe(false);
 });
 it('opens the work tree, not the git dir, when the pane sits inside .git', async () => {
  const result = await run(['tree'], deps(join(repo, '.git', 'refs')));
  expect(result).toMatchObject({ root: { name: 'mars-ram', git: true } });
  expect(await run(['file', '--path', 'config'], deps(join(repo, '.git')))).toMatchObject({ ok: false, code: 'NOT_FOUND' });
 });
 it('builds an untracked file diff from a checked read, refusing a swapped parent', async () => {
  mkdirSync(join(repo, 'n')); writeFileSync(join(repo, 'n', 'new.txt'), 'one\n');
  mkdirSync(join(base, 'outside')); writeFileSync(join(base, 'outside', 'new.txt'), 'OUTSIDE_SECRET\n');
  expect((await run(['diff', '--path', 'n/new.txt']) as any).diff).toBe('diff --git a/n/new.txt b/n/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n/new.txt\n@@ -0,0 +1,1 @@\n+one\n');
  const files = createProjectFiles(staging);
  const swapping = { ...files, read: async (path: string, max: number) => { renameSync(join(repo, 'n'), join(repo, 'n-moved')); symlinkSync(join(base, 'outside'), join(repo, 'n')); return files.read(path, max); } };
  const result = await run(['diff', '--path', 'n/new.txt'], deps(repo, { files: swapping }));
  expect(JSON.stringify(result)).not.toContain('OUTSIDE_SECRET');
 });
 it('truncates huge diffs at 256 KiB instead of failing', async () => {
  writeFileSync(join(repo, 'huge.txt'), 'y\n'.repeat(5 * 1024 * 1024));
  expect(await run(['diff', '--path', 'huge.txt'])).toMatchObject({ truncated: true, diff: expect.stringContaining('+y') });
  git('add', 'huge.txt'); git('commit', '-q', '-m', 'huge'); writeFileSync(join(repo, 'huge.txt'), 'z\n'.repeat(5 * 1024 * 1024));
  const tracked = await run(['diff', '--path', 'huge.txt']) as any;
  expect(tracked).toMatchObject({ truncated: true }); expect(Buffer.byteLength(tracked.diff)).toBeLessThanOrEqual(256 * 1024);
 });
 it('caps branches at 500 with the current one first and a truncated flag', async () => {
  // One git process for all 501 branches: a loop of `git branch` timed out under load.
  const head = git('rev-parse', 'HEAD').trim();
  execFileSync('git', ['-C', repo, 'update-ref', '--stdin'], { input: Array.from({ length: 501 }, (_, i) => `create refs/heads/a${String(i).padStart(3, '0')} ${head}\n`).join('') });
  const result = await run(['branches']) as any;
  expect(result.branches).toHaveLength(500); expect(result.truncated).toBe(true);
  expect(result.branches[0]).toMatchObject({ name: 'main', current: true });
 });
 it('writes nothing to staging once the deadline aborted the command', async () => {
  const controller = new AbortController(); const files = createProjectFiles(staging);
  const slow = { ...files, read: async (path: string, max: number) => { const value = await files.read(path, max); controller.abort(); return value; } };
  expect(await runProject(['stage-link', '--path', 'package.json'], deps(repo, { files: slow }), controller.signal)).toMatchObject({ ok: false });
  expect(readdirSync(staging)).toEqual([]);
 });
});

describe('project hardening, third round (verify mvwxivu7-9-ous5)', () => {
 it('reports show truncation and uses literal pathspecs', async () => {
  const hash = git('rev-parse', 'HEAD').trim();
  expect(await run(['show', '--commit', hash])).toMatchObject({ truncated: false });
  expect(await run(['diff', '--path', '*.md'])).toMatchObject({ version: 1, diff: '' });
 });
});

describe('project hardening, fourth round (re-verify mvwxv47p-a-zn7p)', () => {
 it('neutralizes filters named by .git/info/attributes and core.attributesFile', async () => {
  const marker = join(base, 'filtered'); const outside = join(base, 'secret.txt'); writeFileSync(outside, 'OUTSIDE_SECRET');
  mkdirSync(join(repo, '.git', 'info'), { recursive: true }); writeFileSync(join(repo, '.git', 'info', 'attributes'), '*.md filter=evil\n');
  writeFileSync(join(base, 'attrs'), '*.json filter=other\n'); git('config', 'core.attributesFile', join(base, 'attrs'));
  git('config', 'filter.evil.clean', `sh -c 'touch ${marker}; cat ${outside}'`); git('config', 'filter.evil.process', `sh -c 'touch ${marker}'`);
  git('config', 'filter.other.clean', `sh -c 'touch ${marker}; cat'`);
  writeFileSync(join(repo, 'old.md'), 'changed\n'); writeFileSync(join(repo, 'package.json'), '{}\n');
  expect(await run(['status'])).toMatchObject({ version: 1 });
  const diff = await run(['diff', '--path', 'old.md']);
  expect(JSON.stringify(diff)).not.toContain('OUTSIDE_SECRET');
  expect(await run(['diff', '--path', 'package.json'])).toMatchObject({ version: 1 });
  expect(existsSync(marker)).toBe(false);
 });
 it('cuts a huge commit diff instead of failing', async () => {
  writeFileSync(join(repo, 'huge.txt'), 'y\n'.repeat(5 * 1024 * 1024)); git('add', 'huge.txt'); git('commit', '-q', '-m', 'huge');
  expect(await run(['diff', '--path', 'huge.txt', '--commit', git('rev-parse', 'HEAD').trim()])).toMatchObject({ truncated: true });
 });
 it('removes a staged copy whose write finished after the deadline', async () => {
  const controller = new AbortController(); const files = createProjectFiles(staging);
  const late = { ...files, writeStaged: async (name: string, bytes: Uint8Array) => { await files.writeStaged(name, bytes); controller.abort(); } };
  expect(await runProject(['stage-link', '--path', 'package.json'], deps(repo, { files: late }), controller.signal)).toMatchObject({ ok: false });
  expect(readdirSync(staging)).toEqual([]);
 });
 it('refuses a read whose file identity is unknown (inode 0)', async () => {
  const files = createProjectFiles(staging);
  const blind = { ...files, read: async (path: string, max: number) => ({ ...(await files.read(path, max)), id: '0:0' }), lstat: async (path: string) => ({ ...(await files.lstat(path)), id: '0:0' }) };
  expect(await run(['file', '--path', 'package.json'], deps(repo, { files: blind }))).toMatchObject({ ok: false, code: 'BAD_ARGUMENT' });
 });
 it('never ends a shortened staged name in .part', () => {
  expect(stagedName('a'.repeat(115) + '.part' + 'x'.repeat(20), 0, () => 0)).not.toMatch(/\.part$/i);
 });
 it('trims a path inside .git to its work tree, keeping a drive root', () => {
  expect(workTreeOf('/home/me/repo/.git/refs')).toBe('/home/me/repo');
  expect(workTreeOf('C:\\.git\\hooks')).toBe('C:\\');
  expect(workTreeOf('C:\\Users\\me\\repo\\.GIT')).toBe('C:\\Users\\me\\repo');
  expect(workTreeOf('/.git')).toBe('/');
  expect(workTreeOf('/home/me/repo')).toBe('/home/me/repo');
 });
});

describe('project status and unborn diffs (re-verify mvwxv47p-a-zn7p, LOW)', () => {
 it('drops a status record cut by the buffer and reports truncation', async () => {
  const d = deps(); const inner = d.run;
  d.run = async (file, args, options) => {
   if (file === 'git' && args.includes('status') && args.includes('--porcelain=v1')) throw Object.assign(Error('maxBuffer'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', stdout: '## main\0 M package.json\0?? half-writ' });
   return inner(file, args, options);
  };
  expect(await run(['status'], d)).toMatchObject({ truncated: true, changes: [{ path: 'package.json', status: 'M' }] });
 });
 it('diffs an untracked file in a repository with no commits', async () => {
  const empty = join(base, 'empty'); mkdirSync(empty); execFileSync('git', ['-C', empty, 'init', '-q']); writeFileSync(join(empty, 'a.txt'), 'x\n');
  expect(await run(['diff', '--path', 'a.txt'], deps(empty))).toMatchObject({ diff: expect.stringContaining('+x') });
 });
});

describe('project filter enumeration (third verify mvwygmon-b-iy34)', () => {
 it('neutralizes a filter whose command overflows the config listing, or fails closed', async () => {
  const marker = join(base, 'filtered'); const outside = join(base, 'secret.txt'); writeFileSync(outside, 'OUTSIDE_SECRET');
  mkdirSync(join(repo, '.git', 'info'), { recursive: true }); writeFileSync(join(repo, '.git', 'info', 'attributes'), '*.md filter=evil\n');
  git('config', 'filter.evil.clean', `sh -c 'touch ${marker}; cat ${outside}'${' '.repeat(70 * 1024)}`);
  writeFileSync(join(repo, 'old.md'), 'changed\n');
  const diff = await run(['diff', '--path', 'old.md']);
  expect(JSON.stringify(diff)).not.toContain('OUTSIDE_SECRET');
  expect(existsSync(marker)).toBe(false);
 });
 it('fails closed when the filter names cannot be listed', async () => {
  const d = deps(); const inner = d.run;
  d.run = async (file, args, options) => { if (file === 'git' && args.includes('--get-regexp')) throw Object.assign(Error('boom'), { code: 128 }); return inner(file, args, options); };
  expect(await run(['status'], d)).toMatchObject({ ok: false, code: 'PROJECT_FAILED' });
 });
 it('diffs a staged file in a repository with no commits', async () => {
  const empty = join(base, 'empty'); mkdirSync(empty); execFileSync('git', ['-C', empty, 'init', '-q']); writeFileSync(join(empty, 'a.txt'), 'x\n'); execFileSync('git', ['-C', empty, 'add', 'a.txt']);
  expect(await run(['diff', '--path', 'a.txt'], deps(empty))).toMatchObject({ diff: expect.stringContaining('+x') });
 });
});

describe('project UTF-8 caps (third verify, LOW)', () => {
 it('never exceeds 256 KiB by splitting a multi-byte character', async () => {
  for (const pad of [1, 2]) {
   writeFileSync(join(repo, `e${pad}.txt`), 'x'.repeat(pad) + '€'.repeat(100_000));
   const diff = await run(['diff', '--path', `e${pad}.txt`]) as any;
   expect(diff.truncated).toBe(true); expect(Buffer.byteLength(diff.diff)).toBeLessThanOrEqual(256 * 1024); expect(diff.diff).not.toContain('\uFFFD');
   const file = await run(['file', '--path', `e${pad}.txt`]) as any;
   expect(Buffer.byteLength(file.content)).toBeLessThanOrEqual(256 * 1024); expect(file.content).not.toContain('\uFFFD');
  }
 });
});
