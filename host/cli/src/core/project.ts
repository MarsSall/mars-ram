// Read-only project browser for the phone (odd/tasks/project-files.md L7). Policy and
// orchestration only: Herdr and git run through the shell-free ProcessRunner seam, files
// through ProjectFiles. The phone names a Herdr workspace, never a host path for the root.
import { join, sep } from 'node:path';
import type { ProcessRunner } from './herdr-switcher.ts';

export type ProjectErrorCode = 'HERDR_NOT_FOUND' | 'NOT_FOUND' | 'BAD_ARGUMENT' | 'NOT_GIT' | 'TOO_LARGE' | 'PROJECT_FAILED';
export type ProjectFailure = { version: 1; ok: false; code: ProjectErrorCode; message: string };
export type EntryKind = 'dir' | 'file' | 'link' | 'other';
export type FileInfo = { kind: EntryKind; size: number; mtime: number; id: string };
/** Filesystem port. read/stage refuse anything but a regular file and never follow a final symlink. */
export type ProjectFiles = {
 realpath(path: string): Promise<string>;
 lstat(path: string): Promise<FileInfo>;
 list(dir: string): Promise<string[]>;
 read(path: string, max: number): Promise<{ bytes: Uint8Array; size: number; mtime: number; id: string }>;
 /** Writes a new file in the link server's staging dir; refuses a staging dir that is a link. */
 writeStaged(name: string, bytes: Uint8Array): Promise<void>;
 removeStaged(name: string): Promise<void>;
};
export type ProjectDeps = { run: ProcessRunner; herdr: string; files: ProjectFiles; now(): number; random(): number; platform: NodeJS.Platform };

const messages: Record<ProjectErrorCode, string> = {
 HERDR_NOT_FOUND: 'Herdr executable was not found. Install Herdr and check the recorded path.',
 NOT_FOUND: 'The workspace or path no longer exists.',
 BAD_ARGUMENT: 'Expected mars-ram project <tree|file|status|diff|log|show|branches|stage-link> with valid options.',
 NOT_GIT: 'This project is not a Git repository.',
 TOO_LARGE: 'The file is too large to show or share.',
 PROJECT_FAILED: 'The project could not be read.',
};
class Failure extends Error {
 readonly code: ProjectErrorCode;
 constructor(code: ProjectErrorCode) { super(messages[code]); this.code = code; }
}
export const projectFailure = (code: ProjectErrorCode): ProjectFailure => ({ version: 1, ok: false, code, message: messages[code] });

export const MAX_ENTRIES = 500;
export const MAX_TEXT = 256 * 1024;
export const MAX_IMAGE = 2 * 1024 * 1024;
export const MAX_DIFF = 256 * 1024;
export const MAX_OUTPUT = 4 * 1024 * 1024;
/** host/link-server/src/core/links.ts MAX_BYTES: the link server refuses larger staged files. */
export const LINK_MAX_BYTES = 25 * 1024 * 1024;
const GIT_BUFFER = 8 * 1024 * 1024;
/** Reads only: no optional locks, and no program the repository's config names (fsmonitor;
 * external diff and textconv are refused per command with --no-ext-diff --no-textconv). */
const SAFE_GIT = ['--literal-pathspecs', '--no-optional-locks', '-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false'];
const NO_PROGRAMS = ['--no-ext-diff', '--no-textconv'];
const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const LANGUAGES: Record<string, string> = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', json: 'json', md: 'markdown', kt: 'kotlin', kts: 'kotlin', java: 'java', go: 'go', py: 'python', rs: 'rust', sh: 'shell', ps1: 'powershell', yaml: 'yaml', yml: 'yaml', toml: 'toml', html: 'html', css: 'css', xml: 'xml', sql: 'sql', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php', swift: 'swift' };

