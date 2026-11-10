import { describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { createServer, type Socket } from 'node:net';
import { runServers, type Listener, type ServersPorts } from '../../src/core/servers.ts';
import { probeWeb, linuxListeners, windowsListeners, excludedPorts } from '../../src/adapters/servers.ts';
import { serversCommand } from '../../src/servers-command.ts';
import { parseArguments } from '../../src/arguments.ts';

const row = (port: number, address = '127.0.0.1', owned = true): Listener => ({ port, address, owned, process: 'node', pid: 42, cwd: '/project' });
function fake(rows: Listener[], excluded: number[] = []): ServersPorts {
 return { listeners: async () => rows, excludedPorts: async () => excluded, probe: async () => false };
}
const signal = () => new AbortController().signal;
describe('servers public core', () => {
 it('merges v4/v6, classifies scope, excludes internal and other-user listeners, and sorts', async () => {
  const ports = fake([row(4000, '::'), row(4000), row(3000, '::1'), row(2000, '0.0.0.0'), row(1000, '100.64.1.2'), row(5000, '127.4.3.2'), row(6000), row(7000), row(8000, '::', false)], [6000, 7000]);
  const result = await runServers(['list'], ports, signal());
  expect(result).toEqual({ version: 1, truncated: false, servers: [
   { ...row(1000, '100.64.1.2'), owned: undefined, scope: 'other', web: false },
   { ...row(2000, '0.0.0.0'), owned: undefined, scope: 'all', web: false },
   { ...row(3000, '::1'), owned: undefined, scope: 'loopback', web: false },
   { ...row(4000), owned: undefined, scope: 'loopback', web: false },
   { ...row(5000, '127.4.3.2'), owned: undefined, scope: 'loopback', web: false },
  ].map(({ owned, ...value }) => value) });
 });
 it('treats IPv4-mapped IPv6 addresses as their IPv4 address', async () => {
  const probed: string[] = []; const ports = fake([row(17699, '::ffff:127.0.0.1'), row(9000, '::FFFF:0.0.0.0'), row(9100, '::ffff:100.64.1.2')]);
  ports.probe = async address => { probed.push(address); return true; };
  const result = await runServers(['list'], ports, signal());
  expect(result).toMatchObject({ servers: [
   { port: 9000, address: '0.0.0.0', scope: 'all', web: true },
   { port: 9100, address: '100.64.1.2', scope: 'other', web: false },
   { port: 17699, address: '127.0.0.1', scope: 'loopback', web: true },
  ] });
  expect(probed.sort()).toEqual(['0.0.0.0', '127.0.0.1']);
 });
 it('bounds output to 64 sorted ports and probes to eight concurrent calls', async () => {
  const ports = fake(Array.from({ length: 70 }, (_, i) => row(4000 - i)));
  let active = 0; let peak = 0; let calls = 0;
  ports.probe = async () => { calls++; peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 1)); active--; return true; };
  const result = await runServers(['list'], ports, signal());
  expect('servers' in result && result.servers.length).toBe(64);
  expect('truncated' in result && result.truncated).toBe(true);
  expect('servers' in result && result.servers[0]?.port).toBe(3931);
  expect(calls).toBe(64); expect(peak).toBeLessThanOrEqual(8);
 });
 it('never probes specific non-loopback binds', async () => {
  const ports = fake([row(1234, '100.64.1.2')]); ports.probe = async () => { throw Error('must not connect'); };
  expect(await runServers(['list'], ports, signal())).toMatchObject({ servers: [{ web: false }] });
 });
 it('sanitizes discovery failures and invalid verbs', async () => {
  const ports = fake([]); ports.listeners = async () => { throw Error('/private/path'); };
  for (const args of [['list'], ['list', 'extra'], ['focus']]) {
   expect(await runServers(args, ports, signal())).toEqual({ version: 1, ok: false, code: 'SERVERS_FAILED', message: 'Servers could not be listed.' });
  }
 });
 it('routes servers without changing herdr or key parsing', () => {
  expect(parseArguments(['servers', 'list'])).toEqual({ ok: true, command: 'servers', args: ['list'] });
  expect(parseArguments(['herdr', 'list'])).toEqual({ ok: true, command: 'herdr', args: ['list'] });
  expect(parseArguments(['key', 'add', '--key', 'a', '--like', 'b'])).toEqual({ ok: true, command: 'key', action: 'add', key: 'a', like: 'b' });
 });
});
describe('servers command stdout', () => {
 it('bounds a stalled discovery to less than four seconds', async () => {
  vi.useFakeTimers();
  try {
   const ports = fake([]); ports.listeners = () => new Promise(() => {}); let line = '';
   const pending = serversCommand(['list'], { write(chunk, cb) { line += chunk; cb(); } }, ports);
   await vi.advanceTimersByTimeAsync(3750);
   expect(await pending).toBe(1); expect(JSON.parse(line).code).toBe('SERVERS_FAILED');
   expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
 });
 it('aborts in-flight probes and leaves unprobed rows non-web at the global budget', async () => {
  vi.useFakeTimers();
  try {
   const ports = fake(Array.from({ length: 64 }, (_, i) => row(i + 1000)));
   let active = 0;
   ports.probe = (_address, _port, abort) => new Promise(resolve => { active++; abort.addEventListener('abort', () => { active--; resolve(false); }, { once: true }); });
   let line = ''; const pending = serversCommand(['list'], { write(chunk, cb) { line += chunk; cb(); } }, ports);
   await vi.advanceTimersByTimeAsync(3500);
   expect(await pending).toBe(0); expect(active).toBe(0);
   expect(JSON.parse(line).servers).toHaveLength(64); expect(JSON.parse(line).servers.every((row: { web: boolean }) => !row.web)).toBe(true);
  } finally { vi.useRealTimers(); }
 });
 it('waits for stdout acceptance and writes only one line', async () => {
  let line = ''; let release: (() => void) | undefined; let done = false;
  const pending = serversCommand(['list'], { write(chunk, cb) { line += chunk; release = () => cb(); } }, fake([])).then(code => { done = true; return code; });
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(JSON.parse(line)).toEqual({ version: 1, servers: [], truncated: false }); expect(line.split('\n')).toHaveLength(2); expect(done).toBe(false);
  release!(); expect(await pending).toBe(0);
 });
 it('gives up with exit one when stdout never accepts the line', async () => {
  const start = Date.now();
  expect(await serversCommand(['list'], { write() { /* SSH pipe never drains */ } }, fake([]), 50)).toBe(1);
  expect(Date.now() - start).toBeLessThan(1000);
 });
 it('returns exit one with a sanitized JSON error', async () => {
  let line = ''; const ports = fake([]); ports.listeners = async () => { throw Error('secret /path'); };
  expect(await serversCommand(['list'], { write(chunk, cb) { line += chunk; cb(); } }, ports)).toBe(1);
  expect(JSON.parse(line)).toEqual({ version: 1, ok: false, code: 'SERVERS_FAILED', message: 'Servers could not be listed.' });
 });
});
describe('Node entry dispatch regression', () => {
 it.each([
  ['servers', 'wrong-verb', 'SERVERS_FAILED'],
  ['herdr', 'wrong-verb', 'BAD_ID'],
  ['key', 'add', 'KEY_CHANGE_FAILED'],
 ])('%s keeps its command handler', async (command, verb, code) => {
  const flags = command === 'key' ? ['--key', 'invalid', '--like', 'invalid'] : [];
  const result = await promisify(execFile)(process.execPath, [join(import.meta.dirname, '../../src/main.ts'), command!, verb!, ...flags], { timeout: 5000 }).catch((error: { code: number; stdout: string; stderr: string }) => error);
  expect(result).toMatchObject({ code: 1 });
  if (command === 'key') {
   expect(result.stdout).toBe(''); expect(result.stderr).toMatch(/^Key change failed: Invalid public key:/);
  } else { expect(JSON.parse(result.stdout).code).toBe(code); expect(result.stderr).toBe(''); }
 });
});
describe('real loopback HTTP probe', () => {
 for (const mode of ['http', 'other', 'malformed', 'timeout'] as const) it(mode, async () => {
  const sockets = new Set<Socket>(); let request = '';
  const server = createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('data', bytes => { request += bytes.toString(); if (mode === 'http') { socket.write('HTTP/1.'); setTimeout(() => socket.end('1 200 OK\r\n\r\n'), 5); } else if (mode === 'other') socket.end('SSH-2.0-test\r\n'); else if (mode === 'malformed') socket.end('HTTP/1.1 200NOT-HTTP\r\n'); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error();
  const start = Date.now();
  try {
   expect(await probeWeb('127.0.0.1', address.port, signal())).toBe(mode === 'http');
   expect(Date.now() - start).toBeLessThan(1100);
   expect(request).toBe(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${address.port}\r\nConnection: close\r\n\r\n`);
  } finally { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); }
 });
});
describe('IPv6 wildcard probe destination', () => {
 it('probes an IPv6 wildcard listener on ::1, where the phone tunnel opens it', async () => {
  let request = '';
  const server = createServer(socket => socket.on('data', bytes => { request += bytes.toString(); socket.end('HTTP/1.1 200 OK\r\n\r\n'); }));
  await new Promise<void>(resolve => server.listen({ port: 0, host: '::', ipv6Only: true }, resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error();
  try {
   expect(await probeWeb('::', address.port, signal())).toBe(true);
   expect(request).toBe(`GET / HTTP/1.1\r\nHost: [::1]:${address.port}\r\nConnection: close\r\n\r\n`);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
 });
 it('probes a dual-stack wildcard listener on ::1 too, never on 127.0.0.1', async () => {
  let request = '';
  const server = createServer(socket => socket.on('data', bytes => { request += bytes.toString(); socket.end('HTTP/1.1 200 OK\r\n\r\n'); }));
  await new Promise<void>(resolve => server.listen({ port: 0, host: '::' }, resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error();
  try {
   expect(await probeWeb('::', address.port, signal())).toBe(true);
   expect(request).toContain(`Host: [::1]:${address.port}`);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
 });
});
describe('OS adapters with fake I/O', () => {
 it('maps proc LISTEN inodes only to the current uid, decoding IPv4 and IPv6', async () => {
  const files: Record<string, string> = {
   '/proc/net/tcp': 'header\n 0: 0100007F:0BB8 00000000:0000 0A 0:0 0:0 0 10 0 123\n 1: 00000000:0FA0 00000000:0000 01 0:0 0:0 0 10 0 456\n 2: 00000000:1388 00000000:0000 0A 0:0 0:0 0 11 0 789',
   '/proc/net/tcp6': 'header\n 0: 00000000000000000000000001000000:0BB8 00000000000000000000000000000000:0000 0A 0:0 0:0 0 10 0 124',
   '/proc/42/comm': 'node\n',
  };
  const rows = await linuxListeners(signal(), { uid: 10, read: async path => { if (!(path in files)) throw Error(); return files[path]!; }, list: async path => path === '/proc' ? ['42', '43'] : ['0', '1'], uidOf: async path => path === '/proc/42' ? 10 : 11, link: async path => path.endsWith('/cwd') ? '/project' : path.endsWith('/0') ? 'socket:[123]' : 'socket:[124]' });
  expect(rows).toEqual([row(3000), row(3000, '::1')]);
 });
 it('names a Linux process by its executable, not its truncated thread name', async () => {
  const files: Record<string, string> = {
   '/proc/net/tcp': 'header',
   '/proc/net/tcp6': 'header\n 0: 0000000000000000FFFF00000100007F:4523 00000000000000000000000000000000:0000 0A 0:0 0:0 0 10 0 125',
   '/proc/42/comm': 'node-MainThread\n',
   '/proc/42/cmdline': '/home/alex/.volta/tools/image/node/22.1.0/bin/node\0/project/node_modules/.bin/vite\0',
  };
  const rows = await linuxListeners(signal(), { uid: 10, read: async path => { if (!(path in files)) throw Error(); return files[path]!; }, list: async path => path === '/proc' ? ['42'] : ['0'], uidOf: async () => 10, link: async path => path.endsWith('/cwd') ? '/project' : 'socket:[125]' });
  expect(rows).toEqual([{ ...row(17699, '127.0.0.1'), process: 'node' }]);
 });
 it('executes only fixed PowerShell argv and accepts only owner-confirmed rows', async () => {
  const rows = await windowsListeners(signal(), async (file, args, options) => {
   expect(file).toBe('powershell.exe'); expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand']); expect(args).toHaveLength(4); expect(args[3]).toMatch(/^[A-Za-z0-9+/]+=*$/); const script = Buffer.from(args[3]!, 'base64').toString('utf16le'); expect(script).toContain('[DllImport("kernel32.dll")]'); expect(script).toContain('GetExtendedTcpTable'); expect(script).toContain('OpenProcessToken'); expect(script.indexOf('[MrTcp]::Listeners()')).toBeLessThan(script.indexOf('[MrOwner]::Sid')); expect(script).toContain('StartTime'); expect(script).not.toContain('Get-CimInstance'); expect(script).not.toContain('Get-NetTCPConnection'); expect(script.split('[MrTcp]::Listeners()')).toHaveLength(2); expect(options.shell).toBe(false); expect(options.timeout).toBeLessThan(4000);
   return JSON.stringify([row(3000), row(4000, '::', false)]);
  });
  expect(rows).toEqual([{ ...row(3000), cwd: null }]);
 });
 it('decodes bridge registry and link pid record ports without exposing their contents', async () => {
  const result = await excludedPorts(signal(), '/home/test', {
   list: async () => ['bridge.json', 'bad.json'],
   read: async path => path.endsWith('bridge.json') ? JSON.stringify({ protocolVersion: '1.4', bridgeInstanceId: 'test', sessionId: 'test', pid: 42, port: 3210, token: 'a'.repeat(43), cwd: '/project', startedAt: 1793145600000 }) : path.endsWith('server.pid.json') ? '{"port":47811}' : '{}',
  });
  expect(result).toEqual([3210, 47811]);
 });
 it('also excludes the link server of a ZeroTier-only computer', async () => {
  const missing = () => Promise.reject(Object.assign(Error('missing'), { code: 'ENOENT' }));
  const result = await excludedPorts(signal(), '/home/test', {
   list: async path => path.endsWith('links') ? ['server-zerotier-10.147.20.49.pid.json', 'server-zerotier-x.pid.json', 'other.json'] : [],
   read: async path => path.endsWith('server-zerotier-10.147.20.49.pid.json') ? '{"port":47811}' : missing(),
  });
  expect(result).toEqual([47811]);
 });
});
