// R1/R2: best-effort compatibility checks; never change a connection or block an operation.
import type { SavedHost } from './host-catalog';
import type { HostConnections } from './host-connections';
import type { HostConnection } from './ports';
import { readHostRecord } from './host-record';
import { buildVersionCommand, compareSemver, hostUpdate, parseHostVersion, type HostUpdate } from './host-update';
export const DAY_MS = 86_400_000;
export const HOST_VERSION_REFRESH_MS = 10_000; // Same floor as the existing sessions refresh.
export type ReleaseCacheEntry = { checkedAt: number; latest?: string };
export interface HostReleaseRegistry { latest(): Promise<unknown> }
export interface HostReleaseCache { read(): Promise<ReleaseCacheEntry | undefined>; write(value: ReleaseCacheEntry): Promise<void> }
export function parseReleaseCache(text: string): ReleaseCacheEntry | undefined {
 if (text.length > 1024) return undefined;
 try {
  const v = JSON.parse(text);
  if (!v || v.version !== 1 || !Number.isSafeInteger(v.checkedAt) || v.checkedAt < 0 || (v.latest !== undefined && (typeof v.latest !== 'string' || compareSemver(v.latest, v.latest) !== 0))) return undefined;
  return { checkedAt: v.checkedAt, ...(v.latest === undefined ? {} : { latest: v.latest }) };
 } catch { return undefined; }
}
export class LatestHostRelease {
 private running?: Promise<string | undefined>;
 private loaded = false;
 private entry?: ReleaseCacheEntry;
 constructor(private readonly deps: { registry: HostReleaseRegistry; cache: HostReleaseCache; clock: () => number }) {}
 get(): Promise<string | undefined> {
  this.running ??= this.read().finally(() => { this.running = undefined; });
  return this.running;
 }
 private async read(): Promise<string | undefined> {
  try {
   if (!this.loaded) { this.entry = await this.deps.cache.read(); this.loaded = true; }
   const now = this.deps.clock();
   if (this.entry && now - this.entry.checkedAt < DAY_MS) return this.entry.latest;
   this.entry = { checkedAt: now, ...(this.entry?.latest ? { latest: this.entry.latest } : {}) };
   // Persist the attempt BEFORE requesting: offline and failures count toward the daily budget.
   // If storage cannot record the attempt, do not make a request that would repeat on reopening.
   await this.deps.cache.write(this.entry);
   try {
    const latest = await this.deps.registry.latest();
    if (typeof latest === 'string' && compareSemver(latest, latest) === 0) {
     this.entry = { checkedAt: now, latest };
     await this.deps.cache.write(this.entry);
    }
   } catch { /* Optional metadata; no error UI, logs or retries today. */ }
   return this.entry.latest;
  } catch { return this.entry?.latest; }
 }
}
type Probe = { connectionId: string; checkedAt: number; release: string };
type UpdateDeps = { latest: LatestHostRelease; clock: () => number; connections: Pick<HostConnections, 'connection'>; host: Pick<HostConnection, 'readFile' | 'exec'> };
export class HostUpdates {
 private readonly probes = new Map<string, Probe>();
 private readonly pending = new Map<string, { connectionId: string; result: Promise<string> }>();
 private readonly statuses = new Map<string, HostUpdate>();
 private retained?: Set<string>;
 constructor(private readonly deps: UpdateDeps) {}
 cached(id: string): HostUpdate | undefined { return this.statuses.get(id); }
 retain(ids: string[]): void {
  this.retained = new Set(ids);
  for (const map of [this.probes, this.statuses]) for (const id of map.keys()) if (!this.retained.has(id)) map.delete(id);
 }
 /** Called for every fresh shared SSH connection, without opening another one. */
 async connected(id: string, connectionId: string): Promise<void> {
  const [release, latest] = await Promise.all([this.probe(id, connectionId), this.deps.latest.get()]);
  if (this.probes.get(id)?.connectionId === connectionId && (!this.retained || this.retained.has(id))) this.statuses.set(id, hostUpdate(release, latest));
 }
 /** Cached statuses now; fresh checks run in the background so session lists never wait for them. */
 snapshot(computers: readonly SavedHost[]): Record<string, HostUpdate> {
  for (const computer of computers) void this.check(computer);
  const result: Record<string, HostUpdate> = {};
  for (const computer of computers) { const value = this.cached(computer.id); if (value) result[computer.id] = value; }
  return result;
 }
 async check(computer: SavedHost): Promise<HostUpdate> {
  try {
   const connection = await this.deps.connections.connection(computer);
   if (!connection.ok) return this.cached(computer.id) ?? hostUpdate('unknown');
   const [release, latest] = await Promise.all([this.probe(computer.id, connection.connectionId), this.deps.latest.get()]);
   // A slow response from an already replaced connection cannot update the UI or cache.
   if (this.probes.get(computer.id)?.connectionId !== connection.connectionId) return this.cached(computer.id) ?? hostUpdate('unknown');
   const value = hostUpdate(release, latest);
   if (!this.retained || this.retained.has(computer.id)) this.statuses.set(computer.id, value);
   return value;
  } catch { return this.cached(computer.id) ?? hostUpdate('unknown'); }
 }
 private probe(id: string, connectionId: string): Promise<string> {
  const pending = this.pending.get(id);
  if (pending?.connectionId === connectionId) return pending.result;
  const old = this.probes.get(id), now = this.deps.clock();
  if (old?.connectionId === connectionId && now - old.checkedAt < HOST_VERSION_REFRESH_MS) return Promise.resolve(old.release);
  const result = this.read(connectionId).then(release => {
   if (this.pending.get(id)?.result === result && (!this.retained || this.retained.has(id))) this.probes.set(id, { connectionId, checkedAt: now, release });
   return release;
  }).finally(() => { if (this.pending.get(id)?.result === result) this.pending.delete(id); });
  this.pending.set(id, { connectionId, result });
  return result;
 }
 private async read(connectionId: string): Promise<string> {
  try {
   const record = await readHostRecord(this.deps.host, connectionId);
   if (!record) return 'unknown';
   const result = await this.deps.host.exec(connectionId, buildVersionCommand(record));
   if (!result.ok) return 'unknown';
   // Older CLIs return usage + nonzero; a transport failure is NOT evidence of an old CLI.
   return result.exitStatus !== 0 ? 'missing' : parseHostVersion(result.stdout);
  } catch { return 'unknown'; }
 }
}
