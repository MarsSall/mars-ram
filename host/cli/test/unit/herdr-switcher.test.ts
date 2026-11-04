import { describe, expect, it } from 'vitest';
import { runHerdr, type ProcessRunner, type RunOptions } from '../../src/core/herdr-switcher.ts';
import { runProcess, resolveHerdr } from '../../src/adapters/herdr-switcher.ts';
import { parseArguments } from '../../src/arguments.ts';

const workspace = (id = 'w2G') => ({ workspace_id: id, label: 'Project', focused: true, agent_status: 'working', active_tab_id: `${id}:t2` });
const tab = (id = 'w2G:t2', status = 'blocked') => ({ tab_id: id, workspace_id: id.split(':')[0], label: 'Terminal', focused: true, agent_status: status });
class FakeRunner {
 calls: { file: string; args: readonly string[]; options: RunOptions }[] = [];
 workspaces: unknown[] = [workspace()];
 tabs: unknown[] = [tab()];
 panes: unknown[] = [{ tab_id: 'w2G:t2', cwd: '/project', agent: 'pi', agent_session: { value: '/home/test/.gentle-shell/agent/session' } }];
 git = 'feature/test\n';
 failure: unknown;
 override?: (file: string, args: readonly string[]) => string | undefined;
 run: ProcessRunner = async (file, args, options) => {
  this.calls.push({ file, args, options });
  if (this.failure) throw this.failure;
  const overridden = this.override?.(file, args); if (overridden !== undefined) return overridden;
  if (file === 'git') return this.git;
  return JSON.stringify({ result: args[1] === 'focus' ? {} : args[0] === 'workspace' ? { workspaces: this.workspaces } : args[0] === 'tab' ? { tabs: this.tabs } : { panes: this.panes } });
 };
}
const execute = (f: FakeRunner, args = ['list']) => runHerdr(args, { run: f.run, binary: 'herdr' });
const processInfo = (argv: unknown[][]) => JSON.stringify({ result: { process_info: { foreground_processes: argv.map(argv => ({ argv, cmdline: 'ignored', name: 'ignored' })) } } });
const processCalls = (f: FakeRunner) => f.calls.filter(c => c.args[1] === 'process-info');

 describe('Herdr foreground process kind fallback', () => {
 it.each([
  [['C:\\nodejs\\node.exe', 'C:\\tools\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js', '-e', 'C:\\Users\\test\\.pnpm\\store\\v11\\links\\@\\gentle-pi\\4.3.0-main\\node_modules\\gentle-pi']],
  [['node', '/home/test/.local/bin/gentle-shell'], ['pi']],
  [['C:\\Tools\\GENTLE-PI']],
  [['C:/Tools/GENTLE-SHELL']],
  [['node', '/home/test/.gentle-shell/agent/cli.js']],
 ])('recognizes Gentle Shell foreground argv %j', async (...argv) => {
  const f = new FakeRunner(); f.panes = [{ pane_id: 'w2G:p1', tab_id: 'w2G:t2', agent: 'pi' }];
  f.override = (_, args) => args[1] === 'process-info' ? processInfo(argv) : undefined;
  const result = await execute(f);
  expect(result).toMatchObject({ workspaces: [{ tabs: [{ kind: 'gentle-shell' }] }] });
  expect(processCalls(f)).toEqual([{ file: 'herdr', args: ['pane', 'process-info', '--pane', 'w2G:p1'], options: { shell: false, encoding: 'utf8', timeout: 3000, maxBuffer: 1048576 } }]);
  expect(JSON.stringify(result)).not.toContain('argv');
 });
 it.each([
  processInfo([['node', '/opt/pi/cli.js']]),
  processInfo([['node', '/opt/gentle-pi/cli.js', '/x/not-gentle-shell', '/x/.gentle-shell-other/cli.js']]),
  processInfo([['node', '/opt/GENTLE-SHELL']]),
  'garbage', '{}', '{"error":{"message":"private"}}',
  JSON.stringify({ result: { process_info: { foreground_processes: [{ cmdline: 'gentle-shell', name: 'gentle-pi' }, { argv: 'gentle-shell' }] } } }),
  JSON.stringify({ result: { process_info: { foreground_processes: null } } }),
  ' '.repeat(1048577) + processInfo([['gentle-shell']]),
  'failed',
 ])('keeps pi on plain, malformed, oversized or failed process info (%#)', async output => {
  const f = new FakeRunner(); f.panes = [{ pane_id: 'w2G:p1', tab_id: 'w2G:t2', agent: 'pi' }];
  f.override = (_, args) => { if (args[1] !== 'process-info') return undefined; if (output === 'failed') throw Error('private'); return output; };
  expect(await execute(f)).toMatchObject({ workspaces: [{ tabs: [{ kind: 'pi' }] }] });
  expect(processCalls(f)).toHaveLength(1);
 });
 it.each(['w2G:p1;whoami', 'wOther:p1', '--help', undefined])('rejects unsafe or cross-workspace pane id %s without probing', async pane_id => {
  const f = new FakeRunner(); f.panes = [{ pane_id, tab_id: 'w2G:t2', agent: 'pi' }];
  expect(await execute(f)).toMatchObject({ workspaces: [{ tabs: [{ kind: 'pi' }] }] });
  expect(processCalls(f)).toHaveLength(0);
 });
 it('probes only the chosen agent pane, not a shell, another agent, or a session-path match', async () => {
  const f = new FakeRunner(); f.tabs = [tab(), tab('w2G:t3'), tab('w2G:t4'), tab('w2G:t5')];
  f.panes = [
   { pane_id: 'w2G:p1', tab_id: 'w2G:t2' },
   { pane_id: 'w2G:p2', tab_id: 'w2G:t2', agent: 'pi' },
   { pane_id: 'w2G:p3', tab_id: 'w2G:t2', agent: 'pi' },
   { pane_id: 'w2G:p4', tab_id: 'w2G:t3', agent: 'codex' },
   { pane_id: 'w2G:p5', tab_id: 'w2G:t4' },
   { pane_id: 'w2G:p6', tab_id: 'w2G:t5', agent: 'pi', agent_session: { value: '/x/.gentle-shell/session' } },
  ];
  f.override = (_, args) => args[1] === 'process-info' ? processInfo([['gentle-shell']]) : undefined;
  expect(await execute(f)).toMatchObject({ workspaces: [{ tabs: [{ kind: 'gentle-shell' }, { kind: 'agent' }, { kind: 'shell' }, { kind: 'gentle-shell' }] }] });
  expect(processCalls(f).map(c => c.args)).toEqual([['pane', 'process-info', '--pane', 'w2G:p2']]);
 });
 it('caps process-info calls globally at 128 and concurrency at four', async () => {
  const f = new FakeRunner(); f.workspaces = [workspace('w0'), workspace('w1')];
  f.panes = Array.from({ length: 2 }, (_, w) => Array.from({ length: 80 }, (_, p) => ({ pane_id: `w${w}:p${p}`, tab_id: `w${w}:t${p}`, agent: 'pi' }))).flat();
  f.override = (_, args) => args[0] === 'tab' ? JSON.stringify({ result: { tabs: Array.from({ length: 80 }, (_, p) => tab(`${args[3]}:t${p}`)) } }) : args[1] === 'process-info' ? processInfo([['gentle-pi']]) : undefined;
  let active = 0, peak = 0;
  const run: ProcessRunner = async (...args) => { active++; peak = Math.max(peak, active); await Promise.resolve(); try { return await f.run(...args); } finally { active--; } };
  const result = await runHerdr(['list'], { run, binary: 'herdr' });
  expect(processCalls(f)).toHaveLength(128); expect(peak).toBeLessThanOrEqual(4);
  if (!('workspaces' in result)) throw Error('not list');
  const kinds = result.workspaces.flatMap(w => w.tabs.map(t => t.kind));
  expect(kinds.filter(k => k === 'gentle-shell')).toHaveLength(128);
  expect(kinds.filter(k => k === 'pi')).toHaveLength(32);
 });
});

