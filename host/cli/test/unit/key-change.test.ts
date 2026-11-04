import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, chmodSync, readdirSync, rmSync, renameSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, afterAll } from 'vitest';
import { rewriteKeyFile } from '../../src/adapters/authorized-key-file.ts';
import { changeKey, validateRotationKey, copyKeyAcl } from '../../src/adapters/key-change.ts';
import { parseArguments } from '../../src/arguments.ts';
import { authorizeKey, keyParts } from '../../src/adapters/authorized-keys.ts';

const homes: string[] = [];
afterAll(() => { for (const home of homes) rmSync(home, { recursive: true, force: true }); });
function key() {
 const jwk = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' });
 const field = (value: Buffer) => { const size = Buffer.alloc(4); size.writeUInt32BE(value.length); return Buffer.concat([size, value]); };
 return `ssh-ed25519 ${Buffer.concat([field(Buffer.from('ssh-ed25519')), field(Buffer.from(jwk.x!, 'base64url'))]).toString('base64')}`;
}
const old = key(), next = key(), other = key();
function fixture(contents: string) {
 const home = mkdtempSync(join(tmpdir(), 'rotation-')); homes.push(home); mkdirSync(join(home, '.ssh'));
 const path = join(home, '.ssh/authorized_keys'); writeFileSync(path, contents, { mode: 0o600 });
 return { path, target: { path, kind: 'user' as const } };
}
const add = { action: 'add' as const, key: next, like: old };
const remove = { action: 'remove' as const, key: old, keep: next };

