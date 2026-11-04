import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { runProcess } from '../../src/adapters/herdr-switcher.ts';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
it('returns successful output and clears the deadline without killing the child', async () => {
 vi.useFakeTimers();
 const kill = vi.fn(() => true);
 vi.mocked(execFile).mockImplementation(((_file: unknown, _args: unknown, _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
  setTimeout(() => callback(null, 'output'), 10);
  return { kill };
 }) as unknown as typeof execFile);
 const pending = runProcess('herdr', [], { shell: false, encoding: 'utf8', timeout: 100, maxBuffer: 1048576 });
 await vi.advanceTimersByTimeAsync(10);
 expect(await pending).toBe('output');
 await vi.advanceTimersByTimeAsync(500);
 expect(kill).not.toHaveBeenCalled();
 expect(vi.getTimerCount()).toBe(0);
});
it('rejects on its own timer even when killing never produces an exit callback', async () => {
 vi.useFakeTimers();
 const kill = vi.fn(() => true);
 vi.mocked(execFile).mockReturnValue({ kill } as unknown as ReturnType<typeof execFile>);
 const pending = runProcess('herdr', ['workspace', 'list'], { shell: false, encoding: 'utf8', timeout: 100, maxBuffer: 1048576 });
 const rejected = expect(pending).rejects.toMatchObject({ code: 'ETIMEDOUT' });
 await vi.advanceTimersByTimeAsync(100);
 expect(kill).toHaveBeenCalledWith('SIGTERM');
 await vi.advanceTimersByTimeAsync(250);
 expect(kill).toHaveBeenCalledWith('SIGKILL');
 await rejected;
 expect(vi.getTimerCount()).toBe(0);
});
