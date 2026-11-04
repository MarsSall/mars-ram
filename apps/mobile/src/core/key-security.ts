// Credentials/HostCatalog use case. Private key material never crosses these ports.
import { connectTarget, LEGACY_KEY_ALIAS, type HostCatalog, type KeyRotationError, type SavedHost } from "./host-catalog";
import { readHostRecord } from "./host-record";
import type { HostConnection } from "./ports";

export type KeyGeneration = { alias: string; publicKey: string; requireUnlock: boolean };
export type KeySecurityState = {
 version: 1;
 requireUnlock: boolean;
 current: KeyGeneration;
 previous?: KeyGeneration;
 next: number;
 /** Write intent before creating an immutable Keystore alias; restart completes this intent. */
 preparing?: { alias: string; requireUnlock: boolean };
};
/** Private metadata persistence for Credentials; reads must fail closed on corrupt data. */
export interface KeySecurityStore {
 read(): Promise<KeySecurityState | null>;
 write(state: KeySecurityState): Promise<void>;
}
export type KeySecurityDeps = {
 store: KeySecurityStore;
 catalog: HostCatalog;
 host: HostConnection;
 credentials: {
  ensureKey(alias: string, requireUnlock: boolean, comment: string): Promise<{ publicKey: string }>;
  deleteKey(alias: string): Promise<void>;
  unlock(): Promise<boolean>;
 };
};
export type KeySecurityResult = { ok: true } | { ok: false; code: "ROTATION_PENDING" | "UNLOCK_REQUIRED"; message: string };
export type KeySecurityStatus = { requireUnlock: boolean; perComputer: { hostId: string; name: string; phase: "pending" | "added" | "verified" | "done"; lastError?: KeyRotationError }[] };
export type KeyCommandConfig = { node: string; cli: string };
const alias = (v: unknown): v is string => typeof v === "string" && /^app-ssh-key(?:-[1-9][0-9]*)?$/.test(v);
const publicKey = (v: unknown): v is string => typeof v === "string" && /^(?:ssh-ed25519|ecdsa-sha2-nistp256) [A-Za-z0-9+/]+={0,2}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const generation = (v: unknown): v is KeyGeneration => object(v) && alias(v.alias) && publicKey(v.publicKey) && typeof v.requireUnlock === "boolean";
/** Validate metadata before permitting any key creation, remote mutation, or deletion. */
export function isKeySecurityState(v: unknown): v is KeySecurityState {
 if (!object(v) || v.version !== 1 || typeof v.requireUnlock !== "boolean" || !generation(v.current)
  || v.requireUnlock !== v.current.requireUnlock || !Number.isSafeInteger(v.next) || (v.next as number) < 1) return false;
 if (v.previous !== undefined && (!generation(v.previous) || v.previous.alias === v.current.alias || v.previous.publicKey === v.current.publicKey)) return false;
 if (v.preparing !== undefined && (!object(v.preparing) || !alias(v.preparing.alias) || typeof v.preparing.requireUnlock !== "boolean"
  || v.previous !== undefined || v.preparing.alias !== `app-ssh-key-${(v.next as number) - 1}` || v.preparing.alias === v.current.alias)) return false;
 const numberOf = (a: string) => a === LEGACY_KEY_ALIAS ? 0 : Number(a.slice(12));
 return numberOf(v.current.alias) < (v.next as number) && (v.previous === undefined || numberOf((v.previous as KeyGeneration).alias) < (v.next as number));
}
// Same conservative sh/fish/cmd allow-list as buildLinkCommand: no quoting escapes or shell expansion.
function path(v: unknown, name: RegExp): v is string {
 return typeof v === "string" && (/^\/[A-Za-z0-9._/ -]+$/.test(v) || /^[A-Za-z]:\\[A-Za-z0-9._\\ -]+$/.test(v))
  && !v.split(/[/\\]/).includes("..") && name.test(v.split(/[/\\]/).at(-1) ?? "");
}
function config(v: unknown): v is KeyCommandConfig {
 return object(v) && path(v.node, /^(?:node|node\.exe)$/) && path(v.cli, /^main\.ts$/) && v.node.startsWith("/") === v.cli.startsWith("/");
}
export function buildKeyCommand(record: KeyCommandConfig, command: "add" | "remove", key: string, other: string): string {
 if (!config(record) || !["add", "remove"].includes(command) || !publicKey(key) || !publicKey(other) || key === other) throw new Error("Invalid key command.");
 const q = record.node.startsWith("/") ? "'" : '"';
 return `${q}${record.node}${q} ${q}${record.cli}${q} key ${command} --key ${q}${key}${q} --${command === "add" ? "like" : "keep"} ${q}${other}${q}`;
}
const generic: KeyRotationError = { code: "KEY_ROTATION_FAILED", message: "The key change could not finish. Connect or unlock the computer and try again." };
const notInstalled: KeyRotationError = { code: "KEY_ROTATION_NOT_INSTALLED", message: "Update Mars-RAM on this computer (mars-ram install)." };
const trustedAlias = (h: SavedHost) => h.keyAlias ?? LEGACY_KEY_ALIAS;

