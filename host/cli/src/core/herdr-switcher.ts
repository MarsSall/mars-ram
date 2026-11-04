// Narrow Terminal operations for the host command. No shell, filesystem or process APIs in policy.
export type RunOptions = { shell: false; encoding: 'utf8'; timeout: number; maxBuffer: number };
/** Injection seam for the shell-free Terminal adapter, shared by all switcher tests. */
export type ProcessRunner = (file: string, args: readonly string[], options: RunOptions) => Promise<string>;
type Status = 'working' | 'blocked' | 'done' | 'idle' | 'unknown';
type Tab = { id: string; label: string; focused: boolean; status: Status; kind: 'pi' | 'gentle-shell' | 'shell' | 'agent' };
type Workspace = { id: string; label: string; focused: boolean; status: Status; branch: string | null; tabs: Tab[] };
type ErrorCode = 'HERDR_NOT_FOUND' | 'HERDR_FAILED' | 'BAD_ID' | 'NOT_FOUND';
export type HerdrResult = { version: 1; truncated: boolean; workspaces: Workspace[] } | { version: 1; ok: true } | { version: 1; ok: false; code: ErrorCode; message: string };
const MAX_BYTES = 1024 * 1024;
const MAX_ENTRIES = 128;
const workspaceId = (id: unknown): id is string => typeof id === 'string' && /^w[A-Za-z0-9]{1,63}$/.test(id);
const tabId = (id: unknown, workspace: string): id is string => typeof id === 'string' && /^w[A-Za-z0-9]{1,63}:t[A-Za-z0-9]{1,63}$/.test(id) && id.split(':')[0] === workspace;
const paneId = (id: unknown, workspace: string): id is string => typeof id === 'string' && /^w[A-Za-z0-9]{1,63}:p[A-Za-z0-9]{1,63}$/.test(id) && id.split(':')[0] === workspace;
function gentleArg(value: unknown): boolean {
 if (typeof value !== 'string') return false;
 // Windows paths are case-insensitive; Unix paths retain their case.
 const path = value.includes('\\') || /^[A-Za-z]:\//.test(value) ? value.toLowerCase() : value;
 const segments = path.split(/[\\/]/);
 return segments.includes('.gentle-shell') || ['gentle-shell', 'gentle-pi'].includes(segments.at(-1) ?? '');
}
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const status = (value: unknown): Status => value === 'working' || value === 'blocked' || value === 'done' || value === 'idle' ? value : 'unknown';
const label = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 256);
const validRow = (row: Record<string, unknown>) => typeof row.label === 'string' && typeof row.focused === 'boolean';
const messages: Record<ErrorCode, string> = {
 HERDR_NOT_FOUND: 'Herdr executable was not found. Install Herdr and check the recorded path.',
 HERDR_FAILED: 'Herdr did not complete the operation.',
 BAD_ID: 'Expected herdr list or herdr focus <workspaceId> [<tabId>] with valid, matching Herdr ids.',
 NOT_FOUND: 'The requested workspace or tab no longer exists.',
};
class HerdrFailure extends Error {
 readonly code: ErrorCode;
 constructor(code: ErrorCode) { super(messages[code]); this.code = code; }
}
async function capped<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
 const results: R[] = new Array(items.length); let next = 0;
 await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
  while (next < items.length) { const index = next++; results[index] = await work(items[index]!); }
 }));
 return results;
}

