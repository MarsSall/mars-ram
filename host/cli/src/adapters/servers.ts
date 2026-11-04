import { constants } from 'node:fs';
import { open, readdir, readlink, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { APP_ID, REGISTRY_DIRECTORY, decodeRegistryEntry } from '@workspace/protocol';
import type { Listener, ServersPorts } from '../core/servers.ts';
import type { ProcessRunner } from '../core/herdr-switcher.ts';
import { runProcess } from './herdr-switcher.ts';

type Files = { read(path: string): Promise<string>; list(path: string): Promise<string[]> };
async function readBounded(path: string): Promise<string> {
 // Registry records must be regular files, not symlinks into arbitrary host files.
 const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
 try {
  if (!(await file.stat()).isFile()) throw Error('Not a regular file.');
  const buffer = Buffer.alloc(1024 * 1024 + 1); let size = 0;
  while (size < buffer.length) { const { bytesRead } = await file.read(buffer, size, buffer.length - size, null); if (!bytesRead) break; size += bytesRead; }
  if (size === buffer.length) throw Error('Read bound exceeded.');
  return buffer.subarray(0, size).toString('utf8');
 } finally { await file.close(); }
}
const files: Files = { read: readBounded, list: readdir };
type ProcIO = Files & { uid: number; uidOf(path: string): Promise<number>; link(path: string): Promise<string> };
function procAddress(hex: string): string {
 const bytes = Buffer.from(hex, 'hex');
 for (let i = 0; i < bytes.length; i += 4) bytes.subarray(i, i + 4).reverse();
 if (bytes.length === 4) return [...bytes].join('.');
 // IPv4-mapped (::ffff:a.b.c.d): report the IPv4 address the socket accepts.
 if (bytes.subarray(0, 10).every(byte => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) return [...bytes.subarray(12)].join('.');
 const groups = Array.from({ length: 8 }, (_, i) => bytes.readUInt16BE(i * 2).toString(16));
 let start = -1; let length = 1;
 for (let i = 0; i < 8; i++) { let end = i; while (end < 8 && groups[end] === '0') end++; if (end - i > length) { start = i; length = end - i; } }
 return start < 0 ? groups.join(':') : `${groups.slice(0, start).join(':')}::${groups.slice(start + length).join(':')}`;
}
export async function linuxListeners(signal: AbortSignal, io: ProcIO = { ...files, uid: process.getuid!(), uidOf: async path => (await stat(path)).uid, link: readlink }): Promise<Listener[]> {
 const sockets = new Map<string, { address: string; port: number }>();
 for (const name of ['tcp', 'tcp6']) {
  let text: string;
  try { text = await io.read(`/proc/net/${name}`); }
  catch (error) { if (name === 'tcp6' && (error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
  for (const line of text.split('\n').slice(1)) {
   const fields = line.trim().split(/\s+/); const [address, port] = (fields[1] ?? '').split(':');
   if (fields[3] !== '0A' || Number(fields[7]) !== io.uid || !address || !/^(?:[A-Fa-f0-9]{8}|[A-Fa-f0-9]{32})$/.test(address) || !port || !/^[A-Fa-f0-9]{4}$/.test(port) || !/^\d+$/.test(fields[9] ?? '')) continue;
   sockets.set(fields[9]!, { address: procAddress(address), port: parseInt(port, 16) });
  }
 }
 const pids = (await io.list('/proc')).filter(name => /^\d+$/.test(name));
 const rows: Listener[] = []; let next = 0;
 await Promise.all(Array.from({ length: Math.min(16, pids.length) }, async () => {
  while (next < pids.length) {
   signal.throwIfAborted();
   const pid = pids[next++]!; const root = `/proc/${pid}`;
   try {
    if (await io.uidOf(root) !== io.uid) continue;
    const matches = new Set<string>();
    for (const fd of await io.list(`${root}/fd`)) {
     signal.throwIfAborted();
     try { const match = /^socket:\[(\d+)\]$/.exec(await io.link(`${root}/fd/${fd}`)); if (match && sockets.has(match[1]!)) matches.add(match[1]!); } catch { /* Descriptor closed or inaccessible. */ }
    }
    if (!matches.size) continue;
    // comm holds the main thread name (Node: "node-MainThread"); prefer the executable's file name.
    const executable = await io.read(`${root}/cmdline`).then(text => text.split('\0')[0]?.split('/').at(-1) || null, () => null);
    const processName = executable ?? await io.read(`${root}/comm`).catch(() => null);
    const cwd = await io.link(`${root}/cwd`).catch(() => null);
    // Fail closed if the process changed owner while enumerating its descriptors.
    if (await io.uidOf(root) !== io.uid) continue;
    for (const inode of matches) rows.push({ ...sockets.get(inode)!, owned: true, process: processName?.trim() ?? null, pid: Number(pid), cwd });
   } catch { /* Processes exit or deny access during a snapshot. */ }
  }
 }));
 signal.throwIfAborted();
 return rows;
}
// Fixed script, never interpolates arguments, paths or process names. Ownership is
// best effort: access failures/races drop the process, never broaden the list.
// Listeners are snapshotted first; a listener is kept only when its process started
// before that snapshot and its token's user SID is the current user's: a live pid
// that existed before the snapshot is the process that held the listener, so a pid
// reused by another account afterwards is dropped. Listeners come from the IP Helper
// table (GetExtendedTcpTable, milliseconds) rather than Get-NetTCPConnection, whose
// CIM module costs over a second; the owner comes from the process token
// (OpenProcessToken), since CIM GetOwnerSid costs ~80 ms per process. A Windows
// process's cwd is not reliably available via these APIs; report null.
const WINDOWS_SCRIPT = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Net; using System.Runtime.InteropServices; using System.Security.Principal;
public static class MrOwner {
 [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int id);
 [DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 public static string Sid(int id) {
  IntPtr process = OpenProcess(0x1000, false, id);
  if (process == IntPtr.Zero) return null;
  try {
   IntPtr token;
   if (!OpenProcessToken(process, 0x8, out token)) return null;
   try { using (WindowsIdentity identity = new WindowsIdentity(token)) return identity.User.Value; } finally { CloseHandle(token); }
  } finally { CloseHandle(process); }
 }
}
public class MrListener { public int Port; public string Address; public int Pid; }
public static class MrTcp {
 [DllImport("iphlpapi.dll")] static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool sorted, int family, int tableClass, uint reserved);
 // TCP_TABLE_OWNER_PID_LISTENER rows after a 4-byte count. IPv4 (24 bytes): state,
 // address, port, remote address, remote port, pid. IPv6 (56 bytes): address[16],
 // scope, port, remote address[16], remote scope, remote port, state, pid.
 public static List<MrListener> Listeners() {
  List<MrListener> rows = new List<MrListener>();
  foreach (int family in new int[] { 2, 23 }) {
   bool v4 = family == 2; int stride = v4 ? 24 : 56; int size = 0;
   GetExtendedTcpTable(IntPtr.Zero, ref size, false, family, 3, 0);
   for (int attempt = 0; ; attempt++) {
    size += 4096; IntPtr table = Marshal.AllocHGlobal(size);
    try {
     uint result = GetExtendedTcpTable(table, ref size, false, family, 3, 0);
     if (result == 122 && attempt < 3) continue;
     if (result != 0) throw new InvalidOperationException("TCP table unavailable.");
     int count = Marshal.ReadInt32(table);
     if (count < 0 || 4L + (long)count * stride > size) throw new InvalidOperationException("Invalid TCP table.");
     for (int i = 0; i < count; i++) {
      IntPtr row = IntPtr.Add(table, 4 + i * stride);
      if (Marshal.ReadInt32(row, v4 ? 0 : 48) != 2) continue;
      byte[] address = new byte[v4 ? 4 : 16]; Marshal.Copy(IntPtr.Add(row, v4 ? 4 : 0), address, 0, address.Length);
      int port = v4 ? 8 : 20;
      MrListener listener = new MrListener();
      listener.Port = (Marshal.ReadByte(row, port) << 8) | Marshal.ReadByte(row, port + 1);
      listener.Address = new IPAddress(address).ToString();
      listener.Pid = Marshal.ReadInt32(row, v4 ? 20 : 52);
      rows.Add(listener);
     }
     break;
    } finally { Marshal.FreeHGlobal(table); }
   }
  }
  return rows;
 }
}
'@
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$before = Get-Date
$listeners = @([MrTcp]::Listeners())
$ids = @($listeners | ForEach-Object { $_.Pid } | Sort-Object -Unique)
$owners = @{}
if ($ids.Count) {
 foreach ($process in @(Get-Process -Id $ids -ErrorAction SilentlyContinue)) {
  try {
   if ($process.StartTime -lt $before -and [MrOwner]::Sid([int]$process.Id) -eq $sid) { $owners[[int]$process.Id] = $process.ProcessName }
  } catch {}
 }
}
$rows = @($listeners | ForEach-Object {
 $id = $_.Pid
 if ($owners.ContainsKey($id)) {
  [PSCustomObject]@{ port = $_.Port; address = $_.Address; process = $owners[$id]; pid = $id; cwd = $null; owned = $true }
 }
})
ConvertTo-Json -InputObject $rows -Compress`;
// -EncodedCommand (UTF-16LE base64) keeps the script's double quotes intact; Windows
// command-line quoting would strip them from a -Command argument.
const ENCODED_WINDOWS_SCRIPT = Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64');
export async function windowsListeners(signal: AbortSignal, run: ProcessRunner = runProcess): Promise<Listener[]> {
 signal.throwIfAborted();
 const text = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_WINDOWS_SCRIPT], { shell: false, encoding: 'utf8', timeout: 2500, maxBuffer: 1024 * 1024 });
 signal.throwIfAborted();
 const rows: unknown = JSON.parse(text);
 if (!Array.isArray(rows)) throw Error('Invalid listener snapshot.');
 return rows.filter((row): row is Listener => !!row && typeof row === 'object' && row.owned === true && Number.isInteger(row.port) && row.port > 0 && row.port <= 65535 && typeof row.address === 'string' && row.address.length <= 64 && typeof row.process === 'string' && Number.isSafeInteger(row.pid) && row.pid > 0).map(row => ({ ...row, cwd: null }));
}
export async function excludedPorts(signal: AbortSignal, home = homedir(), io: Files = files): Promise<number[]> {
 const ports: number[] = [];
 const directory = join(home, REGISTRY_DIRECTORY);
 let names: string[];
 try { names = await io.list(directory); }
 catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; names = []; }
 for (const name of names.filter(name => name.endsWith('.json'))) {
  signal.throwIfAborted();
  try { const decoded = decodeRegistryEntry(JSON.parse(await io.read(join(directory, name)))); if (decoded.ok) ports.push(decoded.value.port); }
  catch { /* Stale, invalid or concurrently removed registry entry. */ }
 }
 try {
  const record: unknown = JSON.parse(await io.read(join(home, `.${APP_ID}`, 'links', 'server.pid.json')));
  if (record && typeof record === 'object' && 'port' in record && typeof record.port === 'number' && Number.isInteger(record.port) && record.port > 0 && record.port <= 65535) ports.push(record.port);
 } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
 return ports;
}
function probeAddress(host: string, port: number, signal: AbortSignal, milliseconds: number): Promise<boolean> {
 if (signal.aborted || milliseconds <= 0) return Promise.resolve(false);
 return new Promise(resolve => {
  const socket = createConnection({ host, port }); let prefix = ''; let settled = false;
  const finish = (value: boolean) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); socket.destroy(); resolve(value); };
  const abort = () => finish(false);
  const timer = setTimeout(abort, milliseconds);
  signal.addEventListener('abort', abort, { once: true });
  socket.once('connect', () => socket.write(`GET / HTTP/1.1\r\nHost: ${host.includes(':') ? `[${host}]` : host}:${port}\r\nConnection: close\r\n\r\n`));
  socket.on('data', bytes => {
   prefix += Buffer.from(bytes).subarray(0, 16 - prefix.length).toString('latin1');
   // A whole status line start: version, a 1xx–5xx code, then a space or the line end.
   if (/^HTTP\/1\.[01] [1-5]\d\d[ \r]/.test(prefix)) finish(true);
   else if (prefix.length >= 13) finish(false);
  });
  socket.once('error', abort); socket.once('end', abort); socket.once('close', abort);
 });
}
/** Probe the same loopback the phone's tunnel opens (apps/mobile serverRemoteHost):
 * ::1 for IPv6 listeners, wildcard included (an IPv6-only `::` socket refuses
 * 127.0.0.1, and every `::` socket accepts ::1); 127.0.0.1 otherwise. */
export const loopbackFor = (address: string): '127.0.0.1' | '::1' => address === '::1' || address === '::' ? '::1' : '127.0.0.1';
export function probeWeb(address: string, port: number, signal: AbortSignal): Promise<boolean> {
 return probeAddress(loopbackFor(address), port, signal, 750);
}
export function createServersPorts(): ServersPorts {
 return { listeners: signal => process.platform === 'linux' ? linuxListeners(signal) : process.platform === 'win32' ? windowsListeners(signal) : Promise.reject(Error('Unsupported platform.')), excludedPorts, probe: probeWeb };
}
