import type { SavedHost } from "./host-catalog";
import type { HostConnections } from "./host-connections";
import type { HostConnection } from "./ports";
import type { KeyCommandConfig } from "./key-security";
import { buildHerdrCommand } from "./herdr-switcher";
import { readHostRecord } from "./host-record";

export type Server = { port: number; address: string; scope: "loopback" | "all" | "other"; process: string | null; pid: number | null; cwd: string | null; web: boolean };
export type ServersSnapshot = { servers: Server[]; truncated: boolean };
export type ServersResult = { ok: true; value: ServersSnapshot } | { ok: false; code: "CLI_MISSING" | "SERVERS_FAILED" };
export type ServersEntry = { state: "loading" } | { state: "error"; code: "CLI_MISSING" | "SERVERS_FAILED" } | ({ state: "ok"; refreshError?: boolean } & ServersSnapshot);
export function beginServersRefresh(previous?: ServersEntry): ServersEntry { return previous?.state === "ok" ? previous : { state: "loading" }; }
export function finishServersRefresh(previous: ServersEntry | undefined, result: ServersResult): ServersEntry {
 if (result.ok) return { state: "ok", ...result.value };
 return previous?.state === "ok" ? { ...previous, refreshError: true } : { state: "error", code: result.code };
}
// Reuse precisely the existing platform-specific path validation and quoting.
export function buildServersCommand(record: KeyCommandConfig): string { return buildHerdrCommand(record, "list").replace(/ herdr list$/, " servers list"); }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max && !/[\x00-\x1f\x7f-\x9f]/.test(v);
function addressScope(address: string): Server["scope"] {
 if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address) && address.split(".").every(n => Number(n) <= 255 && String(Number(n)) === n)) {
  return address === "0.0.0.0" ? "all" : address.startsWith("127.") ? "loopback" : "other";
 }
 if (!/^[a-fA-F0-9:]+$/.test(address) || !address.includes(":")) throw Error("Invalid address");
 let normalized: string;
 try { normalized = new URL(`http://[${address}]/`).hostname; } catch { throw Error("Invalid address"); }
 return normalized === "[::]" ? "all" : normalized === "[::1]" ? "loopback" : "other";
}
export function parseServersList(stdout: string): ServersSnapshot {
 if (stdout.length > 1_048_576) throw Error("Servers output too large");
 const data: unknown = JSON.parse(stdout);
 if (!object(data) || data.version !== 1 || typeof data.truncated !== "boolean" || !Array.isArray(data.servers) || data.servers.length > 64 || Object.keys(data).some(k => !["version", "servers", "truncated"].includes(k))) throw Error("Invalid servers contract");
 let last = 0;
 const servers = data.servers.map((v: unknown): Server => {
  if (!object(v) || typeof v.port !== "number" || !Number.isInteger(v.port) || v.port <= last || v.port > 65535 || !text(v.address, 64) || !["loopback", "all", "other"].includes(v.scope as string) || addressScope(v.address) !== v.scope || !(v.process === null || text(v.process, 512)) || !(v.cwd === null || text(v.cwd, 4096)) || !(v.pid === null || (typeof v.pid === "number" && Number.isSafeInteger(v.pid) && v.pid > 0 && v.pid <= 4294967295)) || typeof v.web !== "boolean" || Object.keys(v).some(k => !["port", "address", "scope", "process", "pid", "cwd", "web"].includes(k))) throw Error("Invalid server row");
  last = v.port;
  return { port: v.port, address: v.address, scope: v.scope as Server["scope"], process: v.process as string | null, cwd: v.cwd as string | null, pid: v.pid as number | null, web: v.web };
 });
 return { servers, truncated: data.truncated };
}
export const serverOpenable = (server: Server): boolean => server.scope !== "other" && server.web;
// Same destination the host probed (host/cli loopbackFor): ::1 for IPv6 listeners,
// wildcard included, since an IPv6-only `::` socket refuses 127.0.0.1.
export const serverRemoteHost = (server: Server): "127.0.0.1" | "::1" => server.address === "::1" || server.address === "::" ? "::1" : "127.0.0.1";
export class Servers {
 constructor(private readonly deps: { host: Pick<HostConnection, "readFile" | "exec">; connections: Pick<HostConnections, "connection"> }) {}
 async list(computer: SavedHost): Promise<ServersResult> {
  try {
   const connection = await this.deps.connections.connection(computer);
   if (!connection.ok) return { ok: false, code: "SERVERS_FAILED" };
   const record = await readHostRecord(this.deps.host, connection.connectionId);
   let command: string;
   try { command = buildServersCommand(record as KeyCommandConfig); } catch { return { ok: false, code: "CLI_MISSING" }; }
   const result = await this.deps.host.exec(connection.connectionId, command);
   if (!result.ok) return { ok: false, code: "SERVERS_FAILED" };
   if (result.exitStatus !== 0) return { ok: false, code: result.exitStatus === 127 || result.exitStatus === 9009 ? "CLI_MISSING" : "SERVERS_FAILED" };
   return { ok: true, value: parseServersList(result.stdout) };
  } catch { return { ok: false, code: "SERVERS_FAILED" }; }
 }
}
/** Only top-level navigation is gated here; served scripts remain untrusted web content. */
export function serverNavigation(url: string, localPort: number): "allow" | "external" | "block" {
 try {
  const parsed = new URL(url);
  if (parsed.username || parsed.password) return "block";
  if (parsed.protocol === "http:" && parsed.hostname === "127.0.0.1" && parsed.port === String(localPort) && url.startsWith(`http://127.0.0.1:${localPort}/`)) return "allow";
  return parsed.protocol === "https:" ? "external" : "block";
 } catch { return "block"; }
}
/** One viewer owns one forward. Generation invalidates opens racing close/unmount. */
export class ServerTunnel {
 private generation = 0;
 private owned: { forwardId: string; connectionId: string } | null = null;
 constructor(private readonly deps: { host: Pick<HostConnection, "forwardLocal" | "closeForward" | "isConnected">; connections: Pick<HostConnections, "connection"> }) {}
 async open(computer: SavedHost, server: Server): Promise<{ ok: true; localPort: number } | { ok: false }> {
  const closing = this.close(); const generation = this.generation; await closing;
  try {
   if (!serverOpenable(server)) return { ok: false };
   const connection = await this.deps.connections.connection(computer);
   if (!connection.ok || generation !== this.generation) return { ok: false };
   const result = await this.deps.host.forwardLocal(connection.connectionId, server.port, serverRemoteHost(server));
   if (!result.ok) return { ok: false };
   if (generation !== this.generation || !this.deps.host.isConnected(connection.connectionId)) { await this.deps.host.closeForward(result.forwardId); return { ok: false }; }
   this.owned = { forwardId: result.forwardId, connectionId: connection.connectionId };
   return { ok: true, localPort: result.localPort };
  } catch { return { ok: false }; }
 }
 connected(): boolean { return !!this.owned && this.deps.host.isConnected(this.owned.connectionId); }
 async close(): Promise<void> {
  ++this.generation; const owned = this.owned; this.owned = null;
  if (owned) await this.deps.host.closeForward(owned.forwardId);
 }
}
