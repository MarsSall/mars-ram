import { describe, it, expect } from 'vitest';
import { runNotify, registrationAddress } from '../../src/core/notify.ts';
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
  const ports = { address: () => '100.64.1.2', hostKeyId: () => 'SHA256:host', readInput: async () => JSON.stringify({ secret, port: 47812 }), store: { put: async (r: any) => { rows.set(r.address, r); }, remove: async (address: string) => { rows.delete(address); }, get: async (address: string) => rows.get(address) ?? null }, ensure: async () => {} };
  expect(await runNotify(['register', '--json'], ports)).toEqual({ v: 1, ok: true, hostKeyId: 'SHA256:host', port: 47812 });
  expect(JSON.stringify(await runNotify(['status', '--json'], ports))).not.toContain(secret);
  expect(await runNotify(['unregister'], ports)).toEqual({ v: 1, ok: true });
  expect(rows.size).toBe(0);
 });
 it('rejects unknown fields, invalid ports and secret argv before persistence', async () => {
  let writes = 0;
  for (const input of [{ secret, port: 0 }, { secret, port: 65536 }, { secret: 'bad', port: 1 }, { secret, port: 1, address: '100.64.1.3' }]) {
   const ports = { address: () => '100.64.1.2', hostKeyId: () => 'host', readInput: async () => JSON.stringify(input), store: { put: async () => { writes++; }, remove: async () => {}, get: async () => null }, ensure: async () => {} };
   expect((await runNotify(['register', '--json'], ports)).ok).toBe(false);
   expect((await runNotify(['register', '--secret', secret], ports)).ok).toBe(false);
  }
  expect(writes).toBe(0);
 });
});
