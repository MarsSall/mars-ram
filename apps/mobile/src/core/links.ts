import { APP_ID, ATTACHMENT_MAX_BYTES, UploadName } from "@workspace/protocol";
import { Value } from "typebox/value";
import { uploadName, type Attachment } from "./attachment-draft";
import type { SavedHost } from "./host-catalog";
import type { HostConnections } from "./host-connections";
import type { Failure, HostConnection } from "./ports";
import { readHostRecord } from "./host-record";

export type LinkConfig = { node: string; linkServer: string; linkPort: number };
export type CreatedLink = { id: string; url: string; expiresAt: string };
export type RemoteLink = CreatedLink & { fileName: string; size: number; createdAt: string };
export type LinkHistoryEntry = RemoteLink & { computerId: string };
export type LinkStatus = "valid" | "expired" | "deleted" | "unavailable";
export type LinkHistoryItem = LinkHistoryEntry & { status: LinkStatus };
/** Persistence dependency of LinkService; implementations must serialize mutations across computers. */
export interface LinkHistoryStore {
 list(computerId: string): Promise<LinkHistoryEntry[]>;
 save(entry: LinkHistoryEntry): Promise<void>;
 remove(computerId: string, id: string): Promise<void>;
}
export type LinkFailure = { ok: false; code: Failure["code"] | "LINK_NOT_INSTALLED" | "LINK_FAILED"; message: string };
export type LinkResult<T> = { ok: true; value: T } | LinkFailure;
export type LinkDeps = {
 host: HostConnection;
 connections: Pick<HostConnections, "connection">;
 history: LinkHistoryStore;
 clock(): number;
 random(): number;
};
type Command = "create" | "list" | "delete" | "ensure";
const staging = `.${APP_ID}/links/.staging`;
const failed = (): LinkFailure => ({ ok: false, code: "LINK_FAILED", message: "The link operation could not be completed. Please try again." });
const notInstalled = (): LinkFailure => ({ ok: false, code: "LINK_NOT_INSTALLED", message: "Link server not installed. Run mars-ram install on the computer." });
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const validId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{12}$/.test(v);
const validName = (v: unknown): v is string => typeof v === "string" && !v.includes("..") && Value.Check(UploadName, v);
// POSIX paths use only "/" (fish rewrites \\ inside single quotes); Windows paths only "\" with one drive colon.
function validPath(v: unknown, name: RegExp): v is string {
 if (typeof v !== "string" || !(/^\/[A-Za-z0-9._/ -]+$/.test(v) || /^[A-Za-z]:\\[A-Za-z0-9._\\ -]+$/.test(v))) return false;
 const parts = v.split(/[/\\]/);
 return !parts.includes("..") && name.test(parts.at(-1) ?? "");
}
function isConfig(v: unknown): v is LinkConfig {
 return object(v) && validPath(v.node, /^(?:node|node\.exe)$/) && validPath(v.linkServer, /^main\.ts$/)
  && v.node.startsWith("/") === v.linkServer.startsWith("/") && typeof v.linkPort === "number" && Number.isInteger(v.linkPort) && v.linkPort >= 1024 && v.linkPort <= 65535;
}
/** Only allow-listed arguments cross the default-shell boundary. No URL, token or user text. */
export function buildLinkCommand(config: LinkConfig, command: Command, argument?: string): string {
 if (!isConfig(config) || !["create", "list", "delete", "ensure"].includes(command)
  || (command === "create" ? !validName(argument) : command === "delete" ? !validId(argument) : argument !== undefined)) throw new Error("Invalid link command.");
 const quote = config.node.startsWith("/") ? "'" : '"';
 return `${quote}${config.node}${quote} ${quote}${config.linkServer}${quote} ${command}${command === "create" ? ` --staged ${argument}` : command === "delete" ? ` ${argument}` : ""} --port ${config.linkPort}`;
}
const iso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function validUrl(v: unknown): v is string {
 if (typeof v !== "string" || !v.startsWith("http://") || !v.includes("/l/")) return false;
 try {
  const url = new URL(v);
  return url.protocol === "http:" && !!url.hostname && !url.username && !url.password && !url.search && !url.hash && /^\/l\/[A-Za-z0-9_-]{43}$/.test(url.pathname) && url.href === v;
 } catch { return false; }
}
function created(v: unknown): v is CreatedLink {
 return object(v) && exact(v, ["id", "url", "expiresAt"]) && validId(v.id) && validUrl(v.url) && iso(v.expiresAt);
}
function remote(v: unknown): v is RemoteLink {
 return object(v) && exact(v, ["id", "url", "expiresAt", "fileName", "size", "createdAt"])
  && created({ id: v.id, url: v.url, expiresAt: v.expiresAt }) && validName(v.fileName)
  && typeof v.size === "number" && Number.isSafeInteger(v.size) && v.size >= 0 && v.size <= ATTACHMENT_MAX_BYTES && iso(v.createdAt) && Date.parse(v.expiresAt as string) > Date.parse(v.createdAt);
}
/** Validate private persisted history without trusting filesystem JSON. */
export function isLinkHistoryEntry(v: unknown): v is LinkHistoryEntry {
 if (!object(v) || typeof v.computerId !== "string" || !v.computerId || !exact(v, ["computerId", "id", "url", "expiresAt", "fileName", "size", "createdAt"])) return false;
 const { computerId: _computerId, ...link } = v;
 return remote(link);
}
const serving = (v: unknown): v is { serving: boolean } => object(v) && exact(v, ["serving"]) && typeof v.serving === "boolean";
const deleted = (v: unknown): v is { ok: true } => object(v) && exact(v, ["ok"]) && v.ok === true;
const listed = (v: unknown): v is { serving: boolean; links: RemoteLink[] } => object(v) && exact(v, ["serving", "links"]) && typeof v.serving === "boolean" && Array.isArray(v.links) && v.links.every(remote) && new Set(v.links.map(l => l.id)).size === v.links.length;

