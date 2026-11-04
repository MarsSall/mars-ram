import { constants, readFileSync } from 'node:fs';
import { access, lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join, posix, win32 } from 'node:path';
import { APP_ID } from '@workspace/protocol';
import { safeAbsolute, type RepoFiles } from '../core/repos.ts';
import type { Program } from '../core/launch.ts';
export function createRepoFiles(platform = process.platform): RepoFiles {
 const paths = platform === 'win32' ? win32 : posix;
 return {
  realpath, join: paths.join, absolute: p => paths.isAbsolute(p) && (platform !== 'win32' || /^[A-Za-z]:[\\/]/.test(p)), name: paths.basename,
  key: p => platform === 'win32' ? paths.normalize(p).toLowerCase() : p,
  within: (root, p) => { const relative = paths.relative(root, p); return relative !== '..' && !relative.startsWith('..' + paths.sep) && !paths.isAbsolute(relative); },
  kind: async p => { try { const s = await lstat(p); return s.isSymbolicLink() ? 'link' : s.isDirectory() ? 'dir' : s.isFile() ? 'file' : null; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; } },
  list: readdir,
 };
}
export function localRootEdit(env: NodeJS.ProcessEnv, tty: boolean): boolean {
 return tty && !env.SSH_CONNECTION && !env.SSH_CLIENT && !env.SSH_TTY;
}
export function createRepoConfig(home = homedir(), files = createRepoFiles()) {
 const directory = files.join(home, `.${APP_ID}`); const path = files.join(directory, 'host.json');
 const load = async (): Promise<Record<string, unknown>> => {
  const directoryKind = await files.kind(directory);
  if (directoryKind !== null && directoryKind !== 'dir') throw Error();
  const kind = await files.kind(path); if (kind === null) return {};
  if (kind !== 'file' || (await lstat(path)).size > 1024 * 1024) throw Error();
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
  return value as Record<string, unknown>;
 };
 const rootsOf = async (config: Record<string, unknown>): Promise<string[]> => {
  if (config.repoRoots !== undefined) {
   if (!Array.isArray(config.repoRoots) || config.repoRoots.length > 100 || !config.repoRoots.every(p => typeof p === 'string' && safeAbsolute(p, files))) throw Error();
   return config.repoRoots as string[];
  }
  const work = files.join(home, 'Work'); return await files.kind(work) === 'dir' ? [await files.realpath(work)] : [];
 };
 return {
  roots: async () => rootsOf(await load()),
  edit: async (action: 'add' | 'remove', input: string) => {
   if (!safeAbsolute(input, files)) throw Error();
   const config = await load(); const roots = await rootsOf(config);
   const root = action === 'add' ? await files.realpath(input) : input;
   if (action === 'add' && await files.kind(root) !== 'dir') throw Error();
   const next = roots.filter(p => files.key(p) !== files.key(root));
   if (action === 'add') next.push(root);
   if (next.length > 100) throw Error();
   await mkdir(directory, { recursive: true, mode: 0o700 });
   if (await files.kind(directory) !== 'dir') throw Error();
   const temporary = files.join(directory, `repos-${randomUUID()}.tmp`);
   await writeFile(temporary, JSON.stringify({ ...config, repoRoots: next.sort() }) + '\n', { flag: 'wx', mode: 0o600 });
   await rename(temporary, path);
   return next;
  },
 };
}
const PROGRAM_NAMES: readonly Program[] = ['gentle-shell', 'pi', 'opencode'];
async function executableFile(file: string, windows: boolean): Promise<boolean> {
 try { await access(file, windows ? constants.F_OK : constants.X_OK); return (await lstat(await realpath(file))).isFile(); } catch { return false; }
}
async function onPath(program: Program, path: string): Promise<string | null> {
 const windows = process.platform === 'win32'; const paths = windows ? win32 : posix;
 for (const dir of path.split(windows ? ';' : ':')) {
  if (!paths.isAbsolute(dir)) continue; // Never search cwd/relative PATH entries.
  for (const suffix of windows ? ['.exe', '.cmd', '.bat', ''] : ['']) {
   const file = paths.join(dir, program + suffix);
   if (await executableFile(file, windows)) return file;
  }
 }
 return null;
}
/** Run by `mars-ram install` in a local terminal: where the allowlisted programs live on the user's full PATH. */
export async function findPrograms(path = process.env.PATH ?? ''): Promise<Partial<Record<Program, string>>> {
 const found: Partial<Record<Program, string>> = {};
 for (const program of PROGRAM_NAMES) { const file = await onPath(program, path); if (file) found[program] = await realpath(file); }
 return found;
}
/**
 * A program counts as installed when it is on this process's PATH or at the absolute path `mars-ram install`
 * recorded. Over SSH the PATH is often the non-interactive one (for example without ~/Library/pnpm/bin), while the
 * Herdr pane that runs the program is an interactive shell. The recorded path is only a presence check: the pane
 * still runs the fixed program name.
 */
export async function installedProgram(program: Program, recorded: unknown = recordedPrograms(), path = process.env.PATH ?? ''): Promise<boolean> {
 if (!PROGRAM_NAMES.includes(program)) return false; // Defense in depth: launch already checks the allowlist.
 if (await onPath(program, path)) return true;
 const windows = process.platform === 'win32'; const paths = windows ? win32 : posix;
 if (!recorded || typeof recorded !== 'object' || Array.isArray(recorded) || !Object.hasOwn(recorded, program)) return false;
 const file = (recorded as Record<string, unknown>)[program];
 return typeof file === 'string' && paths.isAbsolute(file) && await executableFile(file, windows);
}
function recordedPrograms(): unknown {
 try { return (JSON.parse(readFileSync(join(homedir(), `.${APP_ID}`, 'host.json'), 'utf8')) as Record<string, unknown>).programs; } catch { return undefined; }
}