export async function runHerdr(args: string[], deps: { run: ProcessRunner; binary: string }): Promise<HerdrResult> {
 const [verb, workspace, tab] = args;
 try {
  if (!(verb === 'list' && args.length === 1) && !(verb === 'focus' && (args.length === 2 || args.length === 3) && workspaceId(workspace) && (tab === undefined || tabId(tab, workspace)))) throw new HerdrFailure('BAD_ID');
  const command = async (argv: string[]): Promise<Record<string, unknown>> => {
   let text: string;
   try { text = await deps.run(deps.binary, argv, { shell: false, encoding: 'utf8', timeout: 3000, maxBuffer: MAX_BYTES }); }
   catch (error) { throw new HerdrFailure(record(error).code === 'ENOENT' ? 'HERDR_NOT_FOUND' : 'HERDR_FAILED'); }
   try {
    if (new TextEncoder().encode(text).length > MAX_BYTES) throw Error();
    const envelope = record(JSON.parse(text));
    if (envelope.error || !envelope.result || typeof envelope.result !== 'object' || Array.isArray(envelope.result)) throw Error();
    return record(envelope.result);
   } catch { throw new HerdrFailure('HERDR_FAILED'); }
  };
  const rows = async (argv: string[], field: string): Promise<Record<string, unknown>[]> => {
   const result = await command(argv);
   if (!Array.isArray(result[field])) throw new HerdrFailure('HERDR_FAILED');
   return result[field].map(record);
  };
  const workspaces = (await rows(['workspace', 'list'], 'workspaces')).filter(row => workspaceId(row.workspace_id) && validRow(row));
  const tabsFor = async (id: string) => (await rows(['tab', 'list', '--workspace', id], 'tabs')).filter(row => tabId(row.tab_id, id) && row.workspace_id === id && validRow(row));
  if (verb === 'focus') {
   if (!workspaces.some(row => row.workspace_id === workspace)) throw new HerdrFailure('NOT_FOUND');
   if (tab !== undefined && !(await tabsFor(workspace!)).some(row => row.tab_id === tab)) throw new HerdrFailure('NOT_FOUND');
   await command(['workspace', 'focus', workspace!]);
   if (tab !== undefined) await command(['tab', 'focus', tab]);
   return { version: 1, ok: true };
  }
  const panes = await rows(['pane', 'list'], 'panes');
  const git = async (cwd: unknown): Promise<string | null> => {
   if (typeof cwd !== 'string' || cwd.length > 4096 || /[\x00-\x1f]/.test(cwd) || !/^(?:\/|[A-Za-z]:[\\/])/.test(cwd)) return null;
   try {
    const run = (flags: string[]) => deps.run('git', ['-C', cwd, 'rev-parse', ...flags, 'HEAD'], { shell: false, encoding: 'utf8', timeout: 2000, maxBuffer: MAX_BYTES });
    let branch = (await run(['--abbrev-ref'])).trim();
    if (branch === 'HEAD') branch = (await run(['--short'])).trim();
    return branch.length > 0 && branch.length <= 256 && !/[\x00-\x1f\x7f-\x9f]/.test(branch) ? branch : null;
   } catch { return null; }
  };
  // A separate, globally capped pass avoids multiplying concurrency across workspaces.
  const probes: { pane: string; tab: Tab }[] = [];
  const seen = new Set<string>();
  const unique = workspaces.filter(row => { const id = row.workspace_id as string; if (seen.has(id)) return false; seen.add(id); return true; });
  let truncated = unique.length > MAX_ENTRIES;
  const result = await capped(unique.slice(0, MAX_ENTRIES), async (row): Promise<Workspace> => {
   const id = row.workspace_id as string;
   const tabSeen = new Set<string>();
   const allTabs = (await tabsFor(id)).filter(t => { const key = t.tab_id as string; if (tabSeen.has(key)) return false; tabSeen.add(key); return true; });
   if (allTabs.length > MAX_ENTRIES) truncated = true;
   const tabs = allTabs.slice(0, MAX_ENTRIES);
   const active = tabs.find(t => t.tab_id === row.active_tab_id);
   const firstPane = active ? panes.find(p => p.tab_id === active.tab_id) : undefined;
   return { id, label: label(row.label as string), focused: row.focused as boolean, status: status(row.agent_status), branch: await git(firstPane?.cwd), tabs: tabs.map(t => {
    const title = panes.find(p => p.tab_id === t.tab_id)?.terminal_title_stripped;
    const paneTitle = typeof title === 'string' ? label(title) : '';
    const tabLabel = /^\d+$/.test(t.label as string) && paneTitle ? paneTitle : label(t.label as string);
    const pane = panes.find(p => p.tab_id === t.tab_id && typeof p.agent === 'string' && p.agent.length > 0) ?? panes.find(p => p.tab_id === t.tab_id);
    const agent = pane?.agent;
    const session = record(pane?.agent_session).value;
    const gentle = typeof session === 'string' && session.length <= 4096 && /(?:^|[\\/])\.gentle-shell[\\/]/.test(session);
    const result: Tab = { id: t.tab_id as string, label: tabLabel, focused: t.focused as boolean, status: status(t.agent_status), kind: agent === 'pi' ? gentle ? 'gentle-shell' : 'pi' : typeof agent === 'string' && agent.length > 0 ? 'agent' : 'shell' };
    if (result.kind === 'pi' && paneId(pane?.pane_id, id) && probes.length < MAX_ENTRIES) probes.push({ pane: pane.pane_id, tab: result });
    return result;
   }) };
  });
  await capped(probes, async probe => {
   try {
    const info = await command(['pane', 'process-info', '--pane', probe.pane]);
    const processes = record(info.process_info).foreground_processes;
    if (Array.isArray(processes) && processes.some(process => {
     const argv = record(process).argv;
     return Array.isArray(argv) && argv.every(arg => typeof arg === 'string') && argv.some(gentleArg);
    })) probe.tab.kind = 'gentle-shell';
   } catch { /* Optional metadata: missing, invalid or failed process info leaves Pi unchanged. */ }
  });
  // JSON escaping can expand even bounded labels. Refuse, never emit a partial oversized snapshot.
  const response = { version: 1 as const, truncated, workspaces: result };
  if (new TextEncoder().encode(JSON.stringify(response)).length > MAX_BYTES) throw new HerdrFailure('HERDR_FAILED');
  return response;
 } catch (error) {
  const code = error instanceof HerdrFailure ? error.code : 'HERDR_FAILED';
  return { version: 1, ok: false, code, message: messages[code] };
 }
}
