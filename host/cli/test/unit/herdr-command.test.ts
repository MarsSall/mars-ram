import { afterEach, describe, expect, it, vi } from 'vitest';
import { herdrCommand } from '../../src/herdr-command.ts';
import { runProcess } from '../../src/adapters/herdr-switcher.ts';

vi.mock('../../src/adapters/herdr-switcher.ts', () => ({ recordedHerdr: () => '/tools/herdr', runProcess: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
function sink(immediate = false) {
 const lines: string[] = []; let finish: (() => void) | undefined;
 return { lines, release: () => finish?.(), out: { write(chunk: string, done: (error?: Error | null) => void) { lines.push(chunk); finish = () => done(); if (immediate) done(); return false; } } };
}
describe('Herdr command stdout and exit contract (no real processes)', () => {
 it('returns only after stdout accepted the whole response, so the caller can exit safely', async () => {
  const stdout = sink();
  vi.mocked(runProcess).mockResolvedValue('{"result":{"workspaces":[],"panes":[]}}');
  let settled = false;
  const pending = herdrCommand(['list'], stdout.out).then(code => { settled = true; return code; });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(stdout.lines).toEqual(['{"version":1,"truncated":false,"workspaces":[]}\n']);
  expect(settled).toBe(false);
  stdout.release();
  expect(await pending).toBe(0);
 });
 it('prints exactly the list JSON and returns zero', async () => {
  const stdout = sink(true);
  vi.mocked(runProcess).mockResolvedValue('{"result":{"workspaces":[],"panes":[]}}');
  expect(await herdrCommand(['list'], stdout.out)).toBe(0);
  expect(stdout.lines).toEqual(['{"version":1,"truncated":false,"workspaces":[]}\n']);
 });
 it('prints exactly focus success and returns zero', async () => {
  const stdout = sink(true);
  vi.mocked(runProcess).mockResolvedValue('{"result":{"workspaces":[{"workspace_id":"w2G","label":"Project","focused":false}]}}');
  expect(await herdrCommand(['focus', 'w2G'], stdout.out)).toBe(0);
  expect(stdout.lines).toEqual(['{"version":1,"ok":true}\n']);
 });
 it('prints one sanitized error object on stdout and returns one', async () => {
  const stdout = sink(true);
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(runProcess).mockRejectedValue(new Error('private child output'));
  expect(await herdrCommand(['list'], stdout.out)).toBe(1);
  expect(stdout.lines).toHaveLength(1);
  expect(JSON.parse(stdout.lines[0]!)).toEqual({ version: 1, ok: false, code: 'HERDR_FAILED', message: 'Herdr did not complete the operation.' });
  expect(err).not.toHaveBeenCalled();
 });
});
