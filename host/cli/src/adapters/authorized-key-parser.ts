// authorized_keys uses ASCII space/tab, not JavaScript's Unicode whitespace class.
import { ECDH } from 'node:crypto';

const TYPES = new Set([
 'ssh-rsa', 'ssh-dss', 'ssh-ed25519',
 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521',
 'sk-ssh-ed25519@openssh.com', 'sk-ecdsa-sha2-nistp256@openssh.com',
]);
const FLAGS = new Set(['restrict', 'cert-authority']);
const TOGGLES = new Set(['touch-required', 'verify-required', 'agent-forwarding', 'port-forwarding', 'x11-forwarding', 'pty', 'user-rc']);
const VALUES = new Set(['command', 'environment', 'from', 'principals', 'permitopen', 'permitlisten', 'tunnel', 'expiry-time']);
const space = (char: string | undefined) => char === ' ' || char === '\t';

/** OpenSSH only escapes a double quote, not arbitrary characters, while advancing options. */
function optionsEnd(line: string): number {
 let quoted = false;
 for (let i = 0; i < line.length; i++) {
  if (line[i] === '\\' && line[i + 1] === '"') { i++; continue; }
  if (line[i] === '"') quoted = !quoted;
  else if (!quoted && space(line[i])) return i;
 }
 return -1;
}
function validOptions(options: string): boolean {
 let i = 0;
 while (i < options.length) {
  const start = i;
  while (i < options.length && options[i] !== ',' && options[i] !== '=') i++;
  const name = options.slice(start, i).toLowerCase();
  if (options[i] === '=') {
   if (!VALUES.has(name) || options[++i] !== '"') return false;
   i++;
   let closed = false;
   for (; i < options.length; i++) {
    if (options[i] === '\\' && options[i + 1] === '"') { i++; continue; }
    if (options[i] === '"') { i++; closed = true; break; }
   }
   if (!closed) return false;
  } else if (!FLAGS.has(name) && !TOGGLES.has(name) && !(name.startsWith('no-') && TOGGLES.has(name.slice(3)))) return false;
  if (i === options.length) return true;
  if (options[i++] !== ',' || i === options.length) return false;
 }
 return false;
}

function validBlob(type: string, encoded: string): string | undefined {
 if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return;
 const bytes = Buffer.from(encoded, 'base64');
 const canonical = bytes.toString('base64');
 if (canonical.replace(/=+$/, '') !== encoded.replace(/=+$/, '') || (encoded.includes('=') && canonical !== encoded)) return;
 let offset = 0;
 const field = () => {
  if (offset + 4 > bytes.length) throw Error('Truncated SSH field');
  const length = bytes.readUInt32BE(offset); offset += 4;
  if (length > bytes.length - offset) throw Error('Truncated SSH field');
  const value = bytes.subarray(offset, offset + length); offset += length;
  return value;
 };
 const skip = (length: number) => { if (offset + length > bytes.length) throw Error('Truncated SSH field'); offset += length; };
 try {
  if (!field().equals(Buffer.from(type))) return;
  const certificate = type.endsWith('-cert-v01@openssh.com');
  const base = certificate ? type.replace('-cert-v01@openssh.com', '').replace(/^(sk-.*)$/, '$1@openssh.com') : type;
  if (!TYPES.has(base)) return;
  if (certificate) field(); // nonce
  if (base === 'ssh-ed25519' || base === 'sk-ssh-ed25519@openssh.com') {
   if (field().length !== 32) return;
  } else if (base === 'ssh-rsa' || base === 'ssh-dss') {
   for (let i = 0; i < (base === 'ssh-rsa' ? 2 : 4); i++) if (field().length === 0) return;
  } else {
   const curve = base.match(/nistp(256|384|521)/)?.[0];
   if (!curve || !field().equals(Buffer.from(curve))) return;
   const point = field();
   ECDH.convertKey(point, { nistp256: 'prime256v1', nistp384: 'secp384r1', nistp521: 'secp521r1' }[curve]!);
  }
  if (base.startsWith('sk-')) field(); // application
  if (certificate) {
   skip(8); // serial
   if (offset + 4 > bytes.length || ![1, 2].includes(bytes.readUInt32BE(offset))) return;
   skip(4); field(); field(); skip(16); // type, key id, principals, validity
   field(); field(); field(); field(); field(); // critical options, extensions, reserved, signature key/signature
  }
  return offset === bytes.length ? canonical : undefined;
 } catch { return; }
}

const PLAIN_KEY_FLAGS = new Set([
 'restrict', 'port-forwarding', 'pty', 'agent-forwarding', 'x11-forwarding', 'user-rc',
 'no-port-forwarding', 'no-pty', 'no-agent-forwarding', 'no-x11-forwarding', 'no-user-rc',
 'no-touch-required', 'verify-required',
]);

/** Conservative rotation guard, not an implementation of sshd option validation.
 * Keep material parsing separate so untrusted old-key lines can still be removed.
 * In particular, CA/principals entries do not authorize plain keys, and from=
 * cannot be evaluated here for the phone's client address.
 */
export function trustedPlainKey(line: string): boolean {
 const { key, options } = keyParts(line);
 if (!key) return false;
 if (!options) return true;
 const seen = new Set<string>();
 for (const option of options.toLowerCase().split(',')) {
  if (!PLAIN_KEY_FLAGS.has(option) || seen.has(option)) return false;
  seen.add(option);
 }
 return true;
}

export function keyOf(line: string): string { return keyParts(line).key; }
export function keyParts(line: string): { key: string; options: string } {
 const empty = { key: '', options: '' };
 // Only a CR immediately before the line-ending LF is removed. An embedded CR is data.
 let rest = line.replace(/\r?\n$/, '').replace(/^[ \t]+/, '');
 if (rest === '' || rest[0] === '#' || rest.includes('\n') || rest.includes('\0')) return empty;
 let options = '';
 const recognized = (type: string) => TYPES.has(type) || (type.endsWith('-cert-v01@openssh.com') && TYPES.has(type.replace('-cert-v01@openssh.com', '').replace(/^(sk-.*)$/, '$1@openssh.com')));
 if (!recognized(rest.split(/[ \t]/)[0] ?? '')) {
  const end = optionsEnd(rest);
  if (end < 0) return empty;
  options = rest.slice(0, end);
  if (!validOptions(options)) return empty;
  rest = rest.slice(end).replace(/^[ \t]+/, '');
 }
 const [type, blob] = rest.split(/[ \t]+/);
 if (!type || !blob || !recognized(type)) return empty;
 const canonical = validBlob(type, blob);
 return canonical ? { key: `${type} ${canonical}`, options } : empty;
}
