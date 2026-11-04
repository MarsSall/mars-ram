// Listener policy and orchestration; platform I/O lives behind these ports.
export type Listener = { port: number; address: string; process: string | null; pid: number | null; cwd: string | null; owned: boolean };
export type Server = Omit<Listener, 'owned'> & { scope: 'loopback' | 'all' | 'other'; web: boolean };
export type ServersResult = { version: 1; servers: Server[]; truncated: boolean } | { version: 1; ok: false; code: 'SERVERS_FAILED'; message: string };
export type ServersPorts = {
 listeners(signal: AbortSignal): Promise<Listener[]>;
 excludedPorts(signal: AbortSignal): Promise<number[]>;
 probe(address: string, port: number, signal: AbortSignal): Promise<boolean>;
};
export const serversFailure = (): ServersResult => ({ version: 1, ok: false, code: 'SERVERS_FAILED', message: 'Servers could not be listed.' });
export function scopeOf(address: string): Server['scope'] {
 if (address === '::1' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(address)) return 'loopback';
 return address === '0.0.0.0' || address === '::' ? 'all' : 'other';
}
/** An IPv4-mapped IPv6 address (::ffff:a.b.c.d) is reached as its IPv4 address. */
export const normalizeAddress = (address: string): string => /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1] ?? address;
const preference = (address: string) => {
 const rank = ['127.0.0.1', '::1', '0.0.0.0', '::'].indexOf(address);
 return rank < 0 ? scopeOf(address) === 'loopback' ? 4 : 5 : rank;
};
const clean = (value: string | null, max: number) => value === null ? null : value.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, max);
export async function runServers(args: string[], ports: ServersPorts, signal: AbortSignal): Promise<ServersResult> {
 try {
  if (args.length !== 1 || args[0] !== 'list') return serversFailure();
  const [listeners, excluded] = await Promise.all([ports.listeners(signal), ports.excludedPorts(signal)]);
  signal.throwIfAborted();
  const hidden = new Set(excluded); const merged = new Map<number, Listener>();
  // Resolve equal-address ties by pid too, so /proc enumeration order cannot change the output.
  for (const row of listeners.map(row => ({ ...row, address: normalizeAddress(row.address) })).filter(row => row.owned && Number.isInteger(row.port) && row.port > 0 && row.port <= 65535 && !hidden.has(row.port)).sort((a, b) => preference(a.address) - preference(b.address) || a.address.localeCompare(b.address) || (a.pid ?? 0) - (b.pid ?? 0))) {
   if (!merged.has(row.port)) merged.set(row.port, row);
  }
  const rows = [...merged.values()].sort((a, b) => a.port - b.port);
  const servers: Server[] = rows.slice(0, 64).map(row => ({ port: row.port, address: row.address, scope: scopeOf(row.address), process: clean(row.process, 256), pid: row.pid, cwd: clean(row.cwd, 4096), web: false }));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, servers.length) }, async () => {
   while (next < servers.length && !signal.aborted) {
    const server = servers[next++]!;
    if (server.scope === 'other') continue;
    try { server.web = await ports.probe(server.address, server.port, signal); } catch { /* Optional, unreachable or aborted HTTP probe. */ }
   }
  }));
  return { version: 1, servers, truncated: rows.length > 64 };
 } catch { return serversFailure(); }
}
