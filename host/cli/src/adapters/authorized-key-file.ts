// Shared locked rewrite for pairing and rotation, with external-edit snapshot checks.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, chownSync, closeSync, copyFileSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, type Stats } from 'node:fs';
import type { KeyTarget } from './authorized-keys.ts';

export type KeyRunner = (command: string, args: string[], options: { shell: false; windowsHide: true; stdio: 'ignore' }) => unknown;
export const keyRunner: KeyRunner = (command, args, options) => execFileSync(command, args, options);
export type RewriteOptions = {
 platform?: NodeJS.Platform;
 identity?: ProcessIdentity;
 rename?: (source: string, target: string) => void;
 run?: KeyRunner;
 /** Test seam: runs after staging, immediately before the final snapshot comparison. */
 beforeCommit?: () => void;
 /** Lock test seams; production waits up to five seconds. */
 lockTimeoutMs?: number;
 lockRename?: (source: string, target: string) => void;
 /** Test seam: runs after a published lock directory was seen, before its owner is read. */
 afterLockExists?: (directory: string) => void;
 /** Test seam: a dead main-lock owner was observed, before recovery starts. */
 beforeRecovery?: () => void;
};

export function restrictToSystemAndAdministrators(path: string, run: KeyRunner = keyRunner): void {
 run('icacls', [path, '/inheritance:r', '/grant', '*S-1-5-18:F', '/grant', '*S-1-5-32-544:F'], { shell: false, stdio: 'ignore', windowsHide: true });
}

export function copyKeyAcl(source: string, temporary: string, admin: boolean, run: KeyRunner = keyRunner): void {
 const decode = (value: string) => `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(value).toString('base64')}'))`;
 const administratorRules = admin ? "; $a.SetAccessRuleProtection($true,$false); foreach ($r in @($a.Access)) { $a.RemoveAccessRuleSpecific($r) }; foreach ($sid in @('S-1-5-18','S-1-5-32-544')) { $id=[System.Security.Principal.SecurityIdentifier]::new($sid); $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($id,'FullControl','Allow'); $a.AddAccessRule($rule) }" : '';
 const script = `$ErrorActionPreference='Stop'; $s=${decode(source)}; $t=${decode(temporary)}; $a=Get-Acl -LiteralPath $s; $a.SetOwner($a.GetOwner([System.Security.Principal.SecurityIdentifier]))${administratorRules}; Set-Acl -LiteralPath $t -AclObject $a`;
 run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { shell: false, windowsHide: true, stdio: 'ignore' });
 if (admin) restrictToSystemAndAdministrators(temporary, run);
}

