import { APP_ID } from "@workspace/protocol";
import { connectTarget, hasTailscaleFeatures, LEGACY_KEY_ALIAS, type SavedHost } from "./host-catalog";
import { buildHerdrCommand } from "./herdr-switcher";
import type { KeyCommandConfig } from "./key-security";
import type { HostConnection, HostTarget } from "./ports";
import type { HostConnections } from "./host-connections";
import { readHostRecord } from "./host-record";

export const NOTIFICATION_OPERATION_TIMEOUT_MS = 30_000;
class WatchTimeout extends Error {}

/** A rejected race stops the caller's continuation; abort also guards multi-step registration. */
async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs = NOTIFICATION_OPERATION_TIMEOUT_MS): Promise<T> {
 if (timeoutMs <= 0) throw new WatchTimeout();
 const controller = new AbortController();
 let timer: ReturnType<typeof setTimeout> | undefined;
 const deadline = new Promise<never>((_, reject) => {
  timer = setTimeout(() => { reject(new WatchTimeout()); controller.abort(); }, timeoutMs);
 });
 try { return await Promise.race([operation(controller.signal), deadline]); }
 finally { clearTimeout(timer); }
}

export interface NotificationRegistrationHost extends Pick<HostConnection, "readFile"> {
 execWithInput(connectionId: string, command: string, input: string): ReturnType<HostConnection["exec"]>;
}
/** The registration adapter never exposes host stdout/stderr (which could echo a secret) to UI/logs. */
export class NotificationRegistration {
 constructor(private readonly deps: { connections: Pick<HostConnections, "connection">; host: NotificationRegistrationHost; local: { register(hostId: string): Promise<{ secret: string; port: number }> } }) {}
 async register(host: SavedHost, signal?: AbortSignal): Promise<RegistrationResult> {
  try {
   if (signal?.aborted) return "REGISTRATION_FAILED";
   const connection = await this.deps.connections.connection(host); if (!connection.ok) return "REGISTRATION_FAILED";
   if (signal?.aborted) return "REGISTRATION_FAILED";
   const record = await readHostRecord(this.deps.host, connection.connectionId);
   if (signal?.aborted) return "REGISTRATION_FAILED";
   let command: string;
   try { command = buildNotifyCommand(record as KeyCommandConfig, "register"); } catch { return "UPDATE_REQUIRED"; }
   const registration = await this.deps.local.register(host.id);
   if (signal?.aborted) return "REGISTRATION_FAILED";
   const result = await this.deps.host.execWithInput(connection.connectionId, command, `${JSON.stringify(registration)}\n`);
   if (!result.ok) return "REGISTRATION_FAILED";
   if (result.exitStatus !== 0) {
    // Old CLIs do not know notify; their help output is not a versioned response.
    return result.exitStatus === 127 || result.exitStatus === 9009 || !result.stdout.trim().startsWith("{") ? "UPDATE_REQUIRED" : "REGISTRATION_FAILED";
   }
   return parseNotifyRegistration(result.stdout, host.hostKey, registration.port) ? "ok" : "REGISTRATION_FAILED";
  } catch { return "REGISTRATION_FAILED"; }
 }
 async unregister(host: SavedHost): Promise<void> {
  const connection = await this.deps.connections.connection(host); if (!connection.ok) return;
  const record = await readHostRecord(this.deps.host, connection.connectionId);
  await this.deps.host.execWithInput(connection.connectionId, buildNotifyCommand(record as KeyCommandConfig, "unregister"), "");
 }
}

export type NotificationMode = "off" | "while-working" | "always";
export type WatchConfig = { appId: string; language: "es" | "en" } & (
 { mode: "while-working"; hosts: { hostId: string; connection: HostTarget & { expectedFingerprint: string } }[] } |
 { mode: "always"; hosts: { hostId: string; hostKeyId: string }[] });
