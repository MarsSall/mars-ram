import { isTailnetAddress, validNotifySecret } from '@workspace/protocol/session-notice';
import { inSubnet, isIpv4 } from '@workspace/protocol/private-network';
import type { NotifyRegistrationStore } from '../../../link-server/src/core/notify-registration.ts';
export type { NotifyRegistration, NotifyRegistrationStore } from '../../../link-server/src/core/notify-registration.ts';
/** The phone's address; a ZeroTier phone also names the computer's ZeroTier address it registered through. */
export type NotifyPeer = { address: string } | { address: string; network: 'zerotier'; hostAddress: string };
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
/** ZeroTier when SSH arrived on a verified ZeroTier address of this computer from inside that interface's subnet;
 * any other connection follows the Tailscale rules of registrationAddress unchanged. */
export function registrationPeer(env: { SSH_CONNECTION?: string; SSH_CLIENT?: string }, zeroTier: () => { address: string; prefix: number | null }[]): NotifyPeer {
 const fields = env.SSH_CONNECTION?.trim().split(/\s+/);
 if (fields?.length === 4 && isIpv4(fields[2]!)) {
  let networks: { address: string; prefix: number | null }[] = [];
  try { networks = zeroTier(); } catch { /* Unreadable interfaces hold no ZeroTier address. */ }
  const local = networks.find(network => network.address === fields[2]);
  if (local) {
   const [source, sourcePort, , localPort] = fields as [string, string, string, string];
   // A prefix below /8 would make almost any source look local.
   if (local.prefix === null || local.prefix < 8 || !isIpv4(source) || source === local.address || !inSubnet(source, local.address, local.prefix)
    || !/^\d+$/.test(sourcePort) || !/^\d+$/.test(localPort)) throw Error('Invalid SSH source.');
   if (env.SSH_CLIENT !== undefined) {
    const client = env.SSH_CLIENT.trim().split(/\s+/);
    if (client.length !== 3 || client[0] !== source || !/^\d+$/.test(client[1]!) || !/^\d+$/.test(client[2]!)) throw Error('Invalid SSH source.');
   }
   return { address: source, network: 'zerotier', hostAddress: local.address };
  }
 }
 return { address: registrationAddress(env) };
}
export async function runNotify(args: string[], ports: {
 peer(): NotifyPeer; hostKeyId(): string; readInput(): Promise<string>; store: NotifyRegistrationStore; ensure(peer: NotifyPeer): Promise<void>;
}): Promise<{ v: 1; ok: boolean; hostKeyId?: string; port?: number; registered?: boolean; network?: 'zerotier'; code?: string }> {
 try {
  const command = args.join(' ');
  if (!['register --json', 'status --json', 'unregister'].includes(command)) throw Error();
  const peer = ports.peer();
  const zeroTier = 'network' in peer ? peer : undefined;
  const { address } = peer;
  if (zeroTier ? zeroTier.network !== 'zerotier' || !isIpv4(address) || !isIpv4(zeroTier.hostAddress) : !isTailnetAddress(address)) throw Error();
  // Tailscale answers carry no network field, exactly as before.
  const network = zeroTier ? { network: 'zerotier' as const } : {};
  if (command === 'unregister') { await ports.store.remove(address); return { v: 1, ok: true }; }
  if (command === 'status --json') {
   const found = await ports.store.get(address);
   const row = found && zeroTier && (found.network !== 'zerotier' || found.hostAddress !== zeroTier.hostAddress) ? null : found;
   return { v: 1, ok: true, registered: row !== null, ...(row ? { hostKeyId: row.hostKeyId, port: row.port } : {}), ...network };
  }
  const input = await ports.readInput();
  if (new TextEncoder().encode(input).length > 1024) throw Error();
  const body = JSON.parse(input);
  if (!body || Object.keys(body).sort().join(',') !== 'port,secret' || !validNotifySecret(body.secret) || !Number.isInteger(body.port) || body.port < 1 || body.port > 65535) throw Error();
  const hostKeyId = ports.hostKeyId();
  await ports.store.put({ address, port: body.port, secret: body.secret, hostKeyId, ...(zeroTier ? { network: 'zerotier' as const, hostAddress: zeroTier.hostAddress } : {}) });
  await ports.ensure(peer);
  return { v: 1, ok: true, hostKeyId, port: body.port, ...network };
 } catch { return { v: 1, ok: false, code: 'NOTIFY_FAILED' }; }
}
