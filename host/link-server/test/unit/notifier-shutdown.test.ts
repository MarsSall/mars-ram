import { it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({ resolve: (_files: string[]) => {}, rows: [] as string[] }));
vi.mock('node:fs/promises', () => ({
 readdir: () => new Promise<string[]>(resolve => { state.resolve = resolve; }),
 lstat: async () => ({ uid: process.getuid?.(), mode: 0o600 }),
}));
vi.mock('../../src/adapters/notify-store.ts', () => ({ createNotifyStore: () => ({ all: async () => [{ address: '100.64.1.2', port: 1234, secret: 'ab'.repeat(32), hostKeyId: 'host' }] }) }));
vi.mock('../../src/adapters/file-store.ts', () => ({ readRegular: async () => Buffer.from(JSON.stringify({ protocolVersion: '1.6', bridgeInstanceId: 'bridge', sessionId: 'session', port: 1234, token: 'a'.repeat(32), pid: process.pid, cwd: '/demo', startedAt: 1 })) }));
import { startNotifier } from '../../src/adapters/notifier.ts';
it('cannot publish watches after shutdown while discovery is in flight', async () => {
 const fetch = vi.fn().mockRejectedValue(Error('offline'));
 vi.stubGlobal('fetch', fetch);
 const notifier = startNotifier('/fake');
 try {
  await notifier.close();
  state.resolve(['one.json']);
  // Drain the bounded chain of discovery promises, without real sleeps or sockets.
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
 } finally { await notifier.close(); vi.unstubAllGlobals(); }
});
