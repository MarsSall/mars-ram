import { isTailnetAddress, validNotifySecret } from '@workspace/protocol/session-notice';
import type { NotifyRegistrationStore } from '../../../link-server/src/core/notify-registration.ts';
export type { NotifyRegistration, NotifyRegistrationStore } from '../../../link-server/src/core/notify-registration.ts';
export function registrationAddress(env: { SSH_CONNECTION?: string; SSH_CLIENT?: string }): string {
 const parse = (value: string | undefined, count: number) => {
  if (value === undefined) return undefined;
  const fields = value.trim().split(/\s+/);
  if (fields.length !== count || !isTailnetAddress(fields[0]!) || !/^\d+$/.test(fields[1]!) || !/^\d+$/.test(fields.at(-1)!)) throw Error('Invalid SSH source.');
  return fields[0]!;
 };
 const connection = parse(env.SSH_CONNECTION, 4), client = parse(env.SSH_CLIENT, 3);
 if ((!connection && !client) || (connection && client && connection !== client)) throw Error('Invalid SSH source.');
 return connection ?? client!;
}
export async function runNotify(args: string[], ports: {
 address(): string; hostKeyId(): string; readInput(): Promise<string>; store: NotifyRegistrationStore; ensure(): Promise<void>;
}): Promise<{ v: 1; ok: boolean; hostKeyId?: string; port?: number; registered?: boolean; code?: string }> {
 try {
  const command = args.join(' ');
  if (!['register --json', 'status --json', 'unregister'].includes(command)) throw Error();
  const address = ports.address();
  if (!isTailnetAddress(address)) throw Error();
  if (command === 'unregister') { await ports.store.remove(address); return { v: 1, ok: true }; }
  if (command === 'status --json') { const row = await ports.store.get(address); return { v: 1, ok: true, registered: row !== null, ...(row ? { hostKeyId: row.hostKeyId, port: row.port } : {}) }; }
  const input = await ports.readInput();
  if (new TextEncoder().encode(input).length > 1024) throw Error();
  const body = JSON.parse(input);
  if (!body || Object.keys(body).sort().join(',') !== 'port,secret' || !validNotifySecret(body.secret) || !Number.isInteger(body.port) || body.port < 1 || body.port > 65535) throw Error();
  const hostKeyId = ports.hostKeyId();
  await ports.store.put({ address, port: body.port, secret: body.secret, hostKeyId });
  await ports.ensure();
  return { v: 1, ok: true, hostKeyId, port: body.port };
 } catch { return { v: 1, ok: false, code: 'NOTIFY_FAILED' }; }
}
