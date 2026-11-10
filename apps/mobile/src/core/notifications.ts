import { APP_ID } from "@workspace/protocol";
import { inSubnet } from "@workspace/protocol/private-network";
import { connectTarget, hostNetwork, LEGACY_KEY_ALIAS, type HostNetwork, type SavedHost } from "./host-catalog";
import { buildHerdrCommand } from "./herdr-switcher";
import type { KeyCommandConfig } from "./key-security";
import type { HostConnection, HostTarget } from "./ports";
import type { HostConnections } from "./host-connections";
import { readHostRecord } from "./host-record";
import type { PhoneNetworkState } from "./phone-network";

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
   // Not reaching the computer is not a refusal: an earlier registration stays valid.
   const connection = await this.deps.connections.connection(host); if (!connection.ok) return "CONNECTION_FAILED";
   if (signal?.aborted) return "REGISTRATION_FAILED";
   const record = await readHostRecord(this.deps.host, connection.connectionId);
   if (signal?.aborted) return "REGISTRATION_FAILED";
   let command: string;
   try { command = buildNotifyCommand(record as KeyCommandConfig, "register"); } catch { return "UPDATE_REQUIRED"; }
   const registration = await this.deps.local.register(host.id);
   if (signal?.aborted) return "REGISTRATION_FAILED";
   const result = await this.deps.host.execWithInput(connection.connectionId, command, `${JSON.stringify(registration)}\n`);
   if (!result.ok) return "CONNECTION_FAILED";
   if (result.exitStatus !== 0) {
    // Old CLIs do not know notify; their help output is not a versioned response.
    if (result.exitStatus === 127 || result.exitStatus === 9009 || !result.stdout.trim().startsWith("{")) return "UPDATE_REQUIRED";
    // Hosts before ZeroTier notices refuse every phone outside Tailscale with this fixed answer.
    return hostNetwork(host) === "zerotier" && notifyFailed(result.stdout) ? "UPDATE_REQUIRED" : "REGISTRATION_FAILED";
   }
   return parseNotifyRegistration(result.stdout, host.hostKey, registration.port, hostNetwork(host)) ? "ok" : "REGISTRATION_FAILED";
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
/** Where the phone listens for «Siempre atento» notices: Tailscale, or another VPN (ZeroTier) and its subnet. */
export type ListeningNetwork = { kind: "tailscale" | "vpn"; address: string; prefix: number };
/** networks: mode "always" while running, empty with no VPN on; missing in builds before ZeroTier notices. */
export type WatchStatus = { state: "stopped" | "starting" | "running" | "error"; hosts: Record<string, string>; code?: string; networks?: ListeningNetwork[] };
/** CONNECTION_FAILED: the computer was not reached; UPDATE_REQUIRED and REGISTRATION_FAILED: it answered and refused. */
export type RegistrationResult = "ok" | "UPDATE_REQUIRED" | "REGISTRATION_FAILED" | "CONNECTION_FAILED";
/**
 * The last «Siempre atento» registration a computer accepted. Names the host and its network only: the notice secret
 * stays in the native encrypted vault, keyed by host id, until the computer is forgotten.
 */
export type AlwaysRegistration = { hostId: string; hostKeyId: string; network: HostNetwork; address: string };
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
 /** The phone's VPN state now; null when it cannot be read. */
 phone(): Promise<PhoneNetworkState | null>;
 /** Durable AlwaysRegistration records; anything unreadable counts as none. */
 registrations(): Promise<unknown>;
 saveRegistrations(records: AlwaysRegistration[]): Promise<void>;
}
/**
 * network/address are set in mode "always", where notices need that network's VPN on the phone. networkOff: the phone
 * reported that VPN off, so the computer was not tried now (NETWORK_OFF without an earlier registration, else kept).
 */
export type NotificationSnapshot = { mode: NotificationMode; busy: boolean; error?: string; status: WatchStatus; computers: { hostId: string; name: string; result: RegistrationResult | "PREPARATION_TIMEOUT" | "NETWORK_OFF"; network?: HostNetwork; address?: string; networkOff?: true }[] };
export const notificationMode = (value: unknown): NotificationMode => value === "while-working" || value === "always" ? value : "off";
/**
 * Android runs one VPN at a time (zerotier-phase2 S5). "off": the phone is not listening on this computer's network now;
 * "listening" claims no delivery; "unknown" without a running watch or in builds that do not report networks.
 */
export function alwaysReachability(computer: { network: HostNetwork; address: string }, status: WatchStatus): "listening" | "off" | "unknown" {
 if (status.state !== "running" || !Array.isArray(status.networks)) return "unknown";
 const listening = computer.network === "tailscale" ? status.networks.some(n => n.kind === "tailscale")
  : status.networks.some(n => n.kind === "vpn" && inSubnet(computer.address, n.address, n.prefix));
 return listening ? "listening" : "off";
}

/**
 * Whether the phone's VPN for this network is on: Tailscale with a Tailscale address, ZeroTier as another VPN (Android
 * runs one at a time). null when the phone could not tell, and then the computer is tried as before.
 */
