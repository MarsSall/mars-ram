import { describe, it, expect } from 'vitest';
import { NoticeRules, deliverNotice } from '../../src/core/notifier.ts';
import { boundedLines } from '../../src/adapters/notifier.ts';
describe('host notice policy', () => {
 it('reads bounded UTF-8 lines, including a final state response without a newline', async () => {
  const stream = (text: string) => new ReadableStream<Uint8Array>({ start(c) { const bytes = new TextEncoder().encode(text); c.enqueue(bytes.slice(0, 2)); c.enqueue(bytes.slice(2)); c.close(); } });
  const lines: string[] = [];
  for await (const line of boundedLines(stream('á\nstate'), new AbortController().signal, 8)) lines.push(line);
  expect(lines).toEqual(['á', 'state']);
  await expect(async () => { for await (const _line of boundedLines(stream('123456789'), new AbortController().signal, 8)) {} }).rejects.toThrow('Oversized');
 });
 it('is silent until snapshot, deduplicates and applies the outcome version gate', () => {
  const rules = new NoticeRules();
  expect(rules.event('one', 1, 'prompt_start')).toBeNull();
  rules.snapshot('one', 5, '1.6');
  expect(rules.event('one', 5, 'prompt_start')).toBeNull();
  expect(rules.event('one', 6, 'prompt_start')).toBe('needs-answer');
  expect(rules.event('one', 6, 'prompt_start')).toBeNull();
  expect(rules.event('one', 7, 'agent_settled')).toBeNull();
  expect(rules.event('one', 8, 'agent_settled', 'completed')).toBe('finished');
  expect(rules.event('one', 9, 'agent_settled', 'failed')).toBe('failed');
  expect(rules.event('one', 10, 'agent_settled', 'completed', true)).toBeNull();
  expect(rules.event('one', 11, 'agent_settled', 'aborted')).toBeNull();
  expect(rules.event('one', 12, 'agent_settled', 'future')).toBeNull();
  rules.snapshot('old', 0, '1.5');
  expect(rules.event('old', 1, 'agent_settled')).toBe('finished');
  rules.snapshot('one', 20, '1.6');
  expect(rules.event('one', 19, 'prompt_start')).toBeNull();
 });
 it('drops after three attempts, bounds timeout and retries without a queue', async () => {
  const attempts: number[] = [], sleeps: number[] = [];
  const ports = { send: async (_line: string, timeout: number) => { attempts.push(timeout); throw Error(); }, sleep: async (ms: number) => { sleeps.push(ms); } };
  expect(await deliverNotice('line', ports)).toBe(false);
  expect(attempts).toEqual([2000, 2000, 2000]);
  expect(sleeps).toEqual([250, 500]);
  let count = 0;
  expect(await deliverNotice('line', { send: async () => { count++; }, sleep: ports.sleep })).toBe(true);
  expect(count).toBe(1);
 });
});