/** Serialized operations; another toggle is explicitly refused until the previous rotation finishes. */
export class KeySecurity {
 private queue: Promise<unknown> = Promise.resolve();
 constructor(private readonly deps: KeySecurityDeps) {}
 private serialized<T>(task: () => Promise<T>): Promise<T> {
  const next = this.queue.then(task, task);
  this.queue = next.catch(() => undefined);
  return next;
 }
 private async ensure(alias: string, policy: boolean): Promise<KeyGeneration> {
  const key = await this.deps.credentials.ensureKey(alias, policy, "phone");
  const material = key.publicKey.split(" ").slice(0, 2).join(" ");
  if (!publicKey(material)) throw new Error("Invalid device public key.");
  return { alias, requireUnlock: policy, publicKey: material };
 }
 private async load(): Promise<KeySecurityState> {
  // Validate all credential dependents before creating or changing any generation.
  // The file adapter establishes an explicit empty catalog on pristine installs.
  const hosts = await this.deps.catalog.list();
  let state = await this.deps.store.read();
  if (!state) {
   if (hosts.some(h => trustedAlias(h) !== LEGACY_KEY_ALIAS || (h.rotation && h.rotation.phase !== "done")))
    throw Object.assign(new Error("Key security metadata could not be read."), { code: "CREDENTIAL_METADATA_DAMAGED" });
   state = { version: 1, requireUnlock: true, current: await this.ensure(LEGACY_KEY_ALIAS, true), next: 1 };
   await this.deps.store.write(state);
  }
  if (!isKeySecurityState(state)) throw new Error("Key security metadata could not be read.");
  if (state.preparing) {
   const current = await this.ensure(state.preparing.alias, state.preparing.requireUnlock);
   if (current.publicKey === state.current.publicKey) throw new Error("The new key must be different.");
   state = { version: 1, requireUnlock: current.requireUnlock, current, previous: state.current, next: state.next };
   await this.deps.store.write(state);
  }
  return state;
 }
 /** Also used by pairing/manual add: every NEW computer uses this exact generation. */
 current(): Promise<KeyGeneration> { return this.serialized(async () => (await this.load()).current); }
 /** Pin a generation for the entire pairing transaction, including its eventual catalog save. */
 withCurrent<T>(task: (key: KeyGeneration) => Promise<T>): Promise<T> {
  return this.serialized(async () => task((await this.load()).current));
 }
 status(): Promise<KeySecurityStatus> {
  return this.serialized(async () => {
   const state = await this.load();
   return { requireUnlock: state.requireUnlock, perComputer: (await this.deps.catalog.list()).map(h => ({
    hostId: h.id, name: h.name,
    phase: state.previous && trustedAlias(h) !== state.current.alias ? (h.rotation?.phase === "done" ? "pending" : h.rotation?.phase ?? "pending") : h.rotation?.phase ?? "done",
    ...(h.rotation?.lastError ? { lastError: h.rotation.lastError } : {}),
   })) };
  });
 }
 setRequireUnlock(value: boolean): Promise<KeySecurityResult> {
  return this.serialized(async () => {
   let state = await this.load();
   if (state.previous) return { ok: false, code: "ROTATION_PENDING", message: "Finish the pending key change on every computer before changing it again." };
   if (state.requireUnlock === value) return { ok: true };
   if (state.current.requireUnlock && !(await this.deps.credentials.unlock())) return { ok: false, code: "UNLOCK_REQUIRED", message: "Unlock the phone to change its key." };
   // Persist allocation BEFORE ensureKey: a crash can never reuse an alias with a different policy (L1).
   state = { ...state, next: state.next + 1, preparing: { alias: `app-ssh-key-${state.next}`, requireUnlock: value } };
   await this.deps.store.write(state);
   state = await this.load();
   await this.rotate(state);
   return { ok: true };
  });
 }
 /** Best-effort per-computer progress; callers must not await this from a connection hook. */
 resume(hostId?: string): Promise<void> { return this.serialized(async () => this.rotate(await this.load(), hostId)); }
 private async rotate(state: KeySecurityState, hostId?: string): Promise<void> {
  if (!state.previous) return;
  for (const h of await this.deps.catalog.list()) {
   if (hostId !== undefined && h.id !== hostId) continue;
   if (trustedAlias(h) === state.current.alias && (h.rotation?.phase ?? "done") === "done") continue;
   await this.rotateComputer(state, h);
  }
  // Reload durable references, not optimistic local progress. Delete is idempotent after a crash.
  const hosts = await this.deps.catalog.list();
  if (hosts.some(h => trustedAlias(h) !== state.current.alias || h.rotation?.phase !== "done")) return;
  await this.deps.credentials.deleteKey(state.previous.alias);
  const { previous: _previous, ...finished } = state;
  await this.deps.store.write(finished);
 }
 private async rotateComputer(state: KeySecurityState, initial: SavedHost): Promise<void> {
  const old = state.previous!;
  let h = initial;
  const opened: string[] = [];
  const save = async (next: SavedHost) => { await this.deps.catalog.save(next); h = next; };
  const connect = async (keyAlias: string) => {
   let result = await this.deps.host.connect(connectTarget(h, keyAlias));
   if (!result.ok && result.code === "UNLOCK_REQUIRED" && await this.deps.credentials.unlock()) result = await this.deps.host.connect(connectTarget(h, keyAlias));
   if (!result.ok) throw { code: result.code, message: generic.message } satisfies KeyRotationError;
   opened.push(result.connectionId);
   if (result.fingerprint !== h.hostKey) throw { code: "HOST_KEY_CHANGED", message: "The computer identity changed. Its key was not changed." } satisfies KeyRotationError;
   return result.connectionId;
  };
  const run = async (id: string, record: KeyCommandConfig, command: "add" | "remove") => {
   const result = await this.deps.host.exec(id, buildKeyCommand(record, command, command === "add" ? state.current.publicKey : old.publicKey, command === "add" ? old.publicKey : state.current.publicKey));
   if (!result.ok || result.exitStatus !== 0) throw generic;
   const text = result.stdout.replace(/\r?\n$/, "");
   if (/[\r\n]/.test(text)) throw generic;
   let data: unknown;
   try { data = JSON.parse(text); } catch { throw generic; }
   if (!object(data) || Object.keys(data).length !== 1 || (command === "add" ? typeof data.added !== "boolean" : !Number.isSafeInteger(data.removed) || (data.removed as number) < 0)) throw generic;
  };
  try {
   if (trustedAlias(h) !== old.alias && trustedAlias(h) !== state.current.alias) throw generic;
   if (!h.rotation || h.rotation.phase === "done") await save({ ...h, keyAlias: trustedAlias(h), rotation: { phase: "pending" } });
   if (h.rotation?.phase === "pending") {
    const id = await connect(old.alias);
    const record = await readHostRecord(this.deps.host, id);
    if (!config(record)) throw notInstalled;
    await run(id, record, "add");
    await save({ ...h, rotation: { phase: "added" } });
   }
   // NEVER use the connection pool as proof, even if it contains the new alias.
   const fresh = await connect(state.current.alias);
   const proof = await this.deps.host.exec(fresh, "echo key-rotation-proof");
   if (!proof.ok || proof.exitStatus !== 0 || proof.stdout.trim() !== "key-rotation-proof") throw generic;
   if (h.rotation?.phase === "added") await save({ ...h, rotation: { phase: "verified" } });
   // Persist the working alias BEFORE any removal. A crash can always reconnect with it.
   if (trustedAlias(h) !== state.current.alias) await save({ ...h, keyAlias: state.current.alias, rotation: { phase: "verified" } });
   const record = await readHostRecord(this.deps.host, fresh);
   if (!config(record)) throw notInstalled;
   await run(fresh, record, "remove");
   await save({ ...h, rotation: { phase: "done" } });
  } catch (error) {
   // Never persist SSH stdout/stderr, keys, paths or arbitrary exception text.
   const safe = object(error) && typeof error.code === "string" && ["KEY_ROTATION_NOT_INSTALLED", "HOST_KEY_CHANGED", "UNLOCK_REQUIRED", "UNREACHABLE", "AUTH_FAILED", "KEY_INVALIDATED", "HOST_NOT_FOUND", "TIMEOUT"].includes(error.code)
    ? { code: error.code, message: error.code === "KEY_ROTATION_NOT_INSTALLED" ? notInstalled.message : generic.message } : generic;
   await save({ ...h, rotation: { phase: h.rotation?.phase ?? "pending", lastError: safe } });
  } finally {
   for (const id of opened) await this.deps.host.disconnect(id).catch(() => {});
  }
 }
}
