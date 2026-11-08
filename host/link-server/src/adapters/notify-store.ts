import { createHash, randomUUID } from 'node:crypto';
import { lstat, readdir, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isTailnetAddress, validNotifySecret } from '../../../../packages/protocol/src/session-notice.ts';
import { privateNotifyMode, type NotifyRegistration, type NotifyRegistrationStore } from '../core/notify-registration.ts';
import { privateDirectory, readRegular, writePrivate } from './file-store.ts';
export function createNotifyStore(root: string): NotifyRegistrationStore & { all(): Promise<NotifyRegistration[]> } {
 const name = (address: string) => createHash('sha256').update(address).digest('hex') + '.json';
 async function check() {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.uid !== process.getuid?.() || !privateNotifyMode(info.mode, true)))) throw Error('Unsafe notification directory.');
 }
 async function get(address: string): Promise<NotifyRegistration | null> {
  if (!isTailnetAddress(address)) throw Error('Invalid notification address.');
  try {
   await check();
   const path = join(root, name(address)), info = await lstat(path);
   if (process.platform !== 'win32' && (info.uid !== process.getuid?.() || !privateNotifyMode(info.mode, false))) throw Error('Unsafe notification record.');
   const row = JSON.parse((await readRegular(path, 1024)).toString('utf8'));
   if (row.address !== address || !validNotifySecret(row.secret) || !Number.isInteger(row.port) || row.port < 1 || row.port > 65535 || typeof row.hostKeyId !== 'string' || row.hostKeyId.length > 256) throw Error('Invalid notification record.');
   return row;
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
 }
 return {
  get,
  async put(row) {
   // Ancestor must already exist and must not redirect storage outside the user's app root.
   const { realpath } = await import('node:fs/promises');
   const parent = resolve(root, '..');
   if (resolve(await realpath(parent)) !== parent) throw Error('Unsafe notification parent.');
   await privateDirectory(root); await check();
   if ((await readdir(root)).filter(n => /^[a-f0-9]{64}\.json$/.test(n)).length >= 64 && !await get(row.address)) throw Error('Notification registration limit.');
   const temporary = join(root, `.${randomUUID()}.pending`);
   await writePrivate(temporary, JSON.stringify(row));
   await rename(temporary, join(root, name(row.address)));
  },
  async remove(address) { await check().catch(e => { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }); try { await unlink(join(root, name(address))); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } },
  async all() {
   try {
    await check(); const names = await readdir(root);
    if (names.length > 256) throw Error('Notification registration limit.');
    const rows: NotifyRegistration[] = [];
    for (const file of names.filter(n => /^[a-f0-9]{64}\.json$/.test(n)).slice(0, 64)) {
     try {
      const value = JSON.parse((await readRegular(join(root, file), 1024)).toString('utf8'));
      if (typeof value.address !== 'string' || name(value.address) !== file) continue;
      const row = await get(value.address); if (row) rows.push(row);
     } catch { /* Invalid records never authorize a destination. */ }
    }
    return rows;
   } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  },
 };
}
