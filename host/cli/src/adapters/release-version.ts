// Release metadata is separate from the bridge source hash in install.json.
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { join, resolve } from 'node:path';
export const releaseRoot = resolve(import.meta.dirname, '../..');
export function readRelease(root = releaseRoot): string {
 let fd: number | undefined;
 try {
  fd = openSync(join(root, 'VERSION'), constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.size > 64) return 'dev';
  const bytes = Buffer.alloc(65);
  const count = readSync(fd, bytes, 0, bytes.length, 0);
  const value = bytes.toString('utf8', 0, count).trim();
  return count <= 64 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) ? value : 'dev';
 } catch { return 'dev'; } finally { if (fd !== undefined) closeSync(fd); }
}