/** At most `max` bytes, never ending inside a multi-byte UTF-8 character. */
function utf8Prefix(bytes: Uint8Array, max: number): Uint8Array {
 if (bytes.length <= max) return bytes;
 let end = max;
 while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--; // bytes[end] continues a character that started before it
 return bytes.subarray(0, end);
}
/** `.git` and what Windows resolves to it: trailing dots or spaces, and the 8.3 short name. */
const isGitAlias = (segment: string) => segment.toLowerCase().replace(/[. ]+$/, '') === '.git' || /^git~\d+$/i.test(segment);
/** Relative POSIX path inside the project: no empty, `.`/`..`, `.git`, control, backslash or drive segment. */
export function validProjectPath(path: string): boolean {
 return path.length > 0 && path.length <= 4096 && !path.includes('\\') && !/[\x00-\x1f\x7f-\x9f]/.test(path) && !/^[A-Za-z]:/.test(path) && !path.includes(':') && path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..' && !isGitAlias(segment));
}
const workspaceId = (id: string) => /^w[A-Za-z0-9]{1,63}$/.test(id);
const commitId = (id: string) => /^[0-9a-fA-F]{7,64}$/.test(id);
const clean = (value: string, max = 1024) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, max);
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

type Options = { workspace?: string; path?: string; commit?: string; limit?: number };
const VERBS: Record<string, { required: (keyof Options)[]; allowed: (keyof Options)[] }> = {
 tree: { required: [], allowed: ['workspace', 'path'] },
 file: { required: ['path'], allowed: ['workspace', 'path'] },
 status: { required: [], allowed: ['workspace'] },
 diff: { required: ['path'], allowed: ['workspace', 'path', 'commit'] },
 log: { required: [], allowed: ['workspace', 'limit'] },
 show: { required: ['commit'], allowed: ['workspace', 'commit'] },
 branches: { required: [], allowed: ['workspace'] },
 'stage-link': { required: ['path'], allowed: ['workspace', 'path'] },
};
function parse(args: string[]): { verb: string; options: Options } {
 const [verb, ...rest] = args;
 const spec = verb === undefined ? undefined : VERBS[verb];
 if (!spec || rest.length % 2 !== 0) throw new Failure('BAD_ARGUMENT');
 const options: Options = {};
 for (let i = 0; i < rest.length; i += 2) {
  let key = rest[i]!.replace(/^--/, '') as keyof Options; let value = rest[i + 1]!;
  // --path-b64: base64url of the UTF-8 path, so no remote shell (cmd, PowerShell, nushell, sh) can reinterpret it.
  if (key as string === 'path-b64') {
   if (!/^[A-Za-z0-9_-]{1,8192}$/.test(value)) throw new Failure('BAD_ARGUMENT');
   key = 'path'; value = Buffer.from(value, 'base64url').toString('utf8');
  }
  if (!rest[i]!.startsWith('--') || !spec.allowed.includes(key) || key in options) throw new Failure('BAD_ARGUMENT');
  if (key === 'workspace' && !workspaceId(value)) throw new Failure('BAD_ARGUMENT');
  if (key === 'path' && !validProjectPath(value)) throw new Failure('BAD_ARGUMENT');
  if (key === 'commit' && !commitId(value)) throw new Failure('BAD_ARGUMENT');
  if (key === 'limit') { if (!/^\d{1,3}$/.test(value) || Number(value) < 1 || Number(value) > 100) throw new Failure('BAD_ARGUMENT'); options.limit = Number(value); }
  else options[key] = value;
 }
 if (spec.required.some(key => !(key in options))) throw new Failure('BAD_ARGUMENT');
 return { verb: verb!, options };
}