export function phoneOnNetwork(network: HostNetwork, phone: PhoneNetworkState | null): boolean | null {
 if (!phone) return null;
 if (network === "tailscale") return phone.tailscaleOn;
 // Without vpnOn the read may be the non-blocking fallback, which always claims Tailscale: try the computer.
 return phone.vpnOn === undefined ? null : phone.vpnOn && !phone.tailscaleOn;
}
export function parseAlwaysRegistrations(raw: unknown): AlwaysRegistration[] {
 if (!Array.isArray(raw)) return [];
 return raw.flatMap(v => !!v && typeof v === "object" && typeof v.hostId === "string" && typeof v.hostKeyId === "string" && typeof v.address === "string"
  && (v.network === "tailscale" || v.network === "zerotier") ? [{ hostId: v.hostId, hostKeyId: v.hostKeyId, network: v.network, address: v.address }] : []);
}
const registrationOf = (host: SavedHost): AlwaysRegistration => ({ hostId: host.id, hostKeyId: host.hostKey, network: hostNetwork(host), address: host.address });
/** An earlier registration is valid only for the same saved computer, identity, network and address. */
const sameRegistration = (a: AlwaysRegistration, b: AlwaysRegistration) => a.hostId === b.hostId && a.hostKeyId === b.hostKeyId && a.network === b.network && a.address === b.address;

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
   // Secrets were forgotten when leaving «Siempre atento»; a leftover record must not outlive them.
   if (previous !== "always" && mode === "always") await this.saveRegistrations(() => []);
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
  await this.saveRegistrations(() => []);
 }
 /** Best effort: a record left behind is checked again against the saved computers on every start. */
 private async saveRegistrations(change: (records: AlwaysRegistration[]) => AlwaysRegistration[]) {
  try { const records = parseAlwaysRegistrations(await bounded(() => this.ports.registrations())); await bounded(() => this.ports.saveRegistrations(change(records))); }
  catch { /* See above. */ }
 }
 private async revoke(host: SavedHost, remoteBudget = NOTIFICATION_OPERATION_TIMEOUT_MS) {
  try { await bounded(() => this.ports.unregister(host), remoteBudget); } catch { /* Remote cleanup is best effort; local revocation is mandatory. */ }
  await bounded(() => this.ports.forget(host.id));
 }
 async removeComputer(host: SavedHost): Promise<void> {
  let failed = false;
  await this.run(async () => {
   try { await bounded(() => this.ports.stop()); await this.revoke(host); await this.saveRegistrations(records => records.filter(r => r.hostId !== host.id)); }
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
   // Android runs one VPN at a time: computers on the VPN that is off are not tried and keep their earlier registration.
   let phone: PhoneNetworkState | null = null;
   try { phone = await bounded(() => this.ports.phone()); } catch { /* Unknown: try every computer, as before. */ }
   let previous: AlwaysRegistration[] = [];
   try { previous = parseAlwaysRegistrations(await bounded(() => this.ports.registrations())); } catch { /* None. */ }
   const computers: NotificationSnapshot["computers"] = [];
   const registered: (AlwaysRegistration | undefined)[] = [];
   // Each computer gets its own bound, all at once: a slow or unreachable one cannot use up another's time.
   await Promise.all(hosts.map(async (host, index) => {
    const current = registrationOf(host);
    const earlier = previous.find(r => sameRegistration(r, current));
    const networkOff = phoneOnNetwork(current.network, phone) === false;
    let result: NotificationSnapshot["computers"][number]["result"];
    if (networkOff) result = earlier ? "ok" : "NETWORK_OFF";
    else {
     try { result = await bounded(signal => this.ports.register(host, signal)); }
     catch (error) { result = error instanceof WatchTimeout ? "PREPARATION_TIMEOUT" : "REGISTRATION_FAILED"; }
    }
    // A refusal drops the earlier registration; not reaching the computer keeps it.
    registered[index] = result === "ok" ? current : result === "CONNECTION_FAILED" || result === "PREPARATION_TIMEOUT" ? earlier : undefined;
    computers[index] = { hostId: host.id, name: host.name, result, network: current.network, address: host.address, ...(networkOff ? { networkOff: true as const } : {}) };
    this.update({ computers: computers.filter(Boolean) });
   }));
   const records = registered.filter((r): r is AlwaysRegistration => !!r);
   try { await bounded(() => this.ports.saveRegistrations(records)); } catch { /* Kept only for this start; tried again on the next. */ }
   config = { appId: APP_ID, mode: "always", language: this.language, hosts: records.map(r => ({ hostId: r.hostId, hostKeyId: r.hostKeyId })) };
   if (!config.hosts.length) { this.update({ error: computers.some(c => c.result === "PREPARATION_TIMEOUT") ? "WATCH_TIMEOUT" : computers.every(c => c.result === "NETWORK_OFF") ? "NETWORK_OFF" : "REGISTRATION_FAILED" }); return; }
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
/** A ZeroTier answer names its network; a Tailscale answer has none, as before ZeroTier notices. */
export function parseNotifyRegistration(stdout: string, fingerprint: string, port: number, network: HostNetwork = "tailscale"): boolean {
 if (stdout.length > 4096) return false;
 try { const v: unknown = JSON.parse(stdout); return !!v && typeof v === "object" && !Array.isArray(v) &&
  "v" in v && v.v === 1 && "ok" in v && v.ok === true && "hostKeyId" in v && v.hostKeyId === fingerprint && "port" in v && v.port === port
  && (network === "zerotier" ? "network" in v && v.network === "zerotier" : !("network" in v));
 } catch { return false; }
}
function notifyFailed(stdout: string): boolean {
 if (stdout.length > 4096) return false;
 try { const v: unknown = JSON.parse(stdout); return !!v && typeof v === "object" && !Array.isArray(v) && "v" in v && v.v === 1 && "ok" in v && v.ok === false && "code" in v && v.code === "NOTIFY_FAILED"; }
 catch { return false; }
}
