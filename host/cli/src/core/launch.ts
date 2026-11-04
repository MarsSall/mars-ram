import type { ProcessRunner } from './herdr-switcher.ts';
import { allowedRepo, type RepoFiles } from './repos.ts';
export const PROGRAMS = { 'gentle-shell': 'gentle-shell', pi: 'pi', opencode: 'opencode' } as const;
export type Program = keyof typeof PROGRAMS;
export type ShortcutCode = 'BAD_ARGUMENT' | 'PROGRAM_NOT_ALLOWED' | 'PROGRAM_NOT_FOUND' | 'REPO_NOT_ALLOWED' | 'HERDR_UNAVAILABLE' | 'CONFIG_FAILED' | 'LOCAL_ONLY';
const messages: Record<ShortcutCode, string> = {
 BAD_ARGUMENT: 'Expected repos [--json] [--add-root <dir>|--remove-root <dir>] or launch --repo <absolute path> --program <gentle-shell|pi|opencode> [--json].',
 PROGRAM_NOT_ALLOWED: 'The program is not allowed.', PROGRAM_NOT_FOUND: 'The program was not found. After installing it, run mars-ram install in a terminal on the computer.',
 REPO_NOT_ALLOWED: 'The repository is not in the configured repository scan.', HERDR_UNAVAILABLE: 'Herdr did not complete the operation.',
 CONFIG_FAILED: 'Repository configuration could not be read or saved.', LOCAL_ONLY: 'Edit repository roots from an interactive terminal on the computer, not over SSH.',
};
export const shortcutFailure = (code: ShortcutCode) => ({ version: 1 as const, ok: false as const, code, message: messages[code] });
export type LaunchDeps = { files: RepoFiles; roots: string[]; run: ProcessRunner; herdr: string; installed(program: Program): Promise<boolean> };
const object = (v: unknown): Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const workspaceId = (v: unknown): v is string => typeof v === 'string' && /^w[A-Za-z0-9]{1,63}$/.test(v);
const childId = (v: unknown, w: string, kind: string): v is string => typeof v === 'string' && new RegExp(`^${w}:${kind}[A-Za-z0-9]{1,63}$`).test(v);
export async function runLaunch(args: string[], deps: LaunchDeps) {
 const values = new Map<string, string>();
 for (let i = 0; i < args.length; i++) {
  const flag = args[i]!;
  if (values.has(flag) || !['--json', '--repo', '--program'].includes(flag)) return shortcutFailure('BAD_ARGUMENT');
  const value = flag === '--json' ? '' : args[++i];
  if (value === undefined) return shortcutFailure('BAD_ARGUMENT');
  values.set(flag, value);
 }
 const program = values.get('--program'); const path = values.get('--repo');
 if (program === undefined || path === undefined) return shortcutFailure('BAD_ARGUMENT');
 if (!Object.hasOwn(PROGRAMS, program)) return shortcutFailure('PROGRAM_NOT_ALLOWED');
 const kind = program as Program;
 const repo = await allowedRepo(path, deps.roots, deps.files);
 if (!repo) return shortcutFailure('REPO_NOT_ALLOWED');
 if (!await deps.installed(kind)) return shortcutFailure('PROGRAM_NOT_FOUND');
 try {
  const command = async (args: string[]) => {
   const text = await deps.run(deps.herdr, args, { shell: false, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
   if (new TextEncoder().encode(text).length > 1024 * 1024) throw Error();
   // Herdr 0.9.5 pane run exits zero with no stdout after accepting input.
   // No other operation can substitute an empty response for its JSON envelope.
   if (args[0] === 'pane' && args[1] === 'run' && text === '') return {};
   const envelope = object(JSON.parse(text));
   if (envelope.error || !envelope.result || typeof envelope.result !== 'object' || Array.isArray(envelope.result)) throw Error();
   return object(envelope.result);
  };
  const focus = async (workspace: string, tab: string, reused: boolean) => {
   await command(['workspace', 'focus', workspace]); await command(['tab', 'focus', tab]);
   return { version: 1 as const, ok: true as const, reused, workspace, tab };
  };
  const workspaces = (await command(['workspace', 'list'])).workspaces;
  const panes = (await command(['pane', 'list'])).panes;
  if (!Array.isArray(workspaces) || !Array.isArray(panes) || panes.length > 500 || workspaces.length > 500) throw Error();
  for (const row of panes) {
   const p = object(row); const w = p.workspace_id;
   if (!workspaceId(w) || !childId(p.tab_id, w, 't') || !childId(p.pane_id, w, 'p') || !workspaces.some(r => object(r).workspace_id === w) || typeof p.cwd !== 'string') continue;
   if (deps.files.key(p.cwd) !== deps.files.key(repo.path)) continue;
   const info = object((await command(['pane', 'process-info', '--pane', p.pane_id])).process_info);
   if (!Array.isArray(info.foreground_processes)) throw Error();
   // Same process-info evidence as the switcher; session paths distinguish Gentle from plain Pi.
   const argv = info.foreground_processes.flatMap((r: unknown) => Array.isArray(object(r).argv) ? object(r).argv.filter((a: unknown) => typeof a === 'string') : []);
   const session = object(p.agent_session).value;
   const gentle = (typeof session === 'string' && /(?:^|[\\/])\.gentle-shell[\\/]/.test(session)) || argv.some((arg: string) => {
    const a = arg.includes('\\') || /^[A-Za-z]:\//.test(arg) ? arg.toLowerCase() : arg;
    const segments = a.split(/[\\/]/);
    return segments.includes('.gentle-shell') || ['gentle-shell', 'gentle-pi'].includes(segments.at(-1) ?? '');
   });
   const detected = gentle ? 'gentle-shell' : p.agent === 'pi' ? 'pi' : p.agent === 'opencode' ? 'opencode' : undefined;
   if (detected === kind && info.foreground_processes.length > 0) return await focus(w, p.tab_id, true);
  }
  // Revalidate immediately before creating; a host-side rename race is not a sandbox guarantee.
  if (!await allowedRepo(path, deps.roots, deps.files)) return shortcutFailure('REPO_NOT_ALLOWED');
  const created = await command(['workspace', 'create', '--cwd', repo.path, '--label', `${repo.name} · ${kind}`, '--no-focus']);
  const w = object(created.workspace).workspace_id; const t = object(created.tab).tab_id; const p = object(created.root_pane).pane_id;
  if (!workspaceId(w) || !childId(t, w, 't') || !childId(p, w, 'p')) throw Error();
  // Herdr queues this fixed literal in its shell. No caller-controlled string is command text.
  await command(['pane', 'run', p, PROGRAMS[kind]]);
  return await focus(w, t, false);
 } catch { return shortcutFailure('HERDR_UNAVAILABLE'); }
}