type Snapshot = { stat: Stats | undefined; bytes: Buffer; hash: string };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function metadataEqual(a: Stats | undefined, b: Stats | undefined): boolean {
 if (!a || !b) return a === b;
 return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs
  && a.ctimeMs === b.ctimeMs && a.mode === b.mode && a.uid === b.uid && a.gid === b.gid;
}
function safeStat(path: string): Stats | undefined {
 try {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('Key target must be a regular, unlinked file.');
  return stat;
 } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
function snapshot(path: string): Snapshot | undefined {
 const stat = safeStat(path);
 let bytes: Buffer;
 try { bytes = stat ? readFileSync(path) : Buffer.alloc(0); }
 catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
 if (!metadataEqual(stat, safeStat(path))) return undefined;
 return { stat, bytes, hash: hash(bytes) };
}

export type LockOwner = { id: string; pid: number; startTime: string | null; createdAt: number };
export type ProcessIdentity = {
 platform?: NodeJS.Platform;
 run?: (command: string, args: string[], options: { encoding: 'utf8'; shell: false; windowsHide: true; timeout: number }) => string;
};
function startTime(pid: number, identity: ProcessIdentity = {}): string | null {
 try {
  const platform = identity.platform ?? process.platform;
  if (platform === 'linux') return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1)!.split(' ')[19] || null;
  const run: NonNullable<ProcessIdentity['run']> = identity.run ?? ((command, args, options) => execFileSync(command, args, options));
  const options = { encoding: 'utf8' as const, shell: false as const, windowsHide: true as const, timeout: 10000 };
  if (platform === 'darwin') return run('ps', ['-o', 'lstart=', '-p', String(pid)], options).trim() || null;
  if (platform === 'win32') return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().Ticks`], options).trim() || null;
  return null;
 } catch { return null; }
}
function ownerAt(directory: string): LockOwner | undefined {
 try { return JSON.parse(readFileSync(`${directory}/owner.json`, 'utf8')) as LockOwner; } catch { return undefined; }
}
export function lockOwnerState(owner: LockOwner, identity: ProcessIdentity = {}): 'alive' | 'dead' | 'unverified' {
 if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return 'unverified';
 try { process.kill(owner.pid, 0); }
 catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return 'dead'; }
 const current = startTime(owner.pid, identity);
 if (!current || !owner.startTime) return 'unverified';
 return current === owner.startTime ? 'alive' : 'dead';
}
export function lockOwnerAlive(owner: LockOwner, identity: ProcessIdentity = {}): boolean {
 return lockOwnerState(owner, identity) !== 'dead';
}
export const unverifiedKeyLock = (path: string, owner: LockOwner): string =>
 `authorized_keys is busy; try again; pid ${owner.pid}, since createdAt ${owner.createdAt}; identity could not be verified; if that process is not a Mars-RAM key change, delete ${path} and try again`;
export const interruptedKeyChange = (path: string): string => `A previous key change was interrupted; delete ${path} and try again`;
const occupied = (error: unknown): boolean => ['EEXIST', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '');
const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
function retire(directory: string, rename: (source: string, target: string) => void): void {
 // Never delete metadata at a published path: a crash leaves either a full lock or trash.
 const trash = `${directory}.${randomUUID()}.trash`;
 rename(directory, trash);
 rmSync(trash, { recursive: true, force: true });
}
function releaseOwned(directory: string, id: string, rename: (source: string, target: string) => void): void {
 // Owners never remove a replacement lock. Recoverers cannot remove a live owner.
 if (ownerAt(directory)?.id === id) retire(directory, rename);
}
function exists(directory: string): boolean {
 try { lstatSync(directory); return true; }
 catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
function publishedOwner(directory: string, afterExists?: (directory: string) => void): LockOwner | undefined {
 if (!exists(directory)) return undefined;
 afterExists?.(directory);
 const owner = ownerAt(directory);
 // The holder may retire the lock between the two reads: that is a release, so retry.
 if (!owner && !exists(directory)) return undefined;
 if (!owner || typeof owner.id !== 'string' || !Number.isSafeInteger(owner.pid) || typeof owner.createdAt !== 'number'
  || !(owner.startTime === null || typeof owner.startTime === 'string')) throw Error(interruptedKeyChange(directory));
 return owner;
}

export function lockKeyFile(path: string, options: RewriteOptions = {}): () => void {
 const lock = `${path}.lock`, recovery = `${lock}.recovery`, temporary = `${lock}.${randomUUID()}.tmp`;
 const owner: LockOwner = { id: randomUUID(), pid: process.pid, startTime: startTime(process.pid, options.identity), createdAt: Date.now() };
 const rename = options.lockRename ?? renameSync, deadline = Date.now() + (options.lockTimeoutMs ?? 5000);
 const checkRecovery = () => {
  const holder = publishedOwner(recovery, options.afterLockExists);
  if (holder) {
   const state = lockOwnerState(holder, options.identity);
   if (state === 'dead') throw Error(interruptedKeyChange(recovery));
   if (state === 'unverified') throw Error(unverifiedKeyLock(recovery, holder));
  }
 };
 const recover = (expected: string): void => {
  const staging = `${recovery}.${randomUUID()}.tmp`;
  const recoveryOwner = { ...owner, id: randomUUID() };
  const recoveryDeadline = Math.min(deadline, Date.now() + 2000);
  mkdirSync(staging, { mode: 0o700 });
  let held = false;
  try {
   writeFileSync(`${staging}/owner.json`, JSON.stringify(recoveryOwner), { mode: 0o600, flag: 'wx' });
   for (;;) {
    checkRecovery();
    try { rename(staging, recovery); held = true; break; }
    catch (error) { if (!occupied(error)) throw error; }
    // R is never stolen, even after a crash. A second fault requires manual repair.
    checkRecovery();
    if (Date.now() >= recoveryDeadline) throw Error('authorized_keys is busy; try again');
    pause();
   }
   // Only the serialized, fresh observation authorizes removing a foreign L.
   const current = publishedOwner(lock, options.afterLockExists);
   if (current?.id === expected && !lockOwnerAlive(current, options.identity)) retire(lock, rename);
  } finally {
   if (held) releaseOwned(recovery, recoveryOwner.id, rename);
   rmSync(staging, { recursive: true, force: true });
  }
 };
 mkdirSync(temporary, { mode: 0o700 });
 try {
  writeFileSync(`${temporary}/owner.json`, JSON.stringify(owner), { mode: 0o600, flag: 'wx' });
  for (;;) {
   checkRecovery();
   // POSIX may replace an empty directory; diagnose it before attempting publication.
   const holder = publishedOwner(lock, options.afterLockExists);
   if (holder && lockOwnerState(holder, options.identity) === 'unverified') throw Error(unverifiedKeyLock(lock, holder));
   try { rename(temporary, lock); break; }
   catch (error) { if (!occupied(error)) throw error; }
   if (holder && !lockOwnerAlive(holder, options.identity)) {
    options.beforeRecovery?.();
    recover(holder.id);
    // Reattempt publication even with a zero test timeout after successful recovery.
    try { rename(temporary, lock); break; }
    catch (error) { if (!occupied(error)) throw error; }
   }
   if (Date.now() >= deadline) throw Error('authorized_keys is busy; try again');
   pause();
  }
 } finally { rmSync(temporary, { recursive: true, force: true }); }
 return () => releaseOwned(lock, owner.id, rename);
}

/** Cooperating writers hold the lock throughout read, validation and commit. */
export function rewriteKeyFile<T>(target: KeyTarget, backupSuffix: string, allowCreate: boolean,
 transform: (bytes: Buffer) => { bytes?: Buffer; result: T }, options: RewriteOptions = {}): T {
 const platform = options.platform ?? process.platform;
 const release = lockKeyFile(target.path, options);
 try {
 for (let attempt = 0; attempt < 5; attempt++) {
  const original = snapshot(target.path);
  if (!original) continue;
  if (!original.stat && !allowCreate) throw Error('Key target does not exist.');
  const update = transform(original.bytes);
  if (!update.bytes) return update.result;
  const temporary = `${target.path}.${process.pid}.${randomUUID()}.tmp`;
  let created = false;
  try {
   if (original.stat) {
    const backup = `${target.path}${backupSuffix}`;
    safeStat(backup); // Refuse a planted symlink or hard-linked backup.
    copyFileSync(target.path, backup);
    if (platform !== 'win32') chmodSync(backup, 0o600);
    else copyKeyAcl(target.path, backup, target.kind === 'windows-administrators', options.run);
   }
   const fd = openSync(temporary, 'wx', 0o600); created = true;
   try {
    writeFileSync(fd, update.bytes);
    fsyncSync(fd);
    if (platform !== 'win32' && original.stat) {
     const staging = fstatSync(fd);
     if (staging.uid !== original.stat.uid || staging.gid !== original.stat.gid) chownSync(temporary, original.stat.uid, original.stat.gid);
     chmodSync(temporary, original.stat.mode & 0o7777);
    }
   } finally { closeSync(fd); }
   if (platform === 'win32') {
    if (original.stat) copyKeyAcl(target.path, temporary, target.kind === 'windows-administrators', options.run);
    else if (target.kind === 'windows-administrators') restrictToSystemAndAdministrators(temporary, options.run);
   } else if (!original.stat && target.kind === 'windows-administrators') {
    // Keep cross-platform callers fail-closed rather than silently skipping the required ACL.
    restrictToSystemAndAdministrators(temporary, options.run);
   }
   options.beforeCommit?.();
   const current = snapshot(target.path);
   if (!current || !metadataEqual(original.stat, current.stat) || original.hash !== current.hash) continue;
   (options.rename ?? renameSync)(temporary, target.path);
   return update.result;
  } finally { if (created) rmSync(temporary, { force: true }); }
 }
 throw Error('authorized_keys changed while updating; try again');
 } finally { release(); }
}
