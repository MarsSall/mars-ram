import { it, expect, vi } from 'vitest';
vi.mock('../../../link-server/src/adapters/notify-store.ts', () => { throw Error('private module path'); });
import { notifyCommand } from '../../src/notify-command.ts';
it('returns bounded JSON rather than an import stack if the host installation is incomplete', async () => {
 const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
 try {
  await expect(notifyCommand(['status', '--json'])).resolves.toBe(1);
  expect(output.mock.calls).toEqual([['{"v":1,"ok":false,"code":"NOTIFY_FAILED"}\n']]);
 } finally { output.mockRestore(); }
});
