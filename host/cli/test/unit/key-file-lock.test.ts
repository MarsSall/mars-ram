import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lockKeyFile, lockOwnerAlive, type LockOwner } from '../../src/adapters/authorized-key-file.ts';

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
 const directory = mkdtempSync(join(import.meta.dirname, '.key-lock-')); directories.push(directory);
 const path = join(directory, 'authorized_keys');
 return { path, lock: path + '.lock', recovery: path + '.lock.recovery' };
}
const dead = { id: 'D', pid: 2147483647, startTime: null, createdAt: 0 };
function publish(path: string, owner: LockOwner = dead) { mkdirSync(path); writeFileSync(path + '/owner.json', JSON.stringify(owner)); }
function owner(path: string) { return JSON.parse(readFileSync(path + '/owner.json', 'utf8')); }
const busy = 'authorized_keys is busy; try again';

describe('authorized_keys recovery serialization', () => {
 it.each(['release', 'recover-L', 'recover-R'])('retires %s atomically before cleanup, including a crash after rename', kind => {
  const f = fixture();
  if (kind !== 'release') publish(f.lock);
  const published = kind === 'recover-R' ? f.recovery : f.lock;
  let retired = false;
  const options = { lockTimeoutMs: 0, lockRename: (source: string, target: string) => {
   renameSync(source, target);
   if (source === published) {
    retired = true;
    expect(existsSync(published)).toBe(false);
    expect(owner(target).id).toBeTruthy();
    throw Error('crash after retirement');
   }
  } };
  if (kind === 'release') {
   const release = lockKeyFile(f.path, options);
   expect(release).toThrow('crash after retirement');
  } else expect(() => lockKeyFile(f.path, options)).toThrow('crash after retirement');
  expect(retired).toBe(true);
  expect(existsSync(published)).toBe(false);
 });
 it.each(['lock', 'recovery'])('refuses an ownerless %s with exact repair advice', kind => {
  const f = fixture(); const path = kind === 'lock' ? f.lock : f.recovery;
  mkdirSync(path);
  expect(() => lockKeyFile(f.path, { lockTimeoutMs: 0 })).toThrow(`delete ${path} and try again`);
  expect(existsSync(path)).toBe(true);
 });
 it('uses shell-free Windows process start times at acquisition and liveness checks', () => {
  const f = fixture(); const calls: unknown[] = [];
  const identity = { platform: 'win32' as const, run: (command: string, args: string[], options: unknown) => {
   calls.push([command, args, options]); return '123456789';
  } };
  const release = lockKeyFile(f.path, { identity });
  const held = owner(f.lock);
  expect(held.startTime).toBe('123456789');
  expect(lockOwnerAlive(held, identity)).toBe(true);
  expect(lockOwnerAlive({ ...held, startTime: 'old-process' }, identity)).toBe(false);
  expect(calls).toHaveLength(3);
  for (const call of calls) expect(call).toEqual(['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${process.pid}).StartTime.ToUniversalTime().Ticks`], expect.objectContaining({ shell: false, windowsHide: true })]);
  release();
 });
 it('recovers a reused PID when readable start times differ', () => {
  const f = fixture(); publish(f.lock, { ...dead, pid: process.pid, startTime: 'previous-process' });
  const release = lockKeyFile(f.path, { lockTimeoutMs: 0, identity: { platform: 'win32', run: () => 'new-process' } });
  expect(owner(f.lock).id).not.toBe('D');
  release();
 });
 it('keeps a lock if reading its current process identity fails', () => {
  const f = fixture(); publish(f.lock, { ...dead, pid: process.pid, startTime: 'known-at-acquisition' });
  expect(() => lockKeyFile(f.path, { lockTimeoutMs: 0, identity: { platform: 'win32', run: () => { throw Error('denied'); } } })).toThrow(`delete ${f.lock}`);
  expect(owner(f.lock).startTime).toBe('known-at-acquisition');
 });
 it('never steals an unverifiable live PID and explains who, when and how to repair', () => {
  const f = fixture(); publish(f.lock, { ...dead, pid: process.pid, createdAt: 123 });
  expect(() => lockKeyFile(f.path, { lockTimeoutMs: 0 })).toThrow(new RegExp(`pid ${process.pid}.*123.*identity could not be verified`));
  expect(() => lockKeyFile(f.path, { lockTimeoutMs: 0 })).toThrow(`delete ${f.lock}`);
  expect(owner(f.lock).createdAt).toBe(123);
 });
 it('keeps A published when delayed recoverer B resumes after both observed dead D; C cannot enter', () => {
  const f = fixture(); publish(f.lock);
  let releaseA: (() => void) | undefined;
  let aId = '';
  try {
   expect(() => lockKeyFile(f.path, { lockTimeoutMs: 0, beforeRecovery: () => {
    // B is paused with D in hand. A independently sees D, recovers, and holds L.
    releaseA = lockKeyFile(f.path, { lockTimeoutMs: 0 });
    aId = owner(f.lock).id;
   }, lockRename: (source, target) => {
    // In the rejected implementation this is the vulnerable rename-then-check gap.
    renameSync(source, target);
    if (source === f.lock) {
     let releaseC: (() => void) | undefined;
     try { expect(() => { releaseC = lockKeyFile(f.path, { lockTimeoutMs: 0 }); }).toThrow(busy); }
     finally { releaseC?.(); }
     expect(existsSync(f.recovery)).toBe(true);
    }
   } })).toThrow(busy);
   expect(owner(f.lock).id).toBe(aId);
   expect(() => lockKeyFile(f.path, { lockTimeoutMs: 0 })).toThrow(busy);
  } finally { releaseA?.(); }
  expect(existsSync(f.lock)).toBe(false);
 });
 it('removes a dead L only while holding atomically published R', () => {
  const f = fixture(); publish(f.lock);
  let recovered = false;
  const release = lockKeyFile(f.path, { lockTimeoutMs: 0, lockRename: (source, target) => {
   renameSync(source, target);
   if (target === f.recovery) {
    recovered = true;
    expect(owner(f.lock).id).toBe('D');
    expect(owner(f.recovery).pid).toBe(process.pid);
   }
  } });
  expect(recovered).toBe(true);
  expect(owner(f.lock).id).not.toBe('D');
  expect(existsSync(f.recovery)).toBe(false);
  release();
 });
 it('acquires when the holder retires L between the existence check and the owner read', () => {
  const f = fixture();
  publish(f.lock, { id: 'H', pid: process.pid, startTime: null, createdAt: Date.now() });
  let retired = false;
  const release = lockKeyFile(f.path, { lockTimeoutMs: 1000, afterLockExists: directory => {
   if (!retired && directory === f.lock) { retired = true; renameSync(f.lock, f.lock + '.gone.trash'); }
  } });
  expect(retired).toBe(true);
  expect(existsSync(f.lock)).toBe(true);
  release();
  expect(existsSync(f.lock)).toBe(false);
 });
 it('never expires a live L regardless of age', () => {
  const f = fixture(); publish(f.lock, { ...dead, id: 'live', pid: process.pid });
  expect(() => lockKeyFile(f.path, { lockTimeoutMs: 0 })).toThrow(busy);
  expect(owner(f.lock).id).toBe('live');
  expect(existsSync(f.recovery)).toBe(false);
 });
 it('does not steal a stale R and gives an exact manual repair, leaving L untouched', () => {
  const f = fixture(); publish(f.lock); publish(f.recovery, { ...dead, id: 'stale-recoverer' });
  expect(() => lockKeyFile(f.path, { lockTimeoutMs: 0 })).toThrow(`A previous key change was interrupted; delete ${f.recovery} and try again`);
  expect(owner(f.lock).id).toBe('D');
  expect(owner(f.recovery).id).toBe('stale-recoverer');
 });
 it('respects a live R without removing L', () => {
  const f = fixture(); publish(f.lock); publish(f.recovery, { ...dead, id: 'recoverer', pid: process.pid });
  expect(() => lockKeyFile(f.path, { lockTimeoutMs: 0 })).toThrow(busy);
  expect(owner(f.lock).id).toBe('D');
  expect(owner(f.recovery).id).toBe('recoverer');
 });
 it.each(['same-owner-now-live', 'different-dead-owner'])('rechecks identity AND liveness under R: %s', kind => {
  const f = fixture(); publish(f.lock);
  expect(() => lockKeyFile(f.path, { lockTimeoutMs: 0, beforeRecovery: () => {
   writeFileSync(f.lock + '/owner.json', JSON.stringify(kind === 'same-owner-now-live'
    ? { ...dead, pid: process.pid } : { ...dead, id: 'another-dead-owner' }));
  } })).toThrow(busy);
  expect(owner(f.lock).id).toBe(kind === 'same-owner-now-live' ? 'D' : 'another-dead-owner');
  expect(existsSync(f.recovery)).toBe(false);
 });
 it('reports a stale R even if the previous recovery already removed L', () => {
  const f = fixture(); publish(f.recovery);
  expect(() => lockKeyFile(f.path, { lockTimeoutMs: 0 })).toThrow(`delete ${f.recovery} and try again`);
  expect(existsSync(f.lock)).toBe(false);
 });
 it('never releases a replacement L or R', () => {
  const f = fixture(); publish(f.lock);
  const release = lockKeyFile(f.path, { lockTimeoutMs: 0, lockRename: (source, target) => {
   renameSync(source, target);
   if (target === f.recovery) writeFileSync(f.recovery + '/owner.json', JSON.stringify({ ...dead, id: 'other-R', pid: process.pid }));
  } });
  writeFileSync(f.lock + '/owner.json', JSON.stringify({ ...dead, id: 'other-L', pid: process.pid }));
  release();
  expect(owner(f.lock).id).toBe('other-L');
  expect(owner(f.recovery).id).toBe('other-R');
 });
});
