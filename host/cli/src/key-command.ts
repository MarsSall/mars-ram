import { homedir } from 'node:os';
import { keyTarget, readWindowsPrivileges } from './adapters/authorized-keys.ts';
import { changeKey, type KeyChange } from './adapters/key-change.ts';

/** stdout is machine-readable only. Errors never include key material or file contents. */
export function keyCommand(change: KeyChange): number {
 try {
  const privileges = process.platform === 'win32' ? readWindowsPrivileges() : { administrator: false, elevated: false };
  const target = keyTarget(process.platform, { home: homedir(), programData: process.env.ProgramData, administrator: privileges.administrator });
  console.log(JSON.stringify(changeKey(target, change, { elevated: privileges.elevated })));
  return 0;
 } catch (error) {
  // OS errors may include paths but no authorized_keys contents. Never echo argv.
  console.error(`Key change failed: ${(error as Error).message}`);
  return 1;
 }
}