/** cwd of the workspace's active tab, first pane: the same pane `herdr list` uses for the branch. */
async function workspaceCwd(deps: ProjectDeps, workspace: string | undefined): Promise<{ cwd: string; workspace: string }> {
 const herdr = async (argv: string[], field: string): Promise<Record<string, unknown>[]> => {
  let text: string;
  try { text = await deps.run(deps.herdr, argv, { shell: false, encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024 }); }
  catch (error) { throw new Failure(record(error).code === 'ENOENT' ? 'HERDR_NOT_FOUND' : 'PROJECT_FAILED'); }
  let rows: unknown;
  try { rows = record(record(JSON.parse(text)).result)[field]; } catch { throw new Failure('PROJECT_FAILED'); }
  if (!Array.isArray(rows)) throw new Failure('PROJECT_FAILED');
  return rows.map(record);
 };
 const workspaces = await herdr(['workspace', 'list'], 'workspaces');
 const row = workspaces.find(w => workspace === undefined ? w.focused === true : w.workspace_id === workspace);
 if (!row || typeof row.workspace_id !== 'string') throw new Failure('NOT_FOUND');
 const tabs = await herdr(['tab', 'list', '--workspace', row.workspace_id], 'tabs');
 const active = tabs.find(t => t.tab_id === row.active_tab_id) ?? tabs.find(t => t.focused === true);
 const pane = active ? (await herdr(['pane', 'list'], 'panes')).find(p => p.tab_id === active.tab_id) : undefined;
 const cwd = pane?.cwd;
 if (typeof cwd !== 'string' || cwd.length > 4096 || /[\x00-\x1f]/.test(cwd) || !/^(?:\/|[A-Za-z]:[\\/])/.test(cwd)) throw new Failure('NOT_FOUND');
 return { cwd, workspace: row.workspace_id };
}

