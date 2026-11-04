// Rotation only changes an existing trusted file; never creates a new trust relationship.
import { ECDH } from 'node:crypto';
import { keyOf, keyParts, type KeyTarget } from './authorized-keys.ts';
import { trustedPlainKey } from './authorized-key-parser.ts';
import { rewriteKeyFile, type RewriteOptions } from './authorized-key-file.ts';
export { copyKeyAcl, type KeyRunner } from './authorized-key-file.ts';
export type KeyChange = { action: 'add'; key: string; like: string } | { action: 'remove'; key: string; keep: string };
export type ChangeOptions = RewriteOptions & { date?: Date; elevated?: boolean };

/** Exactly two fields, canonical base64, and complete supported SSH wire-format blobs. */
export function validateRotationKey(value: string): string {
 const match = /^(ssh-ed25519|ecdsa-sha2-nistp256) ([A-Za-z0-9+/]+={0,2})$/.exec(value);
 const bad = () => new Error('Invalid public key: expected ecdsa-sha2-nistp256 or ssh-ed25519 and a valid matching SSH blob.');
 if (!match || match[0] !== value) throw bad();
 const bytes = Buffer.from(match[2]!, 'base64');
 if (bytes.toString('base64').replace(/=+$/, '') !== match[2]!.replace(/=+$/, '')) throw bad();
 // Padding, if supplied, must also be correct.
 if (match[2]!.includes('=') && bytes.toString('base64') !== match[2]) throw bad();
 let offset = 0;
 const field = () => {
  if (offset + 4 > bytes.length) throw bad();
  const length = bytes.readUInt32BE(offset); offset += 4;
  if (length > bytes.length - offset) throw bad();
  const result = bytes.subarray(offset, offset + length); offset += length; return result;
 };
 if (!field().equals(Buffer.from(match[1]!))) throw bad();
 if (match[1] === 'ssh-ed25519') { if (field().length !== 32) throw bad(); }
 else {
  if (!field().equals(Buffer.from('nistp256'))) throw bad();
  const point = field();
  if (point.length !== 65 || point[0] !== 4) throw bad();
  try { ECDH.convertKey(point, 'prime256v1'); } catch { throw bad(); }
 }
 if (offset !== bytes.length) throw bad();
 return `${match[1]} ${bytes.toString('base64')}`;
}

export function changeKey(target: KeyTarget, change: KeyChange, options: ChangeOptions = {}): { added: boolean } | { removed: number } {
 const key = validateRotationKey(change.key);
 const trusted = validateRotationKey(change.action === 'add' ? change.like : change.keep);
 if (change.action === 'remove' && key === trusted) throw Error('--key and --keep must differ.');
 if (target.kind === 'windows-administrators' && !options.elevated) throw Error('The administrators authorized_keys file requires an elevated process. Run from an elevated SSH session.');
 return rewriteKeyFile(target, '.bak-before-key-change', false, bytes => {
  // Latin1 is deliberately lossless: comments need not be valid UTF-8.
  const current = bytes.toString('latin1');
  const lines = current.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const material = (line: string) => {
   const parsed = keyOf(line);
   // Normalize optional base64 padding for material comparisons, not comments/options.
   return parsed.replace(/=+$/, '');
  };
  const matches = (line: string, value: string) => material(line) === value.replace(/=+$/, '');
  const like = lines.find(line => matches(line, trusted) && trustedPlainKey(line));
  if (like === undefined) throw Error(change.action === 'add' ? '--like has no trusted plain-key login line (the current phone key).' : '--keep has no trusted plain-key login line; refusing to remove a phone key.');
  let updated: string;
  let result: { added: boolean } | { removed: number };
  if (change.action === 'add') {
   const existing = lines.filter(line => matches(line, key));
   if (existing.some(trustedPlainKey)) return { result: { added: false } };
   if (existing.length > 0) throw Error('--key exists only on untrusted lines; refusing to add a duplicate.');
   const prefix = keyParts(like).options;
   const eol = current.includes('\r\n') ? '\r\n' : '\n';
   updated = current + (current === '' || current.endsWith('\n') ? '' : eol) + (prefix ? prefix + ' ' : '') + key + ` mars-ram:rotated:${(options.date ?? new Date()).toISOString().slice(0, 10)}` + eol;
   result = { added: true };
  } else {
   const kept = lines.filter(line => !matches(line, key));
   result = { removed: lines.length - kept.length };
   if (result.removed === 0) return { result };
   updated = kept.join('');
  }
  return { bytes: Buffer.from(updated, 'latin1'), result };
 }, options);
}
