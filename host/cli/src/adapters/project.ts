import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { EntryKind, ProjectFiles } from '../core/project.ts';

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
async function readRegular(path: string, max: number): Promise<{ bytes: Uint8Array; size: number; mtime: number; id: string }> {
 // The policy passes realpaths; O_NOFOLLOW plus fstat on the handle refuse a swap to a link or a device.
 const handle = await open(path, constants.O_RDONLY | NOFOLLOW);
 try {
  const info = await handle.stat();
  if (!info.isFile()) throw Object.assign(Error('Not a regular file.'), { code: 'EISDIR' });
  const buffer = Buffer.alloc(Math.min(max, info.size)); let size = 0;
  while (size < buffer.length) { const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size); if (!bytesRead) break; size += bytesRead; }
  return { bytes: buffer.subarray(0, size), size: info.size, mtime: info.mtimeMs, id: `${info.dev}:${info.ino}` };
 } finally { await handle.close(); }
}
/** The link server's private staging directory (host/link-server/src/main.ts), created by its `ensure`. */
export const linkStaging = () => join(homedir(), '.mars-ram', 'links', '.staging');
export function createProjectFiles(staging = linkStaging()): ProjectFiles {
 return {
  realpath: path => realpath(path),
  async lstat(path) {
   const info = await lstat(path);
   const kind: EntryKind = info.isSymbolicLink() ? 'link' : info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other';
   return { kind, size: info.size, mtime: info.mtimeMs, id: `${info.dev}:${info.ino}` };
  },
  list: dir => readdir(dir),
  read: readRegular,
  async writeStaged(name, bytes) {
   // The link server owns this private dir; a link (or a linked parent) could redirect the copy.
   const info = await lstat(staging);
   const fold = (p: string) => process.platform === 'win32' ? p.toLowerCase() : p;
   if (!info.isDirectory() || info.isSymbolicLink() || fold(await realpath(staging)) !== fold(resolve(staging))) throw Error('Unsafe staging directory.');
   const target = await open(join(staging, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600);
   try { await target.writeFile(bytes); } finally { await target.close(); }
  },
  removeStaged: name => unlink(join(staging, name)),
 };
}
