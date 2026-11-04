import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { APP_ID } from '@workspace/protocol';
import { validHerdrPath } from '../core/herdr.ts';
import type { ProcessRunner } from '../core/herdr-switcher.ts';

export function resolveHerdr(text: string, platform: NodeJS.Platform): string {
 try {
  const value: unknown = JSON.parse(text)?.herdr;
  if (validHerdrPath(value) && value !== 'herdr') return value;
 } catch { /* Missing or invalid install record: use the platform executable on PATH. */ }
 return platform === 'win32' ? 'herdr.exe' : 'herdr';
}
export function recordedHerdr(): string {
 let text = '';
 try { text = readFileSync(join(homedir(), `.${APP_ID}`, 'host.json'), 'utf8'); } catch { /* PATH fallback. */ }
 return resolveHerdr(text, process.platform);
}
export const runProcess: ProcessRunner = (file, args, options) => new Promise((resolve, reject) => {
 const { timeout, ...execOptions } = options;
 const timeoutError = Object.assign(new Error('Child process deadline exceeded.'), { code: 'ETIMEDOUT' });
 let expired = false;
 let grace: ReturnType<typeof setTimeout> | undefined;
 const finish = (error: Error | null, stdout = '') => {
  clearTimeout(deadline);
  if (grace !== undefined) clearTimeout(grace);
  if (expired) reject(timeoutError);
  else if (error) reject(Object.assign(error, { stdout })); // Exit-code callers (git --no-index) still need stdout.
  else resolve(stdout);
 };
 // Own the deadline: execFile's built-in timeout waits for the exit callback.
 const child = execFile(file, [...args], execOptions, (error, stdout) => finish(error, stdout));
 const deadline = setTimeout(() => {
  expired = true;
  grace = setTimeout(() => {
   // Windows also terminates the direct child. Neither platform kills descendants;
   // this is a shell-free exec, not process-tree containment.
   child.kill('SIGKILL');
   finish(timeoutError); // Settle even if no exit/close callback ever arrives.
  }, 250);
  child.kill('SIGTERM');
 }, timeout);
});
