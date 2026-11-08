import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import vector from './fixtures/session-notice-v1.json' with { type: 'json' };
import { canonicalNotice, signNotice, verifyNotice, NoticeReplay, isTailnetAddress } from '../src/session-notice.ts';
const secret = '00'.repeat(32);
const notice = { v: 1 as const, hostKeyId: 'SHA256:host', bridgeInstanceId: 'bridge-1', project: 'demo', kind: 'finished' as const, seq: 7, sentAt: 1800000000000, nonce: '0123456789abcdef0123456789abcdef' };
describe('session notice v1', () => {
 it('uses fixed canonical bytes and an interoperable HMAC vector', async () => {
  expect(canonicalNotice(notice)).toBe('[1,"SHA256:host","bridge-1","demo","finished",7,1800000000000,"0123456789abcdef0123456789abcdef"]');
  const line = await signNotice(notice, secret);
  expect(JSON.parse(line).mac).toBe(vector.mac);
  expect(createHmac('sha256', Buffer.from(secret, 'hex')).update(vector.canonical).digest('hex')).toBe(vector.mac);
  expect(await verifyNotice(line, secret)).toEqual(notice);
 });
 it('rejects tampering, unknown fields, malformed secrets, path disclosure and oversized lines', async () => {
  const line = await signNotice(notice, secret);
  expect(await verifyNotice(line.replace('demo', 'other'), secret)).toBeNull();
  expect(await verifyNotice(JSON.stringify({ ...JSON.parse(line), token: 'private' }), secret)).toBeNull();
  expect(await verifyNotice(line, 'ff')).toBeNull();
  await expect(signNotice({ ...notice, project: '/private/demo' }, secret)).rejects.toThrow();
  expect(await verifyNotice('x'.repeat(4097), secret)).toBeNull();
 });
 it('bounds replay state, accepts independent instances and rejects stale/future/duplicate notices', () => {
  const replay = new NoticeReplay(2);
  expect(replay.accept(notice, notice.sentAt)).toBe(true);
  expect(replay.accept(notice, notice.sentAt)).toBe(false);
  expect(replay.accept({ ...notice, seq: 8 }, notice.sentAt + 120001)).toBe(false);
  expect(replay.accept({ ...notice, seq: 8 }, notice.sentAt - 120001)).toBe(false);
  expect(replay.accept({ ...notice, bridgeInstanceId: 'new' }, notice.sentAt)).toBe(true);
  expect(replay.accept({ ...notice, bridgeInstanceId: 'third' }, notice.sentAt)).toBe(false);
 });
 it('retains replay cursors through the latest accepted timestamp even when clocks move backwards', () => {
  const replay = new NoticeReplay();
  expect(replay.accept(notice, notice.sentAt)).toBe(true);
  expect(replay.accept({ ...notice, seq: 8, sentAt: notice.sentAt - 100000 }, notice.sentAt)).toBe(true);
  expect(replay.accept(notice, notice.sentAt + 30000)).toBe(false);
 });
 it('admits only literal Tailscale addresses', () => {
  for (const ip of ['100.64.0.0', '100.127.255.255', 'fd7a:115c:a1e0::1']) expect(isTailnetAddress(ip)).toBe(true);
  for (const ip of ['100.63.255.255', '100.128.0.0', '127.0.0.1', '0.0.0.0', 'fd7a:115c:a1e1::1', 'fd7a:115c:a1e0:xyz::1', 'example.com', '100.64.1.1.evil', '::ffff:100.64.1.1']) expect(isTailnetAddress(ip)).toBe(false);
 });
});