export type WatchStatus = { state: "stopped" | "starting" | "running" | "error"; hosts: Record<string, string>; code?: string };
export type RegistrationResult = "ok" | "UPDATE_REQUIRED" | "REGISTRATION_FAILED";
export interface NotificationPorts {
 read(): unknown;
 write(mode: NotificationMode): Promise<void>;
 permission(): Promise<boolean>;
 visible(): boolean;
 hosts(): Promise<SavedHost[]>;
 /** Existing UI connection/unlock flow; reuses a live connection without touching the key. */
 connect(host: SavedHost): Promise<{ ok: true } | { ok: false; code: string }>;
 start(config: WatchConfig): Promise<{ ok: true } | { ok: false; code: string }>;
 stop(): Promise<void>;
 status(): WatchStatus;
 register(host: SavedHost, signal?: AbortSignal): Promise<RegistrationResult>;
 unregister(host: SavedHost): Promise<void>;
 forget(hostId: string): Promise<void>;
}
export type NotificationSnapshot = { mode: NotificationMode; busy: boolean; error?: string; status: WatchStatus; computers: { hostId: string; name: string; result: RegistrationResult | "CONNECTION_FAILED" | "PREPARATION_TIMEOUT" | "TAILSCALE_ONLY" }[] };
export const notificationMode = (value: unknown): NotificationMode => value === "while-working" || value === "always" ? value : "off";