describe('Herdr process deadline', () => {
 it('bounds a real child that ignores SIGTERM, with a self-exit safety net', async () => {
  const start = performance.now();
  const result = await runProcess(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setTimeout(() => process.exit(0), 1300)"], { shell: false, encoding: 'utf8', timeout: 300, maxBuffer: 1048576 }).catch(error => error);
  expect(performance.now() - start).toBeLessThan(1000);
  expect(result).toMatchObject({ code: 'ETIMEDOUT' });
 });
});

describe('Herdr switcher contract, using only a fake process runner', () => {
 it('maps the exact v1 shape, active-tab branch and bounded shell-free argv', async () => {
  const f = new FakeRunner();
  expect(await execute(f)).toEqual({ version: 1, truncated: false, workspaces: [{ id: 'w2G', label: 'Project', focused: true, status: 'working', branch: 'feature/test', tabs: [{ id: 'w2G:t2', label: 'Terminal', focused: true, status: 'blocked', kind: 'gentle-shell' }] }] });
  expect(f.calls.find(c => c.file === 'git')?.args).toEqual(['-C', '/project', 'rev-parse', '--abbrev-ref', 'HEAD']);
  for (const c of f.calls) expect(c.options).toEqual({ shell: false, encoding: 'utf8', timeout: c.file === 'git' ? 2000 : 3000, maxBuffer: 1048576 });
 });
 it.each(['working', 'blocked', 'done', 'idle', 'unknown', 'future'])('maps status %s without inventing activity', async status => {
  const f = new FakeRunner(); f.workspaces = [{ ...workspace(), agent_status: status }]; f.tabs = [tab('w2G:t2', status)];
  const result = await execute(f); if (!('workspaces' in result)) throw Error('not list');
  expect(result.workspaces[0]?.status).toBe(status === 'future' ? 'unknown' : status);
  expect(result.workspaces[0]?.tabs[0]?.status).toBe(status === 'future' ? 'unknown' : status);
 });
 it.each([
  [{ agent: 'pi', agent_session: { value: '/x/.pi/session' } }, 'pi'],
  [{ agent: 'pi', agent_session: { value: 'C:\\Users\\test\\.gentle-shell\\agent\\session' } }, 'gentle-shell'],
  [{ agent: 'pi', agent_session: { value: '/x/.gentle-shell-other/session' } }, 'pi'],
  [{}, 'shell'], [{ agent: 'codex' }, 'agent'],
 ])('maps pane agent %j to %s', async (pane, kind) => {
  const f = new FakeRunner(); f.panes = [{ tab_id: 'w2G:t2', ...pane }];
  const result = await execute(f); if (!('workspaces' in result)) throw Error('not list');
  expect(result.workspaces[0]?.tabs[0]?.kind).toBe(kind);
 });
 it('uses the first active-tab pane, once per workspace, never inactive cwd', async () => {
  const f = new FakeRunner(); f.panes = [{ tab_id: 'w2G:t1', cwd: '/inactive' }, ...f.panes, { tab_id: 'w2G:t2', cwd: '/second' }];
  await execute(f); expect(f.calls.filter(c => c.file === 'git')).toHaveLength(1);
  expect(f.calls.find(c => c.file === 'git')?.args[1]).toBe('/project');
 });
 it('resolves detached HEAD to a short sha and returns null on git failure', async () => {
  const f = new FakeRunner(); f.override = (file, args) => file === 'git' ? args.includes('--short') ? 'a1b2c3d\n' : 'HEAD\n' : undefined;
  let result = await execute(f); if (!('workspaces' in result)) throw Error('not list');
  expect(result.workspaces[0]?.branch).toBe('a1b2c3d');
  f.override = file => { if (file === 'git') throw Error('private path'); return undefined; };
  result = await execute(f); if (!('workspaces' in result)) throw Error('not list');
  expect(result.workspaces[0]?.branch).toBeNull();
 });
 it('caps concurrent workspace/branch lookups at four', async () => {
  const f = new FakeRunner(); f.workspaces = Array.from({ length: 12 }, (_, i) => workspace(`w${i}`));
  f.panes = Array.from({ length: 12 }, (_, i) => ({ tab_id: `w${i}:t2`, cwd: `/project/${i}` }));
  f.override = (file, args) => file !== 'git' && args[0] === 'tab' ? JSON.stringify({ result: { tabs: [tab(`${args[3]}:t2`)] } }) : undefined;
  let active = 0, peak = 0, gitCalls = 0;
  const run: ProcessRunner = async (...args) => { active++; peak = Math.max(peak, active); if (args[0] === 'git') gitCalls++; await Promise.resolve(); try { return await f.run(...args); } finally { active--; } };
  await runHerdr(['list'], { run, binary: 'herdr' }); expect(peak).toBeLessThanOrEqual(4); expect(gitCalls).toBe(12);
 });
 it.each([['focus'], ['focus', 'w2G;whoami'], ['focus', '-w2G'], ['focus', 'w2G', 'w23:t2'], ['focus', 'w2G', 'w2G:t2\n'], ['focus', 'w2G', 'w2G:t2', 'extra'], ['list', 'extra'], ['other']])('rejects bad argv %j before any process', async (...args) => {
  const f = new FakeRunner(); expect(await execute(f, args)).toMatchObject({ version: 1, ok: false, code: 'BAD_ID' }); expect(f.calls).toHaveLength(0);
 });
 it('focuses a validated existing workspace then its tab (shared PC focus)', async () => {
  const f = new FakeRunner(); expect(await execute(f, ['focus', 'w2G', 'w2G:t2'])).toEqual({ version: 1, ok: true });
  expect(f.calls.filter(c => c.args[1] === 'focus').map(c => c.args)).toEqual([['workspace', 'focus', 'w2G'], ['tab', 'focus', 'w2G:t2']]);
 });
 it('allows workspace-only focus', async () => {
  const f = new FakeRunner(); expect(await execute(f, ['focus', 'w2G'])).toEqual({ version: 1, ok: true });
  expect(f.calls.at(-1)?.args).toEqual(['workspace', 'focus', 'w2G']);
 });
 it.each([['w23'], ['w2G', 'w2G:t9']])('returns NOT_FOUND without focusing a missing target %j', async (...ids) => {
  const f = new FakeRunner(); expect(await execute(f, ['focus', ...ids])).toMatchObject({ ok: false, code: 'NOT_FOUND' }); expect(f.calls.some(c => c.args[1] === 'focus')).toBe(false);
 });
 it.each([['ENOENT', 'HERDR_NOT_FOUND'], ['ETIMEDOUT', 'HERDR_FAILED'], ['ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'HERDR_FAILED']])('sanitizes process failure %s', async (code, expected) => {
  const f = new FakeRunner(); f.failure = Object.assign(Error('secret /private/path'), { code });
  const result = await execute(f); expect(result).toMatchObject({ version: 1, ok: false, code: expected }); expect(JSON.stringify(result)).not.toContain('private');
 });
 it.each(['garbage', '{}', '{"error":{"message":"secret"}}', 'x'.repeat(1048577)])('rejects invalid envelopes or oversized output', async output => {
  const f = new FakeRunner(); f.override = () => output;
  expect(await execute(f)).toMatchObject({ ok: false, code: 'HERDR_FAILED' });
 });
 it('rejects a failed focus envelope and never focuses the tab after it', async () => {
  const f = new FakeRunner(); f.override = (_, args) => args[1] === 'focus' ? '{"error":{"message":"private"}}' : undefined;
  expect(await execute(f, ['focus', 'w2G', 'w2G:t2'])).toMatchObject({ code: 'HERDR_FAILED' });
  expect(f.calls.filter(c => c.args[1] === 'focus')).toHaveLength(1);
 });
 it('drops malformed/duplicate entries and bounds labels, counts and branch values', async () => {
  const f = new FakeRunner(); f.workspaces = [null, { ...workspace(), workspace_id: 'bad;id' }, { ...workspace(), focused: 'yes' }, { ...workspace(), label: 'a'.repeat(500) }, workspace()];
  f.tabs = [null, tab('w23:t1'), { ...tab(), label: 42 }, { ...tab(), label: 'b'.repeat(500) }, tab()]; f.git = 'x'.repeat(500);
  const result = await execute(f); if (!('workspaces' in result)) throw Error('not list');
  expect(result.workspaces).toHaveLength(1); expect(result.workspaces[0]?.label.length).toBeLessThanOrEqual(256);
  expect(result.workspaces[0]?.tabs).toHaveLength(1); expect(result.workspaces[0]?.tabs[0]?.label.length).toBeLessThanOrEqual(256); expect(result.workspaces[0]?.branch).toBeNull();
  f.workspaces = Array.from({ length: 300 }, (_, i) => workspace(`w${i}`)); f.tabs = Array.from({ length: 300 }, (_, i) => tab(`w0:t${i}`));
  const bounded = await execute(f); if (!('workspaces' in bounded)) throw Error('not list');
  expect(bounded.workspaces.length).toBeLessThanOrEqual(128); expect(bounded.workspaces[0]?.tabs.length).toBeLessThanOrEqual(128); expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(1048576);
 });
 it.each([128, 129])('reports workspace truncation at %i entries', async count => {
  const f = new FakeRunner(); f.workspaces = Array.from({ length: count }, (_, i) => workspace(`w${i}`));
  expect(await execute(f)).toMatchObject({ truncated: count > 128 });
 });
 it.each([128, 129])('reports tab truncation at %i entries', async count => {
  const f = new FakeRunner(); f.tabs = Array.from({ length: count }, (_, i) => tab(`w2G:t${i}`));
  const result = await execute(f);
  expect(result).toMatchObject({ truncated: count > 128 });
  if (!('workspaces' in result)) throw Error('not list');
  expect(result.workspaces[0]?.tabs).toHaveLength(Math.min(count, 128));
 });
 it.each([
  ['2', '\u0000π - project\u009f' + 'x'.repeat(300), ('π - project' + 'x'.repeat(300)).slice(0, 256)],
  ['002', 'First pane', 'First pane'], ['Named', 'Pane title', 'Named'],
  ['2', undefined, '2'], ['2', '\u0000\u009f', '2'], ['2', 42, '2'],
 ])('uses the sanitized first pane title only for numeric label %s', async (name, title, expected) => {
  const f = new FakeRunner(); f.tabs = [{ ...tab(), label: name }];
  f.panes = [{ tab_id: 'w2G:t2', terminal_title_stripped: title }, { tab_id: 'w2G:t2', terminal_title_stripped: 'Second pane', agent: 'pi' }];
  const result = await execute(f); if (!('workspaces' in result)) throw Error('not list');
  expect(result.workspaces[0]?.tabs[0]?.label).toBe(expected);
 });
 it('resolves only validated recorded executables, with platform PATH fallbacks', () => {
  expect(resolveHerdr('{"herdr":"/opt/herdr"}', 'linux')).toBe('/opt/herdr');
  expect(resolveHerdr('{"herdr":"C:\\\\Tools\\\\herdr.exe"}', 'win32')).toBe('C:\\Tools\\herdr.exe');
  expect(resolveHerdr('{"herdr":"/bin/sh"}', 'linux')).toBe('herdr');
  expect(resolveHerdr('invalid', 'win32')).toBe('herdr.exe');
 });
 it('routes every herdr argv to the JSON command, including invalid ids/usage', () => {
  for (const args of [['list'], ['focus', 'w2G', 'w2G:t2'], ['focus', ';'], []]) expect(parseArguments(['herdr', ...args])).toEqual({ ok: true, command: 'herdr', args });
 });
});
