import { describe, it, expect } from 'vitest';
import { decodeRegistryEntry, checkCompatibility } from '../src/index.ts';
import { noticeBridge, noticeSnapshot, noticeEvent } from '../src/notice-bridge.ts';
const bridge = { protocolVersion: '1.6', bridgeInstanceId: 'one', sessionId: 'session', port: 1234, token: '𐀀'.repeat(32), pid: 12, cwd: '/home/demo', startedAt: 1800000000000 };
describe('standalone notifier projection', () => {
 it('agrees with the registry schema on boundary fixtures, including Unicode token code points', () => {
  for (const row of [bridge, { ...bridge, extra: true }, { ...bridge, protocolVersion: '01.05' }, { ...bridge, pid: Number.MAX_SAFE_INTEGER + 1 }, ...['port', 'pid', 'startedAt', 'cwd', 'token', 'bridgeInstanceId', 'sessionId', 'protocolVersion'].flatMap(field => [null, false, [], '', 0, 1.5, '1', Infinity].map(value => ({ ...bridge, [field]: value }))), { ...bridge, token: '𐀀'.repeat(16) }, { ...bridge, port: 65536 }, { ...bridge, protocolVersion: '2.0' }]) {
   const decoded = decodeRegistryEntry(row);
   expect(noticeBridge(row) !== null, JSON.stringify(row)).toBe(decoded.ok && checkCompatibility(row.protocolVersion as string).ok);
  }
 });
 it('silently baselines state and refuses another instance or malformed event projections', () => {
  expect(noticeSnapshot({ ...bridge, lastSeq: 9, idle: true, pendingPrompt: null }, bridge)).toBe(9);
  expect(noticeSnapshot({ ...bridge, bridgeInstanceId: 'other', lastSeq: 9, idle: true, pendingPrompt: null }, bridge)).toBeNull();
  expect(noticeSnapshot({ ...bridge, lastSeq: 9.1, idle: true, pendingPrompt: null }, bridge)).toBeNull();
  expect(noticeEvent({ seq: 10, type: 'agent_settled', aborted: 'false', pendingMessages: false })).toBeNull();
  expect(noticeEvent({ seq: 10, type: 'agent_settled', aborted: false, pendingMessages: false, outcome: 'future' })).toEqual({ seq: 10, type: 'agent_settled', aborted: false, outcome: 'future' });
 });
});