/** Serialized opt-in transitions. No permission prompts or remote registrations on import. */
export class NotificationSettings {
 private value: NotificationSnapshot;
 private language: "es" | "en" = "en";
 private queue: Promise<unknown> = Promise.resolve();
 private listeners = new Set<() => void>();
 constructor(private readonly ports: NotificationPorts) {
  this.value = { mode: notificationMode(ports.read()), busy: false, status: ports.status(), computers: [] };
 }
 snapshot = (): NotificationSnapshot => this.value;
 subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
 private update(patch: Partial<NotificationSnapshot>) { this.value = { ...this.value, ...patch }; this.listeners.forEach(fn => fn()); }
 private run(task: () => Promise<void>): Promise<void> {
  const next = this.queue.then(async () => {
   this.update({ busy: true, error: undefined });
   try { await task(); } catch (error) { this.update({ error: error instanceof WatchTimeout ? "WATCH_TIMEOUT" : "WATCH_FAILED" }); }
   finally { this.update({ busy: false }); this.refreshStatus(); }
  });
  this.queue = next; return next;
 }
 refreshStatus() { const status = this.ports.status(); this.update({ status, ...(status.state === "error" ? { error: status.code ?? "WATCH_FAILED" } : {}) }); }
 setLanguage(language: "es" | "en") { this.language = language; }
 choose(mode: NotificationMode): Promise<void> {
  return this.run(async () => {
   if (mode !== "off" && !(await bounded(() => this.ports.permission()))) {
    await this.disable(); this.update({ error: "NOTIFICATIONS_DENIED" }); return;
   }
   const previous = this.value.mode;
   await bounded(() => this.ports.stop());
   if (previous === "always" && mode !== "always") await this.revokeAll();
   // Persist intent, not a claim that Android is running the service.
   await bounded(() => this.ports.write(mode)); this.update({ mode, computers: [] });
   if (mode !== "off") await this.start(true);
  });
 }
 private async disable() {
  await bounded(() => this.ports.stop()); if (this.value.mode === "always") await this.revokeAll();
  await bounded(() => this.ports.write("off")); this.update({ mode: "off", computers: [] });
 }
 private async revokeAll() {
  const hosts = await bounded(() => this.ports.hosts());
  const deadline = Date.now() + NOTIFICATION_OPERATION_TIMEOUT_MS;
  for (const host of hosts) await this.revoke(host, deadline - Date.now());
 }
 private async revoke(host: SavedHost, remoteBudget = NOTIFICATION_OPERATION_TIMEOUT_MS) {
  try { await bounded(() => this.ports.unregister(host), remoteBudget); } catch { /* Remote cleanup is best effort; local revocation is mandatory. */ }
  await bounded(() => this.ports.forget(host.id));
 }
 async removeComputer(host: SavedHost): Promise<void> {
  let failed = false;
  await this.run(async () => {
   try { await bounded(() => this.ports.stop()); await this.revoke(host); }
   catch { failed = true; throw Error("Local revocation failed"); }
  });
  if (failed) throw Error("Local revocation failed");
 }
 computersChanged(): Promise<void> {
  if (this.value.mode === "off") return Promise.resolve();
  return this.run(async () => { await bounded(() => this.ports.stop()); await this.start(true); });
 }
 ensureWatching(): Promise<void> {
  if (!this.ports.visible() || this.value.mode === "off" || this.value.busy) return Promise.resolve();
  return this.run(() => this.start(false));
 }
 private async start(force: boolean) {
  if (!this.ports.visible()) { this.update({ error: "APP_NOT_VISIBLE" }); return; }
  const status = this.ports.status();
  if (!force && (status.state === "running" || status.state === "starting")) return;
  const hosts = await bounded(() => this.ports.hosts());
  if (!hosts.length) { this.update({ error: "NO_COMPUTERS" }); return; }
  // One budget for all computers, not 30 seconds multiplied by the saved-host count.
  const preparationDeadline = Date.now() + NOTIFICATION_OPERATION_TIMEOUT_MS;
  const prepare = <T,>(operation: (signal: AbortSignal) => Promise<T>) => bounded(operation, preparationDeadline - Date.now());
  let config: WatchConfig;
  if (this.value.mode === "always") {
   const computers: NotificationSnapshot["computers"] = [];
   for (const host of hosts) {
    let result: NotificationSnapshot["computers"][number]["result"];
    // Notices arrive on the Tailscale address; a ZeroTier computer is never registered (zerotier S3).
    if (!hasTailscaleFeatures(host)) result = "TAILSCALE_ONLY";
    else try { result = await prepare(signal => this.ports.register(host, signal)); }
    catch (error) { result = error instanceof WatchTimeout ? "PREPARATION_TIMEOUT" : "REGISTRATION_FAILED"; }
    computers.push({ hostId: host.id, name: host.name, result }); this.update({ computers: [...computers] });
   }
   const accepted = new Set(computers.filter(c => c.result === "ok").map(c => c.hostId));
   config = { appId: APP_ID, mode: "always", language: this.language, hosts: hosts.filter(h => accepted.has(h.id)).map(h => ({ hostId: h.id, hostKeyId: h.hostKey })) };
   if (!config.hosts.length) { this.update({ error: computers.some(c => c.result === "PREPARATION_TIMEOUT") ? "WATCH_TIMEOUT" : computers.every(c => c.result === "TAILSCALE_ONLY") ? "TAILSCALE_ONLY" : "REGISTRATION_FAILED" }); return; }
  } else if (this.value.mode === "while-working") {
   // Only the visible UI may prompt. Native start adopts these retained transports.
   const computers: NotificationSnapshot["computers"] = [];
   const prepared: SavedHost[] = [];
   let firstFailure: string | undefined;
   this.update({ computers: [] });
   for (const host of hosts) {
    if (!this.ports.visible()) { this.update({ error: "APP_NOT_VISIBLE" }); return; }
    let connected: Awaited<ReturnType<NotificationPorts["connect"]>>;
    try { connected = await prepare(() => this.ports.connect(host)); }
    catch (error) { connected = { ok: false, code: error instanceof WatchTimeout ? "WATCH_TIMEOUT" : "CONNECTION_FAILED" }; }
    if (connected.ok) prepared.push(host);
    else firstFailure ??= connected.code;
    computers.push({ hostId: host.id, name: host.name, result: connected.ok ? "ok" : connected.code === "WATCH_TIMEOUT" ? "PREPARATION_TIMEOUT" : "CONNECTION_FAILED" });
    this.update({ computers: [...computers] });
   }
   if (!prepared.length) { this.update({ error: firstFailure ?? "CONNECTION_FAILED" }); return; }
   config = { appId: APP_ID, mode: "while-working", language: this.language, hosts: prepared.map(h => ({ hostId: h.id, connection: connectTarget(h, h.keyAlias ?? LEGACY_KEY_ALIAS) })) };
  } else return;
  // Permission/SSH dialogs may have moved the app out of the foreground.
  if (!this.ports.visible()) { this.update({ error: "APP_NOT_VISIBLE" }); return; }
  const result = await bounded(() => this.ports.start(config));
  if (!result.ok) {
   if (result.code === "NOTIFICATIONS_DENIED") await this.disable();
   this.update({ error: result.code });
  }
 }
}
/** Reuse the installed CLI path validation and sh/fish/cmd quoting, with fixed verbs only. */
export function buildNotifyCommand(record: KeyCommandConfig, verb: "register" | "unregister"): string {
 if (verb !== "register" && verb !== "unregister") throw Error("Invalid notify verb");
 return buildHerdrCommand(record, "list").replace(/ herdr list$/, ` notify ${verb}${verb === "register" ? " --json" : ""}`);
}
export function parseNotifyRegistration(stdout: string, fingerprint: string, port: number): boolean {
 if (stdout.length > 4096) return false;
 try { const v: unknown = JSON.parse(stdout); return !!v && typeof v === "object" && !Array.isArray(v) &&
  "v" in v && v.v === 1 && "ok" in v && v.ok === true && "hostKeyId" in v && v.hostKeyId === fingerprint && "port" in v && v.port === port;
 } catch { return false; }
}