/** A cwd inside a .git dir browses the work tree around it; a drive root keeps its separator. */
export function workTreeOf(path: string): string {
 const windows = path.includes('\\'); const separator = windows ? '\\' : '/';
 const parts = path.split(/[\\/]/); const gitDir = parts.findIndex(part => part.toLowerCase() === '.git');
 if (gitDir < 0) return path;
 const head = parts.slice(0, gitDir).join(separator);
 return head === '' ? '/' : /^[A-Za-z]:$/.test(head) ? head + separator : head;
}
type Context = { workspace: string; deps: ProjectDeps; root: string; git: boolean; signal: AbortSignal; emptyTree: string; neutral: string[] };
const EMPTY_TREE = { sha1: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', sha256: '6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321' };
/** `--attr-source` at the empty tree: no .gitattributes applies, so no filter or diff driver the
 * repository names can run. Big outputs may come back cut at the buffer when `partial` is set. */
async function git(context: Context, args: string[], partial = false): Promise<string> {
 context.signal.throwIfAborted();
 try { return await context.deps.run('git', [...SAFE_GIT, ...context.neutral, `--attr-source=${context.emptyTree}`, '-C', context.root, ...args], { shell: false, encoding: 'utf8', timeout: 3000, maxBuffer: GIT_BUFFER }); }
 catch (error) {
  const failed = record(error);
  if (partial && failed.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' && typeof failed.stdout === 'string') return failed.stdout;
  throw new Failure('PROJECT_FAILED');
 }
}
async function openRoot(deps: ProjectDeps, workspace: string | undefined, signal: AbortSignal): Promise<Context> {
 const { cwd, workspace: resolved } = await workspaceCwd(deps, workspace);
 let root: string;
 try { root = await deps.files.realpath(cwd); } catch { throw new Failure('NOT_FOUND'); }
 root = workTreeOf(root);
 const probe: Context = { workspace: resolved, deps, root, git: false, signal, emptyTree: EMPTY_TREE.sha1, neutral: [] };
 const ask = (args: string[]) => deps.run('git', ['-C', root, ...args], { shell: false, encoding: 'utf8', timeout: 2000, maxBuffer: 64 * 1024 });
 let top: string;
 try { top = (await ask(['rev-parse', '--show-toplevel'])).trim(); } catch { return probe; }
 let format = 'sha1';
 try { format = (await ask(['rev-parse', '--show-object-format'])).trim(); } catch { /* Older git: SHA-1 only. */ }
 // `.gitattributes` is off through --attr-source, but .git/info/attributes and core.attributesFile
 // still apply: every configured filter is overridden by identity commands for each call.
 // Names only (values may be huge), with room for many; exit 1 means none, any other failure fails closed.
 let listed = '';
 try { listed = await deps.run('git', ['-C', root, 'config', '--name-only', '--get-regexp', '^filter\\.'], { shell: false, encoding: 'utf8', timeout: 2000, maxBuffer: 1024 * 1024 }); }
 catch (error) { if (record(error).code !== 1) throw new Failure('PROJECT_FAILED'); }
 const neutral: string[] = [];
 for (const name of new Set(listed.split('\n').filter(key => /^filter\..+\.[^.]+$/.test(key)).map(key => key.slice(7, key.lastIndexOf('.'))))) {
  if (name.includes('=') || /[\x00-\x1f]/.test(name)) throw new Failure('PROJECT_FAILED'); // Cannot be overridden safely.
  neutral.push('-c', `filter.${name}.clean=cat`, '-c', `filter.${name}.smudge=cat`, '-c', `filter.${name}.process=`, '-c', `filter.${name}.required=false`);
 }
 return { ...probe, root: await deps.files.realpath(top), git: true, emptyTree: format === 'sha256' ? EMPTY_TREE.sha256 : EMPTY_TREE.sha1, neutral };
}
const inside = (context: Context, real: string) => {
 const fold = (p: string) => context.deps.platform === 'win32' ? p.toLowerCase() : p;
 return fold(real) === fold(context.root) || fold(real).startsWith(fold(context.root.endsWith(sep) ? context.root : context.root + sep));
};
/** Absolute path of a validated relative path whose real location stays inside the root. */
async function contained(context: Context, path: string | undefined): Promise<string> {
 const target = path === undefined ? context.root : join(context.root, ...path.split('/'));
 let real: string;
 try { real = await context.deps.files.realpath(target); } catch { throw new Failure('NOT_FOUND'); }
 // A symlink may still point into the repository's own .git: check the resolved part too.
 if (!inside(context, real) || real.slice(context.root.length).split(/[\\/]/).some(segment => segment.toLowerCase() === '.git')) throw new Failure('BAD_ARGUMENT');
 return real;
}
/** After a read: the path must still resolve inside the root to the very file that was read,
 * so a parent folder swapped for a link between the check and the open is refused. */
async function sameFile(context: Context, path: string, id: string): Promise<void> {
 const real = await contained(context, path);
 let info: FileInfo;
 try { info = await context.deps.files.lstat(real); } catch { throw new Failure('BAD_ARGUMENT'); }
 // An unknown identity (inode 0, some Windows file systems) cannot prove the same file: fail closed.
 if (info.id !== id || /(?:^|:)0$/.test(id)) throw new Failure('BAD_ARGUMENT');
}
async function branchOf(context: Context): Promise<string | null> {
 if (!context.git) return null;
 try {
  let branch = (await git(context, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  if (branch === 'HEAD') branch = (await git(context, ['rev-parse', '--short', 'HEAD'])).trim();
  return branch ? clean(branch, 256) : null;
 } catch { return null; }
}
const requireGit = (context: Context) => { if (!context.git) throw new Failure('NOT_GIT'); };
/** A blob or tree id is not a commit: show and diff --commit answer NOT_FOUND for it. */
async function requireCommit(context: Context, id: string): Promise<void> {
 let type: string;
 try { type = (await git(context, ['cat-file', '-t', id])).trim(); } catch { throw new Failure('NOT_FOUND'); }
 if (type !== 'commit') throw new Failure('NOT_FOUND');
}
const extension = (name: string) => name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
const statusLetter = (code: string): 'M' | 'A' | 'D' | 'R' | '?' => code.includes('?') ? '?' : code.includes('R') || code.includes('C') ? 'R' : code.includes('D') ? 'D' : code.includes('A') ? 'A' : 'M';
type Change = { path: string; status: 'M' | 'A' | 'D' | 'R' | '?'; added: number | null; removed: number | null };
/** `--numstat -z`: "a\tr\tpath\0", renames "a\tr\t\0old\0new\0"; binary counts are "-". */
function numstat(text: string): Map<string, [number | null, number | null]> {
 const parts = text.split('\0'); const counts = new Map<string, [number | null, number | null]>();
 for (let i = 0; i < parts.length; i++) {
  const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(parts[i]!);
  if (!match) continue;
  let path = match[3]!;
  if (path === '') { i += 2; path = parts[i] ?? ''; }
  counts.set(path, [match[1] === '-' ? null : Number(match[1]), match[2] === '-' ? null : Number(match[2])]);
 }
 return counts;
}
const commitMeta = (line: string) => { const [hash, subject, time] = line.split('\x1f'); return { hash: clean(hash ?? '', 64), subject: clean(subject ?? '', 512), time: Number(time) * 1000 }; };

async function tree(context: Context, path: string | undefined) {
 const dir = await contained(context, path);
 const info = await context.deps.files.lstat(dir);
 if (info.kind !== 'dir') throw new Failure('BAD_ARGUMENT');
 const all = (await context.deps.files.list(dir)).filter(name => !isGitAlias(name) && !/[\x00-\x1f\x7f-\x9f]/.test(name));
 // Stat at most four pages of names: a huge folder is reported truncated, not walked whole.
 const names = all.slice(0, MAX_ENTRIES * 4);
 const entries: { name: string; kind: EntryKind; size: number | null; mtime: number }[] = [];
 for (const name of names) {
  context.signal.throwIfAborted();
  try { const entry = await context.deps.files.lstat(join(dir, name)); entries.push({ name, kind: entry.kind, size: entry.kind === 'file' ? entry.size : null, mtime: entry.mtime }); }
  catch { /* Removed while listing. */ }
 }
 entries.sort((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
 const name = context.root.split(/[\\/]/).filter(Boolean).at(-1) ?? context.root;
 return { version: 1 as const, root: { name: clean(name, 256), path: context.root, workspace: context.workspace, branch: await branchOf(context), git: context.git }, path: path ?? '', entries: entries.slice(0, MAX_ENTRIES), truncated: all.length > MAX_ENTRIES };
}
async function file(context: Context, path: string) {
 const real = await contained(context, path);
 const ext = extension(path);
 const image = IMAGES.has(ext);
 let read;
 try { read = await context.deps.files.read(real, image ? MAX_IMAGE + 1 : MAX_TEXT + 1); }
 catch (error) { throw error instanceof Failure ? error : new Failure(record(error).code === 'ENOENT' ? 'NOT_FOUND' : 'BAD_ARGUMENT'); }
 await sameFile(context, path, read.id);
 const base = { version: 1 as const, path, size: read.size, mtime: read.mtime };
 if (image) {
  if (read.size > MAX_IMAGE) throw new Failure('TOO_LARGE');
  return { ...base, kind: 'image' as const, language: null, content: Buffer.from(read.bytes).toString('base64'), truncated: false };
 }
 const bytes = utf8Prefix(read.bytes, MAX_TEXT);
 if (bytes.subarray(0, 8192).includes(0)) return { ...base, kind: 'binary' as const, language: null, content: null, truncated: false };
 return { ...base, kind: 'text' as const, language: LANGUAGES[ext] ?? null, content: new TextDecoder('utf-8', { fatal: false }).decode(bytes), truncated: read.size > MAX_TEXT };
}
async function status(context: Context) {
 requireGit(context);
 const raw = await git(context, ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all'], true);
 // Complete -z output ends with NUL; a cut buffer leaves a partial last record: drop it.
 const cut = raw !== '' && !raw.endsWith('\0');
 const parts = raw.split('\0');
 if (cut) parts.pop();
 const head = parts[0]?.startsWith('## ') ? parts.shift()!.slice(3) : '';
 const ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0); const behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0);
 const hasHead = !head.startsWith('No commits yet');
 const counts = hasHead ? numstat(await git(context, ['diff', ...NO_PROGRAMS, 'HEAD', '--numstat', '-z', '-M'], true)) : new Map();
 const changes: Change[] = [];
 for (let i = 0; i < parts.length; i++) {
  const entry = parts[i]!;
  if (entry.length < 4) continue;
  const code = entry.slice(0, 2); const path = entry.slice(3);
  if (code.includes('R') || code.includes('C')) i++; // The original path follows a rename.
  if (path.split('/').some(segment => segment.toLowerCase() === '.git')) continue;
  const letter = statusLetter(code); const count = counts.get(path);
  changes.push({ path: clean(path, 4096), status: letter, added: count?.[0] ?? null, removed: count?.[1] ?? null });
 }
 let lastCommit = null;
 if (hasHead) { const line = (await git(context, ['log', '-1', '--format=%h%x1f%s%x1f%ct'])).trim(); if (line) lastCommit = commitMeta(line); }
 return { version: 1 as const, branch: await branchOf(context), ahead, behind, lastCommit, changes: changes.slice(0, MAX_ENTRIES), truncated: cut || changes.length > MAX_ENTRIES };
}
async function diff(context: Context, path: string, commit: string | undefined) {
 requireGit(context);
 let text: string;
 if (commit) { await requireCommit(context, commit); text = await git(context, ['show', ...NO_PROGRAMS, '--format=', '--no-color', commit, '--', path], true); }
 else {
  // With no commits yet there is no HEAD side: every file is a whole-file addition.
  const born = await git(context, ['rev-parse', '--verify', '-q', 'HEAD']).then(() => true, () => false);
  text = born ? await git(context, ['diff', ...NO_PROGRAMS, 'HEAD', '--no-color', '--', path], true) : '';
  // Untracked files, and any file before the first commit, have no HEAD side: a whole-file
  // addition built from a checked read.
  if (!text && (!born || (await git(context, ['ls-files', '--others', '--exclude-standard', '--', path])).trim())) text = await untrackedDiff(context, path).catch(error => { if (!born && error instanceof Failure && error.code === 'NOT_FOUND') return ''; throw error; });
 }
 const truncated = Buffer.byteLength(text) > MAX_DIFF;
 return { version: 1 as const, path, commit: commit ?? null, diff: truncated ? Buffer.from(utf8Prefix(Buffer.from(text), MAX_DIFF)).toString('utf8') : text, truncated };
}
async function untrackedDiff(context: Context, path: string): Promise<string> {
 const real = await contained(context, path);
 let read;
 try { read = await context.deps.files.read(real, MAX_DIFF + 1); } catch { throw new Failure('BAD_ARGUMENT'); }
 await sameFile(context, path, read.id);
 if (read.bytes.subarray(0, 8192).includes(0)) return `diff --git a/${path} b/${path}\nnew file mode 100644\nBinary files /dev/null and b/${path} differ\n`;
 const lines = new TextDecoder().decode(read.bytes).split('\n');
 if (lines.at(-1) === '') lines.pop();
 return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}\n`).join('')}`;
}
async function log(context: Context, limit = 50) {
 requireGit(context);
 let text: string;
 try { text = await git(context, ['log', `-n${limit}`, '--format=%h%x1f%s%x1f%ct%x1e']); }
 catch (error) {
  // Only an unborn branch means "no commits"; a broken ref or object store is a failure.
  // `status --porcelain=v2` is machine output, never translated: `(initial)` marks an unborn branch.
  if (!(await git(context, ['status', '--porcelain=v2', '--branch', '--untracked-files=no']).catch(() => '')).includes('# branch.oid (initial)')) throw error;
  text = '';
 }
 return { version: 1 as const, commits: text.split('\x1e').map(line => line.trim()).filter(Boolean).map(commitMeta) };
}
async function show(context: Context, commit: string) {
 requireGit(context);
 await requireCommit(context, commit);
 const meta = (await git(context, ['log', '-1', '--format=%h%x1f%s%x1f%ct', commit, '--'])).trim();
 const names = (await git(context, ['show', ...NO_PROGRAMS, '--format=', '--name-status', '-z', '-M', commit])).split('\0');
 const counts = numstat(await git(context, ['show', ...NO_PROGRAMS, '--format=', '--numstat', '-z', '-M', commit]));
 const files: Change[] = [];
 for (let i = 0; i < names.length; i++) {
  const code = names[i]!; if (!code) continue;
  let path = names[++i] ?? '';
  if (/^[RC]/.test(code)) path = names[++i] ?? '';
  const count = counts.get(path);
  files.push({ path: clean(path, 4096), status: statusLetter(code), added: count?.[0] ?? null, removed: count?.[1] ?? null });
 }
 return { version: 1 as const, commit: commitMeta(meta), files: files.slice(0, MAX_ENTRIES), truncated: files.length > MAX_ENTRIES };
}
async function branches(context: Context) {
 requireGit(context);
 const text = await git(context, ['for-each-ref', '--format=%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track)', 'refs/heads']);
 const lines = text.split('\n').filter(Boolean).sort((a, b) => Number(b.split('\x1f')[1] === '*') - Number(a.split('\x1f')[1] === '*'));
 const list = lines.slice(0, MAX_ENTRIES).map(line => {
  const [name, head, upstream, track] = line.split('\x1f');
  const gone = track === '[gone]';
  return { name: clean(name ?? '', 256), current: head === '*', upstream: upstream ? clean(upstream, 256) : null, ahead: upstream && !gone ? Number(/ahead (\d+)/.exec(track ?? '')?.[1] ?? 0) : null, behind: upstream && !gone ? Number(/behind (\d+)/.exec(track ?? '')?.[1] ?? 0) : null };
 });
 return { version: 1 as const, current: await branchOf(context), branches: list, truncated: lines.length > MAX_ENTRIES };
}
/** Link-server staged names (host/link-server/src/core/links.ts validName): stamp-salt-name. */
export function stagedName(fileName: string, now: number, random: () => number): string {
 const date = new Date(now); const pad = (n: number) => String(n).padStart(2, '0');
 const salt = Array.from({ length: 6 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)]).join('');
 const base = fileName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/\.{2,}/g, '.').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '').slice(0, 120).replace(/[^A-Za-z0-9]+$/, '').replace(/\.part$/i, '-part') || 'file';
 return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${salt}-${base}`;
}
async function stageLink(context: Context, path: string) {
 const real = await contained(context, path);
 const info = await context.deps.files.lstat(real);
 if (info.kind !== 'file') throw new Failure('BAD_ARGUMENT');
 if (info.size > LINK_MAX_BYTES) throw new Failure('TOO_LARGE');
 let read;
 try { read = await context.deps.files.read(real, LINK_MAX_BYTES + 1); } catch { throw new Failure('BAD_ARGUMENT'); }
 if (read.size > LINK_MAX_BYTES) throw new Failure('TOO_LARGE');
 await sameFile(context, path, read.id);
 const name = stagedName(path.split('/').at(-1)!, context.deps.now(), context.deps.random);
 context.signal.throwIfAborted();
 try { await context.deps.files.writeStaged(name, read.bytes); } catch { throw new Failure('PROJECT_FAILED'); }
 // The deadline may pass while writing: the command already answered failure, so leave no copy.
 if (context.signal.aborted) { await context.deps.files.removeStaged(name).catch(() => {}); throw new Failure('PROJECT_FAILED'); }
 return { version: 1 as const, staged: name };
}

export type ProjectResult = { version: 1 } & Record<string, unknown>;
export async function runProject(args: string[], deps: ProjectDeps, signal: AbortSignal): Promise<ProjectResult> {
 try {
  const { verb, options } = parse(args);
  const context = await openRoot(deps, options.workspace, signal);
  const result: ProjectResult = verb === 'tree' ? await tree(context, options.path)
   : verb === 'file' ? await file(context, options.path!)
   : verb === 'status' ? await status(context)
   : verb === 'diff' ? await diff(context, options.path!, options.commit)
   : verb === 'log' ? await log(context, options.limit)
   : verb === 'show' ? await show(context, options.commit!)
   : verb === 'branches' ? await branches(context)
   : await stageLink(context, options.path!);
  signal.throwIfAborted();
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_OUTPUT) throw new Failure('TOO_LARGE');
  return result;
 } catch (error) {
  return projectFailure(error instanceof Failure ? error.code : 'PROJECT_FAILED');
 }
}