/** One saved computer. URLs stay in private history and return values, never diagnostics. */
export class LinkService {
 constructor(private readonly deps: LinkDeps, private readonly computer: SavedHost) {}
 private async run<T>(connectionId: string, config: LinkConfig, command: Command, validate: (value: unknown) => value is T, argument?: string): Promise<LinkResult<T>> {
  try {
   const result = await this.deps.host.exec(connectionId, buildLinkCommand(config, command, argument));
   if (!result.ok || result.exitStatus !== 0) return failed();
   // One JSON line only, with an optional final line ending; never echo stdout/stderr.
   const text = result.stdout.replace(/\r?\n$/, "");
   if (!text || /[\r\n]/.test(text)) return failed();
   const value: unknown = JSON.parse(text);
   return validate(value) ? { ok: true, value } : failed();
  } catch { return failed(); }
 }
 private async context(): Promise<{ ok: true; connectionId: string; config: LinkConfig } | LinkFailure> {
  try {
   const result = await this.deps.connections.connection(this.computer);
   if (!result.ok) return { ok: false, code: result.code, message: "The computer is unavailable. Connect or unlock it and try again." };
   const config = await readHostRecord(this.deps.host, result.connectionId);
   return isConfig(config) ? { ok: true, connectionId: result.connectionId, config } : notInstalled();
  } catch { return failed(); }
 }
 private async command<T>(command: Command, validate: (value: unknown) => value is T, argument?: string): Promise<LinkResult<T>> {
  const context = await this.context();
  return context.ok ? this.run(context.connectionId, context.config, command, validate, argument) : context;
 }
 list(): Promise<LinkResult<{ serving: boolean; links: RemoteLink[] }>> { return this.command("list", listed); }
 ensure(): Promise<LinkResult<{ serving: boolean }>> { return this.command("ensure", serving); }
 /** Low-level remote delete; Files UI should use remove() to update phone history too. */
 delete(id: string): Promise<LinkResult<{ ok: true }>> { return validId(id) ? this.command("delete", deleted, id) : Promise.resolve(failed()); }
 async create(file: Attachment): Promise<LinkResult<LinkHistoryEntry>> {
  if (file.size !== null && (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > ATTACHMENT_MAX_BYTES)) return { ok: false, code: "TOO_LARGE", message: "Choose a file no larger than 25 MiB." };
  const context = await this.context();
  if (!context.ok) return context;
  let staged: string | null = null;
  let success = false;
  try {
   // Initializes private host storage before the first SFTP upload.
   const initialized = await this.run(context.connectionId, context.config, "ensure", serving);
   if (!initialized.ok) return initialized;
   const name = uploadName(file.displayName.replace(/\.{2,}/g, "."), this.deps.clock, this.deps.random);
   if (!validName(name)) return failed();
   const uploaded = await this.deps.host.uploadFile(context.connectionId, file.sourceUri, staging, name, ATTACHMENT_MAX_BYTES);
   if (!uploaded.ok) return { ok: false, code: uploaded.code, message: uploaded.code === "TOO_LARGE" ? "Choose a file no larger than 25 MiB." : "The selected file could not be uploaded. Please select it again." };
   // Failed uploads clean their own private .part; the destination may belong to another upload.
   staged = `${staging}/${name}`;
   const result = await this.run(context.connectionId, context.config, "create", created, name);
   if (!result.ok) return result;
   staged = null; // The computer moved the staged copy; that path may already hold another upload.
   const value: LinkHistoryEntry = { ...result.value, computerId: this.computer.id, fileName: name, size: uploaded.size, createdAt: new Date(this.deps.clock()).toISOString() };
   try { await this.deps.history.save(value); } catch {
    // A link the phone cannot list would stay usable for a day with no way to delete it.
    await this.delete(value.id).catch(() => {});
    return failed();
   }
   success = true;
   return { ok: true, value };
  } catch { return failed(); }
  finally {
   if (staged && !success) {
    try { await this.deps.host.removeFile(context.connectionId, staged); } catch { /* Best effort; never include remote output. */ }
   }
  }
 }
 /** A link to a file already on the computer: `stage` copies it into the private staging
  * dir (mars-ram project stage-link) after `ensure` created that dir; no phone upload. */
 async createFromHost(stage: () => Promise<{ ok: true; staged: string; size: number } | { ok: false }>): Promise<LinkResult<LinkHistoryEntry>> {
  const context = await this.context();
  if (!context.ok) return context;
  try {
   const initialized = await this.run(context.connectionId, context.config, "ensure", serving);
   if (!initialized.ok) return initialized;
   const copy = await stage();
   if (!copy.ok || !validName(copy.staged) || !Number.isSafeInteger(copy.size) || copy.size < 0 || copy.size > ATTACHMENT_MAX_BYTES) return failed();
   const result = await this.run(context.connectionId, context.config, "create", created, copy.staged);
   if (!result.ok) {
    try { await this.deps.host.removeFile(context.connectionId, `${staging}/${copy.staged}`); } catch { /* Best effort. */ }
    return result;
   }
   const value: LinkHistoryEntry = { ...result.value, computerId: this.computer.id, fileName: copy.staged, size: copy.size, createdAt: new Date(this.deps.clock()).toISOString() };
   try { await this.deps.history.save(value); } catch { await this.delete(value.id).catch(() => {}); return failed(); }
   return { ok: true, value };
  } catch { return failed(); }
 }
 /** Persisted rows survive expiry and host deletion; availability always needs fresh evidence. */
 async history(): Promise<LinkHistoryItem[]> {
  const entries = await this.deps.history.list(this.computer.id);
  const result = entries.some(e => Date.parse(e.expiresAt) > this.deps.clock()) ? await this.list() : null;
  return entries.map(entry => {
   const current = result?.ok ? result.value.links.find(l => l.id === entry.id) : undefined;
   const status: LinkStatus = Date.parse(entry.expiresAt) <= this.deps.clock() ? "expired" : !result?.ok ? "unavailable" : !current ? "deleted" : result.value.serving ? "valid" : "unavailable";
   return { ...entry, url: current?.url ?? entry.url, status };
  });
 }
 /** status is what the user saw: a row the computer already deleted is only removed from the phone. */
 async remove(id: string, status?: LinkStatus): Promise<LinkResult<{ ok: true }>> {
  try {
   const entry = (await this.deps.history.list(this.computer.id)).find(e => e.id === id);
   if (!entry || !validId(id)) return failed();
   if (status !== "deleted" && Date.parse(entry.expiresAt) > this.deps.clock()) {
    const result = await this.delete(id);
    if (!result.ok) return result;
   }
   await this.deps.history.remove(this.computer.id, id);
   return { ok: true, value: { ok: true } };
  } catch { return failed(); }
 }
 /** Called by the first-connect hook with the established connection; never reconnect recursively. */
 async restore(connectionId: string): Promise<void> {
  try {
   if (!(await this.deps.history.list(this.computer.id)).some(e => Date.parse(e.expiresAt) > this.deps.clock())) return;
   const config = await readHostRecord(this.deps.host, connectionId);
   if (isConfig(config)) await this.run(connectionId, config, "ensure", serving);
  } catch { /* Restart is best effort and must not fail the connection. */ }
 }
}
