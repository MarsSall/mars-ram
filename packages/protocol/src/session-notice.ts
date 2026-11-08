// Independent, versioned short-notice contract. No bridge credentials or agent content.
export const NOTICE_MAX_BYTES = 4096;
export const NOTICE_WINDOW_MS = 120_000;
export type SessionNotice = {
 v: 1; hostKeyId: string; bridgeInstanceId: string; project: string;
 kind: 'finished' | 'needs-answer' | 'failed'; seq: number; sentAt: number; nonce: string;
};
const fields = ['v', 'hostKeyId', 'bridgeInstanceId', 'project', 'kind', 'seq', 'sentAt', 'nonce'];
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f-\x9f\ud800-\udfff]/u.test(value);
export function validNotice(value: unknown): value is SessionNotice {
 if (!value || typeof value !== 'object') return false;
 const n = value as SessionNotice;
 return Object.keys(n).length === fields.length && fields.every(key => Object.hasOwn(n, key)) && n.v === 1
  && text(n.hostKeyId, 256) && text(n.bridgeInstanceId, 256) && text(n.project, 200)
  && !/[\\/]/.test(n.project) && n.project !== '.' && n.project !== '..'
  && ['finished', 'needs-answer', 'failed'].includes(n.kind)
  && Number.isSafeInteger(n.seq) && n.seq >= 0 && Number.isSafeInteger(n.sentAt) && n.sentAt >= 0
  && typeof n.nonce === 'string' && /^[a-f0-9]{32}$/.test(n.nonce);
}
/** UTF-8 JSON array, fixed order, no whitespace; JSON escaping, not locale sorting. */
export function canonicalNotice(n: SessionNotice): string {
 if (!validNotice(n)) throw Error('Invalid notice.');
 return JSON.stringify([n.v, n.hostKeyId, n.bridgeInstanceId, n.project, n.kind, n.seq, n.sentAt, n.nonce]);
}
export const validNotifySecret = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
async function key(secret: string) {
 if (!validNotifySecret(secret)) throw Error('Invalid notice secret.');
 return crypto.subtle.importKey('raw', Uint8Array.from(secret.match(/../g)!, pair => parseInt(pair, 16)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signNotice(n: SessionNotice, secret: string): Promise<string> {
 const bytes = new TextEncoder().encode(canonicalNotice(n));
 const signature = await crypto.subtle.sign('HMAC', await key(secret), bytes);
 const mac = Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
 const line = JSON.stringify({ ...n, mac }) + '\n';
 if (new TextEncoder().encode(line).length > NOTICE_MAX_BYTES) throw Error('Notice too large.');
 return line;
}
export async function verifyNotice(line: string, secret: string): Promise<SessionNotice | null> {
 try {
  if (new TextEncoder().encode(line).length > NOTICE_MAX_BYTES) return null;
  const { mac, ...n } = JSON.parse(line);
  if (!validNotice(n) || typeof mac !== 'string' || !/^[a-f0-9]{64}$/.test(mac)) return null;
  const signature = Uint8Array.from(mac.match(/../g)!, pair => parseInt(pair, 16));
  return await crypto.subtle.verify('HMAC', await key(secret), signature, new TextEncoder().encode(canonicalNotice(n))) ? n : null;
 } catch { return null; }
}
/** Call only AFTER authentication. Fail closed when full; never evict live replay cursors. */
export class NoticeReplay {
 private cursors = new Map<string, { seq: number; expires: number }>();
 private readonly capacity: number;
 constructor(capacity = 4096) { this.capacity = capacity; }
 accept(n: SessionNotice, now: number): boolean {
  if (!validNotice(n) || Math.abs(now - n.sentAt) > NOTICE_WINDOW_MS) return false;
  for (const [id, cursor] of this.cursors) if (cursor.expires < now) this.cursors.delete(id);
  const id = JSON.stringify([n.hostKeyId, n.bridgeInstanceId]);
  const previous = this.cursors.get(id);
  if (previous ? n.seq <= previous.seq : this.cursors.size >= this.capacity) return false;
  this.cursors.set(id, { seq: n.seq, expires: Math.max(previous?.expires ?? 0, n.sentAt + NOTICE_WINDOW_MS) });
  return true;
 }
}
/** Literal address validation; no DNS, zone identifiers or mapped-address aliases. */
export function isTailnetAddress(ip: string): boolean {
 if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
  const parts = ip.split('.');
  if (parts.some(p => !/^(?:0|[1-9]\d{0,2})$/.test(p) || Number(p) > 255)) return false;
  return Number(parts[0]) === 100 && Number(parts[1]) >= 64 && Number(parts[1]) <= 127;
 }
 if (!/^fd7a:115c:a1e0:/i.test(ip) || !/^[a-f0-9:]+$/i.test(ip)) return false;
 const halves = ip.split('::');
 if (halves.length > 2) return false;
 const groups = halves.flatMap(h => h ? h.split(':') : []);
 if (groups.some(g => !/^[a-f0-9]{1,4}$/i.test(g))) return false;
 return halves.length === 2 ? groups.length < 8 : groups.length === 8;
}