describe('phone key rotation', () => {
 it('excludes pairing while removal commits and preserves a later successful addition', () => {
  const f = fixture(old + '\n' + next + '\n');
  changeKey(f.target, remove, { beforeCommit: () => {
   expect(authorizeKey(f.target, other, { lockTimeoutMs: 0 })).toEqual({ ok: false, message: 'authorized_keys is busy; try again' });
  } });
  expect(authorizeKey(f.target, other)).toEqual({ ok: true });
  expect(readFileSync(f.path, 'utf8')).toBe(next + '\n' + other + '\n');
 });
 it('finishes a pairing write before a waiting removal, without reviving the removed key', () => {
  const f = fixture(old + '\n' + next + '\n');
  expect(authorizeKey(f.target, other, { beforeCommit: () => {
   expect(() => changeKey(f.target, remove, { lockTimeoutMs: 0 })).toThrow('authorized_keys is busy; try again');
   expect(() => changeKey(f.target, { ...add, key: other }, { lockTimeoutMs: 0 })).toThrow('authorized_keys is busy; try again');
  } })).toEqual({ ok: true });
  expect(changeKey(f.target, remove)).toEqual({ removed: 1 });
  expect(readFileSync(f.path, 'utf8')).toBe(next + '\n' + other + '\n');
 });
 it.each(['dead', 'reused', 'live'])('handles a %s lock owner without age expiry', kind => {
  const f = fixture(old + '\n'); const lock = f.path + '.lock'; mkdirSync(lock);
  const startTime = process.platform === 'linux' ? readFileSync(`/proc/${process.pid}/stat`, 'utf8').split(') ').at(-1)!.split(' ')[19] : null;
  writeFileSync(lock + '/owner.json', JSON.stringify({ id: 'owner', pid: kind === 'dead' ? 2147483647 : process.pid, startTime: kind === 'reused' ? 'different' : startTime, createdAt: 0 }));
  if (kind === 'live' || (kind === 'reused' && process.platform !== 'linux')) expect(() => changeKey(f.target, add, { lockTimeoutMs: 30 })).toThrow('authorized_keys is busy; try again');
  else expect(changeKey(f.target, add)).toEqual({ added: true });
 });
 it('leaves a replaced owner in place during recovery and never releases another owner', () => {
  const f = fixture(old + '\n'); const lock = f.path + '.lock'; mkdirSync(lock);
  const owner = { id: 'dead', pid: 2147483647, startTime: null, createdAt: 0 };
  writeFileSync(lock + '/owner.json', JSON.stringify(owner));
  expect(() => rewriteKeyFile(f.target, '.bak', false, () => { throw Error('must not enter'); }, { lockTimeoutMs: 0, beforeRecovery: () => {
   writeFileSync(lock + '/owner.json', JSON.stringify({ ...owner, id: 'replacement', pid: process.pid }));
  } })).toThrow('authorized_keys is busy; try again');
  expect(JSON.parse(readFileSync(lock + '/owner.json', 'utf8')).id).toBe('replacement');
  rmSync(lock, { recursive: true });
  changeKey(f.target, add, { beforeCommit: () => writeFileSync(lock + '/owner.json', JSON.stringify({ ...owner, id: 'not-mine' })) });
  expect(JSON.parse(readFileSync(lock + '/owner.json', 'utf8')).id).toBe('not-mine');
 });
 it('accepts a real P-256 key and rejects malformed curve/point/trailing wire fields', () => {
  const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });
  const field = (b: Buffer) => { const size = Buffer.alloc(4); size.writeUInt32BE(b.length); return Buffer.concat([size, b]); };
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]);
  const blob = (curve: string, p: Buffer) => Buffer.concat([field(Buffer.from('ecdsa-sha2-nistp256')), field(Buffer.from(curve)), field(p)]);
  const valid = `ecdsa-sha2-nistp256 ${blob('nistp256', point).toString('base64')}`;
  expect(validateRotationKey(valid)).toBe(valid);
  const f = fixture(old + '\n'); expect(changeKey(f.target, { ...add, key: valid })).toEqual({ added: true });
  for (const bytes of [blob('nistp384', point), blob('nistp256', Buffer.alloc(65)), Buffer.concat([blob('nistp256', point), Buffer.from([0])])]) expect(() => validateRotationKey(`ecdsa-sha2-nistp256 ${bytes.toString('base64')}`)).toThrow(/key/i);
 });
 it.skipIf(process.platform === 'win32')('executes the CLI with JSON-only success, exit 1 errors without keys, and exit 2 usage', () => {
  const f = fixture(`restrict,port-forwarding,pty ${old}\n`);
  const home = resolve(f.path, '../..');
  const run = (args: string[]) => spawnSync(process.execPath, [resolve(import.meta.dirname, '../../src/main.ts'), ...args], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  let result = run(['key', 'add', '--key', next, '--like', old]);
  expect(result.status).toBe(0); expect(result.stdout).toBe('{"added":true}\n'); expect(result.stderr).toBe('');
  result = run(['key', 'add', '--key', next, '--like', old]); expect(result.status).toBe(0); expect(result.stdout).toBe('{"added":false}\n');
  result = run(['key', 'remove', '--key', old, '--keep', next]); expect(result.status).toBe(0); expect(result.stdout).toBe('{"removed":1}\n');
  result = run(['key', 'add', '--key', 'restrict ' + next, '--like', old]); expect(result.status).toBe(1); expect(result.stdout).toBe(''); expect(result.stderr).toContain('Invalid public key'); expect(result.stderr).not.toContain(next);
  result = run(['key', 'add']); expect(result.status).toBe(2); expect(result.stdout).toBe(''); expect(result.stderr).toContain('--like');
 });
 it('copies trusted options verbatim, backs up, appends a dated comment, and is idempotent by material', () => {
  const initial = `# trusted\r\nReStRiCt,port-forwarding,pty ${old} phone\r\n`;
  const f = fixture(initial);
  expect(changeKey(f.target, add, { date: new Date('2026-10-26') })).toEqual({ added: true });
  const updated = readFileSync(f.path, 'utf8');
  expect(updated).toBe(initial + `ReStRiCt,port-forwarding,pty ${next} mars-ram:rotated:2026-10-26\r\n`);
  expect(readFileSync(f.path + '.bak-before-key-change', 'utf8')).toBe(initial);
  expect(changeKey(f.target, add)).toEqual({ added: false });
  expect(readFileSync(f.path, 'utf8')).toBe(updated);
  expect(readFileSync(f.path + '.bak-before-key-change', 'utf8')).toBe(initial);
 });
 it.each([
  'tunnel="bogus"', 'expiry-time="bogus"', 'permitopen="bad"', 'permitlisten="bad:bogus"',
  'environment="broken"', 'command="a",command="b"', 'from="a",from="b"',
  'principals="a",principals="b"', 'cert-authority', 'principals="alice"',
  'from="192.0.2.0/24,!bad.example"', 'from=""', 'command="echo hello"',
  'restrict,restrict', 'pty,PtY', 'no-touch-required,NO-TOUCH-REQUIRED',
  'touch-required', 'no-verify-required',
 ])('does not trust %s for like, keep or already-present, but removes matching material', options => {
  const line = `${options} ${next} untrusted\r\n`;
  const initial = old + '\n' + line;
  const f = fixture(initial);
  for (const [change, guard] of [
   [remove, /keep/i], [{ ...add, key: other, like: next }, /like/i],
   [add, /untrusted|not trusted/i],
  ] as const) {
   let message = '';
   try { changeKey(f.target, change); } catch (error) { message = (error as Error).message; }
   expect(message).toMatch(guard);
   expect(message).not.toContain(next);
   expect(readFileSync(f.path, 'utf8')).toBe(initial);
   expect(readdirSync(join(f.path, '..'))).toEqual(['authorized_keys']);
  }
  // Material parsing remains independent of trust.
  expect(keyParts(line).key).toBe(next);
  expect(changeKey(f.target, { action: 'remove', key: next, keep: old })).toEqual({ removed: 1 });
  expect(readFileSync(f.path, 'utf8')).toBe(old + '\n');
 });
 it('does not use unknown options for either trust guard', () => {
  const initial = `${old}\nunknown ${next}\n`;
  const f = fixture(initial);
  expect(() => changeKey(f.target, remove)).toThrow(/keep/i);
  expect(() => changeKey(f.target, { ...add, key: other, like: next })).toThrow(/like/i);
  expect(readFileSync(f.path, 'utf8')).toBe(initial);
 });
 it.each(['', 'restrict,port-forwarding,pty', 'ReStRiCt,PoRt-FoRwArDiNg,PtY',
  'agent-forwarding,x11-forwarding,user-rc,no-port-forwarding,no-pty,no-agent-forwarding,no-x11-forwarding,no-user-rc,no-touch-required,verify-required',
 ])('trusts allow-listed options %j for add, already-present and keep', options => {
  const prefix = options ? options + ' ' : '';
  const f = fixture(`${prefix}${old}\n`);
  expect(changeKey(f.target, add)).toEqual({ added: true });
  expect(readFileSync(f.path, 'utf8')).toContain(`${prefix}${next} mars-ram:rotated:`);
  expect(changeKey(f.target, add)).toEqual({ added: false });
  expect(changeKey(f.target, remove)).toEqual({ removed: 1 });
 });
 it('uses a trusted duplicate even if an untrusted matching line comes first', () => {
  const f = fixture(`cert-authority ${old}\nrestrict ${old}\ncommand="a" ${next}\n${next}\n`);
  expect(changeKey(f.target, add)).toEqual({ added: false });
  expect(changeKey(f.target, remove)).toEqual({ removed: 2 });
  expect(readFileSync(f.path, 'utf8')).toBe(`command="a" ${next}\n${next}\n`);
 });
 it('keeps pairing material-based even for lines rotation does not trust', () => {
  const initial = `command="a" ${next}\n`;
  const f = fixture(initial);
  expect(authorizeKey(f.target, `restrict,port-forwarding,pty ${next}`)).toEqual({ ok: true });
  expect(readFileSync(f.path, 'utf8')).toBe(initial);
  expect(readdirSync(join(f.path, '..'))).toEqual(['authorized_keys']);
 });
 it('refuses add without the trusted like key, even if the new key is already present', () => {
  const f = fixture(next + '\n');
  expect(() => changeKey(f.target, add)).toThrow(/trust|like/i);
  expect(readFileSync(f.path, 'utf8')).toBe(next + '\n');
 });
 it('removes all exact duplicates, preserving all other bytes, comments, CRLF and unterminated last line', () => {
  const untouched = `# ${old}\r\n\r\nrestrict ${other} other\r\n${next} keep`;
  const f = fixture(`${old} first\r\nrestrict ${old} second\r\n` + untouched);
  expect(changeKey(f.target, remove)).toEqual({ removed: 2 });
  expect(readFileSync(f.path, 'utf8')).toBe(untouched);
  expect(changeKey(f.target, remove)).toEqual({ removed: 0 });
 });
 it('requires keep present and distinct, without touching the file', () => {
  const f = fixture(old + '\n');
  expect(() => changeKey(f.target, remove)).toThrow(/keep/i);
  expect(() => changeKey(f.target, { ...remove, keep: old })).toThrow(/differ/i);
  expect(readFileSync(f.path, 'utf8')).toBe(old + '\n');
 });
 it('overwrites only the designated backup on the next change and preserves POSIX mode and owner', () => {
  const f = fixture(old + '\n'); chmodSync(f.path, 0o600); const before = statSync(f.path);
  changeKey(f.target, add); const added = readFileSync(f.path, 'utf8'); changeKey(f.target, remove);
  expect(readFileSync(f.path + '.bak-before-key-change', 'utf8')).toBe(added);
  const after = statSync(f.path); expect(after.mode & 0o777).toBe(0o600); expect([after.uid, after.gid]).toEqual([before.uid, before.gid]);
 });
 it('leaves the original untouched and cleans staging and lock on atomic rename failure', () => {
  const f = fixture(old + '\n');
  expect(() => changeKey(f.target, add, { rename: () => { throw Error('rename failed'); } })).toThrow('rename failed');
  expect(readFileSync(f.path, 'utf8')).toBe(old + '\n');
  expect(readdirSync(join(f.path, '..')).sort()).toEqual(['authorized_keys', 'authorized_keys.bak-before-key-change']);
 });
 it.each(['\u00a0', '\u2003', '\v', '\f', '\r'])('never authorizes or removes keys with non-SSH separator %j', separator => {
  for (const malformed of [separator + next, next.replace(' ', separator), 'restrict' + separator + ' ' + next]) {
   expect(keyParts(malformed).key).toBe('');
   const f = fixture(old + '\n' + malformed + '\n');
   expect(() => changeKey(f.target, remove)).toThrow(/keep/i);
   expect(() => changeKey(f.target, { ...add, key: other, like: next })).toThrow(/trust|like/i);
   expect(readFileSync(f.path, 'utf8')).toBe(old + '\n' + malformed + '\n');
   // A malformed old line is preserved, even when another valid old line is removed.
   const g = fixture(next + '\n' + old + '\n' + malformed.replace(next, old) + '\n');
   expect(changeKey(g.target, remove)).toEqual({ removed: 1 });
   expect(readFileSync(g.path, 'utf8')).toBe(next + '\n' + malformed.replace(next, old) + '\n');
  }
 });
 it.each([' ', '\t', ' \t '])('recognizes SSH separator %j and preserves quoted options', separator => {
  const options = 'command="echo \\\"hello\\\" \\ world",restrict,pty';
  const line = separator + options + separator + old.replace(' ', separator) + '\r\n';
  expect(keyParts(line)).toEqual({ key: old, options });
  const f = fixture(line);
  expect(() => changeKey(f.target, add)).toThrow(/like/i);
  expect(readFileSync(f.path, 'utf8')).toBe(line);
 });
 it('recognizes OpenSSH case-insensitive options and does not invent negated restrict options', () => {
  expect(keyParts('ReStRiCt,No-PtY,CoMmAnD="echo hello" ' + old)).toEqual({ key: old, options: 'ReStRiCt,No-PtY,CoMmAnD="echo hello"' });
  expect(keyParts('no-restrict ' + old).key).toBe('');
 });
 it.each(['ssh-future', 'ssh-ed25519garbage', 'ecdsa-sha2-madeup'])('does not accept unrecognized type %s', type => {
  expect(keyParts(type + ' ' + old.split(' ')[1]).key).toBe('');
 });
 it.each(['ssh-ed25519 !!!!', 'ssh-ed25519 AAAA', 'ssh-rsa ' + old.split(' ')[1], 'restrict,command="unfinished ' + old])('does not accept invalid existing key %s', line => {
  expect(keyParts(line).key).toBe('');
 });
 it.each(['add', 'remove', 'pair'] as const)('retries %s after a concurrent write without losing the other line', action => {
  const f = fixture(old + '\n' + (action === 'remove' ? next + '\n' : '')); let attempts = 0;
  const options = { beforeCommit: () => {
   attempts++;
   expect(readdirSync(join(f.path, '..')).some(name => name.endsWith('.lock'))).toBe(true);
   if (attempts === 1) writeFileSync(f.path, readFileSync(f.path, 'utf8') + other + '\n');
  } };
  if (action === 'pair') expect(authorizeKey(f.target, 'restrict,port-forwarding,pty ' + next + ' phone', options)).toEqual({ ok: true });
  else expect(changeKey(f.target, action === 'add' ? add : remove, options)).toEqual(action === 'add' ? { added: true } : { removed: 1 });
  expect(readFileSync(f.path, 'utf8')).toContain(other + '\n');
  expect(readFileSync(f.path, 'utf8')).toContain(next);
  expect(readFileSync(f.path + (action === 'pair' ? '.bak-before-pairing' : '.bak-before-key-change'), 'utf8')).toContain(other + '\n');
  expect(attempts).toBe(2);
  expect(readdirSync(join(f.path, '..')).some(name => name.endsWith('.tmp') || name.includes('.lock'))).toBe(false);
 });
 it('revalidates keep after a retry instead of removing the remaining working key', () => {
  const f = fixture(old + '\n' + next + '\n');
  expect(() => changeKey(f.target, remove, { beforeCommit: () => writeFileSync(f.path, old + '\n') })).toThrow(/keep/i);
  expect(readFileSync(f.path, 'utf8')).toBe(old + '\n');
  expect(readdirSync(join(f.path, '..')).some(name => name.endsWith('.tmp') || name.includes('.lock'))).toBe(false);
 });
 it.each(['in-place', 'replacement'] as const)('detects same-size %s concurrent edits with restored mtime', kind => {
  const f = fixture(old + '\n# a\n'); const before = statSync(f.path); let attempts = 0;
  expect(changeKey(f.target, add, { beforeCommit: () => {
   if (++attempts !== 1) return;
   const path = kind === 'in-place' ? f.path : f.path + '.editor';
   writeFileSync(path, old + '\n# b\n'); utimesSync(path, before.atime, before.mtime);
   if (kind === 'replacement') renameSync(path, f.path);
  } })).toEqual({ added: true });
  expect(attempts).toBe(2); expect(readFileSync(f.path, 'utf8')).toContain('# b\n');
 });
 it('retries pairing if another writer creates the previously missing file', () => {
  const f = fixture(''); rmSync(f.path); let attempts = 0;
  expect(authorizeKey(f.target, next, { beforeCommit: () => { if (++attempts === 1) writeFileSync(f.path, other + '\n'); } })).toEqual({ ok: true });
  expect(attempts).toBe(2); expect(readFileSync(f.path, 'utf8')).toBe(other + '\n' + next + '\n');
 });
 it('copies Windows ACL and owner when pairing rewrites an existing administrators file', () => {
  const f = fixture(old + '\n'); const calls: string[] = [];
  expect(authorizeKey({ ...f.target, kind: 'windows-administrators' }, next, { platform: 'win32', run: command => { calls.push(command); } })).toEqual({ ok: true });
  expect(calls).toEqual(['powershell.exe', 'icacls', 'powershell.exe', 'icacls']);
  expect(readFileSync(f.path + '.bak-before-pairing', 'utf8')).toBe(old + '\n');
 });
 it.each(['rotation', 'pairing'])('exhausts five %s attempts cleanly and keeps the concurrent writer contents', action => {
  const f = fixture(old + '\n'); let attempts = 0;
  const options = { beforeCommit: () => { writeFileSync(f.path, old + '\n# edit ' + ++attempts + '\n'); } };
  if (action === 'rotation') expect(() => changeKey(f.target, add, options)).toThrow('authorized_keys changed while updating; try again');
  else expect(authorizeKey(f.target, next, options)).toEqual({ ok: false, message: 'authorized_keys changed while updating; try again' });
  expect(attempts).toBe(5);
  expect(readFileSync(f.path, 'utf8')).toBe(old + '\n# edit 5\n');
  expect(readdirSync(join(f.path, '..')).some(name => name.endsWith('.tmp') || name.includes('.lock'))).toBe(false);
 });
 it('pairs by rewriting with original owner/mode, options, bytes and backup', () => {
  const f = fixture('# trusted\r\n' + old); chmodSync(f.path, 0o640); const before = statSync(f.path);
  const line = 'restrict,port-forwarding,pty ' + next + ' phone';
  expect(authorizeKey(f.target, line)).toEqual({ ok: true });
  expect(readFileSync(f.path, 'utf8')).toBe('# trusted\r\n' + old + '\n' + line + '\n');
  expect(readFileSync(f.path + '.bak-before-pairing', 'utf8')).toBe('# trusted\r\n' + old);
  const after = statSync(f.path);
  expect([after.uid, after.gid, after.mode & 0o777]).toEqual([before.uid, before.gid, 0o640]);
  expect(after.ino).not.toBe(before.ino);
 });
 it('refuses non-elevated administrator writes before any file mutation', () => {
  const f = fixture(old + '\n');
  expect(() => changeKey({ ...f.target, kind: 'windows-administrators' }, add, { platform: 'win32', elevated: false })).toThrow(/elevat/i);
  expect(readdirSync(join(f.path, '..'))).toEqual(['authorized_keys']);
 });
 it('copies Windows ACL and owner with encoded paths and shell disabled; admin temp is also restricted', () => {
  const calls: { command: string; args: string[]; options: unknown }[] = [];
  copyKeyAcl("C:\\a'; bad\\keys", 'C:\\temp', true, (command, args, options) => { calls.push({ command, args, options }); return ''; });
  expect(calls).toHaveLength(2);
  expect(calls[0]!.command).toBe('powershell.exe');
  expect(calls[0]!.args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand']);
  const script = Buffer.from(calls[0]!.args[3]!, 'base64').toString('utf16le');
  expect(script).toContain('Get-Acl -LiteralPath'); expect(script).toContain('Set-Acl -LiteralPath'); expect(script).toContain('SetOwner');
  expect(script).not.toContain("a'; bad");
  expect(script).toContain('SetAccessRuleProtection($true,$false)'); expect(script).toContain('RemoveAccessRuleSpecific');
  expect(script).toContain("@('S-1-5-18','S-1-5-32-544')");
  expect(calls[1]!.args).toEqual(['C:\\temp', '/inheritance:r', '/grant', '*S-1-5-18:F', '/grant', '*S-1-5-32-544:F']);
  for (const call of calls) expect(call.options).toMatchObject({ shell: false });
 });
 it('leaves original untouched if Windows ACL copy fails', () => {
  const f = fixture(old + '\n');
  expect(() => changeKey(f.target, add, { platform: 'win32', run: () => { throw Error('ACL failed'); } })).toThrow('ACL failed');
  expect(readFileSync(f.path, 'utf8')).toBe(old + '\n');
  expect(readdirSync(join(f.path, '..')).some(p => p.endsWith('.tmp') || p.endsWith('.lock'))).toBe(false);
 });
 it('cleans a fully written temp when its ACL fails, before rename', () => {
  const f = fixture(old + '\n'); let calls = 0;
  expect(() => changeKey(f.target, add, { platform: 'win32', run: () => { if (++calls === 2) throw Error('temp ACL failed'); } })).toThrow('temp ACL failed');
  expect(calls).toBe(2); expect(readFileSync(f.path, 'utf8')).toBe(old + '\n');
  expect(readdirSync(join(f.path, '..')).sort()).toEqual(['authorized_keys', 'authorized_keys.bak-before-key-change']);
 });
 it('preserves non-UTF8 comment bytes', () => {
  const f = fixture(old + '\n' + next + '\n');
  const tail = Buffer.from([35, 32, 255, 254, 13, 10]);
  writeFileSync(f.path, Buffer.concat([readFileSync(f.path), tail]));
  expect(changeKey(f.target, remove)).toEqual({ removed: 1 });
  expect(readFileSync(f.path)).toEqual(Buffer.concat([Buffer.from(next + '\n'), tail]));

 });
 it.each([`restrict ${next}`, next + ' comment', next + '\n', next.replace(' ', '\t'), 'ssh-rsa AAAA', 'ssh-ed25519 !!!!', 'ssh-ed25519 AAAA', 'ecdsa-sha2-nistp256 ' + next.split(' ')[1]])('rejects malformed or smuggled argument %s', value => {
  expect(() => validateRotationKey(value)).toThrow(/key/i);
  const f = fixture(old + '\n'); expect(() => changeKey(f.target, { ...add, key: value })).toThrow(/key/i);
 });
 it('parses only the exact key command contract (both flag orders)', () => {
  expect(parseArguments(['key', 'add', '--key', next, '--like', old])).toEqual({ ok: true, command: 'key', action: 'add', key: next, like: old });
  expect(parseArguments(['key', 'remove', '--keep', next, '--key', old])).toEqual({ ok: true, command: 'key', action: 'remove', key: old, keep: next });
  for (const args of [['key', 'add', '--key', next], ['key', 'add', '--key', next, '--keep', old], ['key', 'remove', '--key', next, '--key', old]]) expect(parseArguments(args)).toEqual({ ok: false });
 });
});
