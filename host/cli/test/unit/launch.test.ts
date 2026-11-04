import { expect, it } from 'vitest';
import { runLaunch } from '../../src/core/launch.ts';
import type { ProcessRunner } from '../../src/core/herdr-switcher.ts';
import { fakeFiles } from './fixtures/repo-files.ts';
const files = () => fakeFiles({ '/work': 'dir', '/work/repo': 'dir', '/work/repo/.git': 'dir' });
function setup(reuse = false, argv = ['node', '/opt/pi/dist/cli.js'], session?: string) {
 const calls: readonly string[][] = [];
 const run: ProcessRunner = async (_file, args, opts) => {
  expect(opts.shell).toBe(false); (calls as string[][]).push([...args]);
  let result: object = {};
  if (args[0] === 'workspace' && args[1] === 'list') result = { workspaces: reuse ? [{ workspace_id: 'w1' }] : [] };
  if (args[0] === 'pane' && args[1] === 'list') result = { panes: reuse ? [{ workspace_id: 'w1', tab_id: 'w1:t1', pane_id: 'w1:p1', cwd: '/work/repo', agent: 'pi', agent_session: { value: session } }] : [] };
  if (args[1] === 'process-info') result = { process_info: { foreground_processes: [{ argv }] } };
  if (args[1] === 'create') result = { workspace: { workspace_id: 'w2' }, tab: { tab_id: 'w2:t1' }, root_pane: { pane_id: 'w2:p1' } };
  return JSON.stringify({ result });
 };
 return { calls, deps: { files: files(), roots: ['/work'], run, herdr: 'herdr', installed: async () => true } };
}
it('creates, labels, starts a fixed command and focuses', async () => {
 const { deps, calls } = setup();
 expect(await runLaunch(['--repo', '/work/repo', '--program', 'pi', '--json'], deps)).toEqual({ version: 1, ok: true, reused: false, workspace: 'w2', tab: 'w2:t1' });
 expect(calls).toContainEqual(['workspace', 'create', '--cwd', '/work/repo', '--label', 'repo · pi', '--no-focus']);
 expect(calls).toContainEqual(['pane', 'run', 'w2:p1', 'pi']);
 expect(calls).toContainEqual(['tab', 'focus', 'w2:t1']);
});
it('accepts the empty stdout returned by a successful Herdr 0.9.5 pane run', async () => {
 const { deps, calls } = setup();
 const run = deps.run;
 deps.run = async (file, args, options) => {
  const output = await run(file, args, options);
  return args[0] === 'pane' && args[1] === 'run' ? '' : output;
 };
 expect(await runLaunch(['--repo', '/work/repo', '--program', 'pi'], deps)).toMatchObject({ ok: true, reused: false, workspace: 'w2', tab: 'w2:t1' });
 expect(calls).toContainEqual(['workspace', 'focus', 'w2']);
 expect(calls).toContainEqual(['tab', 'focus', 'w2:t1']);
});
it.each(['failure', 'bad-json', 'error-envelope'])('does not focus after pane run %s', async failure => {
 const { deps, calls } = setup(); const run = deps.run;
 deps.run = async (file, args, options) => {
  const output = await run(file, args, options);
  if (args[0] !== 'pane' || args[1] !== 'run') return output;
  if (failure === 'failure') throw Object.assign(Error('failed'), { code: 1, stdout: '' });
  return failure === 'bad-json' ? 'not json' : JSON.stringify({ error: { message: 'failed' } });
 };
 expect(await runLaunch(['--repo', '/work/repo', '--program', 'pi'], deps)).toMatchObject({ ok: false, code: 'HERDR_UNAVAILABLE' });
 expect(calls.filter(args => args[1] === 'run')).toHaveLength(1);
 expect(calls.some(args => args[1] === 'focus')).toBe(false);
});
it('does not accept empty stdout from list', async () => {
 const { deps } = setup(); deps.run = async () => '';
 expect(await runLaunch(['--repo', '/work/repo', '--program', 'pi'], deps)).toMatchObject({ ok: false, code: 'HERDR_UNAVAILABLE' });
});
it('reuses the matching cwd and program without creating', async () => {
 const { deps, calls } = setup(true);
 expect(await runLaunch(['--repo', '/work/repo', '--program', 'pi'], deps)).toMatchObject({ ok: true, reused: true, workspace: 'w1', tab: 'w1:t1' });
 expect(calls.some(a => a[1] === 'create' || a[1] === 'run')).toBe(false);
});
it.each(['sh', 'pi; touch /tmp/no', '', '--help', '__proto__'])('rejects unknown program %s before processes', async program => {
 const { deps, calls } = setup();
 expect(await runLaunch(['--repo', '/work/repo', '--program', program], deps)).toMatchObject({ ok: false, code: 'PROGRAM_NOT_ALLOWED' }); expect(calls).toHaveLength(0);
});
it('rejects a non-allowed repo before processes', async () => {
 const { deps, calls } = setup();
 expect(await runLaunch(['--repo', '/outside', '--program', 'pi'], deps)).toMatchObject({ code: 'REPO_NOT_ALLOWED' }); expect(calls).toHaveLength(0);
});
it('reports missing program', async () => {
 const { deps } = setup(); deps.installed = async () => false;
 expect(await runLaunch(['--repo', '/work/repo', '--program', 'pi'], deps)).toMatchObject({ code: 'PROGRAM_NOT_FOUND', message: expect.stringMatching(/mars-ram install.*terminal on the computer/i) });
});
it('reports unavailable Herdr without leaking process errors', async () => {
 const { deps } = setup(); deps.run = async () => { throw Error('private details'); };
 expect(await runLaunch(['--repo', '/work/repo', '--program', 'pi'], deps)).toMatchObject({ code: 'HERDR_UNAVAILABLE', message: 'Herdr did not complete the operation.' });
});
it('distinguishes Gentle Shell using its session path', async () => {
 const { deps } = setup(true, undefined, '/home/test/.gentle-shell/agent/session.jsonl');
 expect(await runLaunch(['--repo', '/work/repo', '--program', 'gentle-shell'], deps)).toMatchObject({ reused: true });
});
it('distinguishes Gentle Shell using foreground argv', async () => {
 const { deps } = setup(true, ['node', '/home/test/.local/bin/gentle-shell']);
 expect(await runLaunch(['--repo', '/work/repo', '--program', 'gentle-shell'], deps)).toMatchObject({ reused: true });
 expect(await runLaunch(['--repo', '/work/repo', '--program', 'pi'], deps)).toMatchObject({ reused: false });
});
it.each([['--program', 'pi'], ['--repo', '/work/repo', '--program', 'pi', '--json', '--json'], ['--repo', '/work/repo', '--program', 'pi', '--other']])('rejects malformed options %j', async (...args) => {
 const { deps, calls } = setup(); expect(await runLaunch(args, deps)).toMatchObject({ code: 'BAD_ARGUMENT' }); expect(calls).toHaveLength(0);
});
it('fails closed on malformed Herdr JSON', async () => {
 const { deps } = setup(); deps.run = async () => '{bad';
 expect(await runLaunch(['--repo', '/work/repo', '--program', 'pi'], deps)).toMatchObject({ code: 'HERDR_UNAVAILABLE' });
});
it('does not reuse a different program', async () => {
 const { deps } = setup(true);
 expect(await runLaunch(['--repo', '/work/repo', '--program', 'opencode'], deps)).toMatchObject({ reused: false });
});
