import { describe, it, expect } from 'vitest';
import { runNotify, registrationAddress, registrationPeer } from '../../src/core/notify.ts';
import { privateNotifyMode } from '../../../link-server/src/core/notify-registration.ts';
import { parseArguments } from '../../src/arguments.ts';
import { checkLinkServer, type DoctorPorts } from '../../src/core/doctor.ts';
const secret = 'ab'.repeat(32);
describe('notification registration', () => {
 it('doctor warns that registered notifications require the link-server process', async () => {
  const ports = { spanish: false, linkServer: async () => ({ present: true, current: true, configured: true, validLinks: 0, listener: false, notificationsRegistered: true }) } as DoctorPorts;
  expect(await checkLinkServer(ports)).toContainEqual(expect.objectContaining({ status: 'warning', finding: 'Always-attentive notifications need the link server running.' }));
 });
 it('routes notify without putting secrets in argv', () => expect(parseArguments(['notify', 'register', '--json'])).toEqual({ ok: true, command: 'notify', args: ['register', '--json'] }));
 it('uses only SSH source IP and rejects conflicting or non-tailnet metadata', () => {
  expect(registrationAddress({ SSH_CONNECTION: '100.64.1.2 1234 100.64.2.3 22' })).toBe('100.64.1.2');
  expect(registrationAddress({ SSH_CLIENT: 'fd7a:115c:a1e0::1 1234 22' })).toBe('fd7a:115c:a1e0::1');
  for (const env of [{}, { SSH_CLIENT: '127.0.0.1 1 22' }, { SSH_CLIENT: '100.64.1.2 1 22', SSH_CONNECTION: '100.64.1.3 1 100.64.2.2 22' }, { SSH_CLIENT: '100.64.1.2 garbage' }]) expect(() => registrationAddress(env)).toThrow();
 });
 it('requires private POSIX metadata', () => {
  expect(privateNotifyMode(0o700, true)).toBe(true);
  expect(privateNotifyMode(0o600, false)).toBe(true);
  for (const mode of [0o644, 0o660, 0o777]) expect(privateNotifyMode(mode, false)).toBe(false);
 });
 it('registers, reports no secrets and unregisters only the caller', async () => {
  const rows = new Map();
  const ports = { peer: () => ({ address: '100.64.1.2' }), hostKeyId: () => 'SHA256:host', readInput: async () => JSON.stringify({ secret, port: 47812 }), store: { put: async (r: any) => { rows.set(r.address, r); }, remove: async (address: string) => { rows.delete(address); }, get: async (address: string) => rows.get(address) ?? null }, ensure: async () => {} };
  expect(await runNotify(['register', '--json'], ports)).toEqual({ v: 1, ok: true, hostKeyId: 'SHA256:host', port: 47812 });
  expect(JSON.stringify(await runNotify(['status', '--json'], ports))).not.toContain(secret);
  expect(await runNotify(['unregister'], ports)).toEqual({ v: 1, ok: true });
  expect(rows.size).toBe(0);
 });
 it('rejects unknown fields, invalid ports and secret argv before persistence', async () => {
  let writes = 0;
  for (const input of [{ secret, port: 0 }, { secret, port: 65536 }, { secret: 'bad', port: 1 }, { secret, port: 1, address: '100.64.1.3' }]) {
   const ports = { peer: () => ({ address: '100.64.1.2' }), hostKeyId: () => 'host', readInput: async () => JSON.stringify(input), store: { put: async () => { writes++; }, remove: async () => {}, get: async () => null }, ensure: async () => {} };
   expect((await runNotify(['register', '--json'], ports)).ok).toBe(false);
   expect((await runNotify(['register', '--secret', secret], ports)).ok).toBe(false);
  }
  expect(writes).toBe(0);
 });
});
describe('notification registration over ZeroTier', () => {
 const zt = [{ address: '10.147.20.49', prefix: 24 }, { address: '10.144.0.2', prefix: 16 }];
 it('keeps Tailscale sources exactly as before, without needing ZeroTier', () => {
  expect(registrationPeer({ SSH_CONNECTION: '100.64.1.2 1234 100.64.2.3 22' }, () => zt)).toEqual({ address: '100.64.1.2' });
  expect(registrationPeer({ SSH_CLIENT: 'fd7a:115c:a1e0::1 1234 22' }, () => { throw Error('not read'); })).toEqual({ address: 'fd7a:115c:a1e0::1' });
  expect(registrationPeer({ SSH_CONNECTION: '100.64.1.2 1234 100.64.2.3 22' }, () => { throw Error('unreadable'); })).toEqual({ address: '100.64.1.2' });
 });
 it('accepts a phone that reached a verified ZeroTier address from inside its subnet', () => {
  expect(registrationPeer({ SSH_CONNECTION: '10.147.20.20 50000 10.147.20.49 22' }, () => zt)).toEqual({ address: '10.147.20.20', network: 'zerotier', hostAddress: '10.147.20.49' });
  expect(registrationPeer({ SSH_CONNECTION: '10.144.9.9 50000 10.144.0.2 22', SSH_CLIENT: '10.144.9.9 50000 22' }, () => zt)).toEqual({ address: '10.144.9.9', network: 'zerotier', hostAddress: '10.144.0.2' });
 });
 it.each([
  [{ SSH_CONNECTION: '10.147.172.20 50000 10.147.20.49 22' }, 'source outside the ZeroTier subnet'],
  [{ SSH_CONNECTION: '192.168.1.30 50000 192.168.1.20 22' }, 'LAN address, not ZeroTier'],
  [{ SSH_CONNECTION: '10.147.20.20 50000 10.147.20.50 22' }, 'local address not on this computer'],
  [{ SSH_CONNECTION: '10.147.20.49 50000 10.147.20.49 22' }, 'the computer itself'],
  [{ SSH_CONNECTION: '10.147.20.20 50000 10.147.20.49 22', SSH_CLIENT: '10.147.20.21 50000 22' }, 'conflicting SSH_CLIENT'],
  [{ SSH_CLIENT: '10.147.20.20 50000 22' }, 'no local address'],
  [{ SSH_CONNECTION: '10.147.20.20 x 10.147.20.49 22' }, 'garbage port'],
  [{ SSH_CONNECTION: '010.147.20.20 50000 10.147.20.49 22' }, 'non-literal source'],
 ])('rejects %j (%s)', (env, _reason) => {
  expect(() => registrationPeer(env, () => zt)).toThrow();
 });
 it('rejects a ZeroTier interface with an unknown or too broad prefix', () => {
  expect(() => registrationPeer({ SSH_CONNECTION: '10.147.20.20 50000 10.147.20.49 22' }, () => [{ address: '10.147.20.49', prefix: null }])).toThrow();
  expect(() => registrationPeer({ SSH_CONNECTION: '11.0.0.1 50000 10.147.20.49 22' }, () => [{ address: '10.147.20.49', prefix: 0 }])).toThrow();
 });
 it('stores the network with a ZeroTier phone and starts its listener', async () => {
  const rows = new Map(); const ensured: unknown[] = [];
  const peer = { address: '10.147.20.20', network: 'zerotier' as const, hostAddress: '10.147.20.49' };
  const ports = { peer: () => peer, hostKeyId: () => 'SHA256:host', readInput: async () => JSON.stringify({ secret, port: 47812 }), store: { put: async (r: any) => { rows.set(r.address, r); }, remove: async (address: string) => { rows.delete(address); }, get: async (address: string) => rows.get(address) ?? null }, ensure: async (value: unknown) => { ensured.push(value); } };
  expect(await runNotify(['register', '--json'], ports)).toEqual({ v: 1, ok: true, hostKeyId: 'SHA256:host', port: 47812, network: 'zerotier' });
  expect([...rows.values()]).toEqual([{ address: '10.147.20.20', port: 47812, secret, hostKeyId: 'SHA256:host', network: 'zerotier', hostAddress: '10.147.20.49' }]);
  expect(ensured).toEqual([peer]);
  expect(await runNotify(['status', '--json'], ports)).toEqual({ v: 1, ok: true, registered: true, hostKeyId: 'SHA256:host', port: 47812, network: 'zerotier' });
  expect(await runNotify(['unregister'], ports)).toEqual({ v: 1, ok: true });
  expect(rows.size).toBe(0);
 });
 it('keeps the Tailscale register output and record unchanged', async () => {
  const rows: unknown[] = [];
  const ports = { peer: () => ({ address: '100.64.1.2' }), hostKeyId: () => 'SHA256:host', readInput: async () => JSON.stringify({ secret, port: 47812 }), store: { put: async (r: unknown) => { rows.push(r); }, remove: async () => {}, get: async () => null }, ensure: async () => {} };
  expect(JSON.stringify(await runNotify(['register', '--json'], ports))).toBe('{"v":1,"ok":true,"hostKeyId":"SHA256:host","port":47812}');
  expect(JSON.stringify(rows)).toBe(`[{"address":"100.64.1.2","port":47812,"secret":"${secret}","hostKeyId":"SHA256:host"}]`);
 });
 it('refuses a malformed ZeroTier peer before persistence', async () => {
  let writes = 0;
  for (const peer of [{ address: 'x', network: 'zerotier' as const, hostAddress: '10.147.20.49' }, { address: '10.147.20.20', network: 'zerotier' as const, hostAddress: 'x' }, { address: '10.147.20.20' }]) {
   const ports = { peer: () => peer, hostKeyId: () => 'host', readInput: async () => JSON.stringify({ secret, port: 47812 }), store: { put: async () => { writes++; }, remove: async () => {}, get: async () => null }, ensure: async () => {} };
   expect(await runNotify(['register', '--json'], ports)).toEqual({ v: 1, ok: false, code: 'NOTIFY_FAILED' });
  }
  expect(writes).toBe(0);
 });
});
