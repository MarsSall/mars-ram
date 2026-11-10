import { readHostRecord } from "./host-record";
import { readHerdrKeys, parseHerdrKeys, type HerdrKeys } from "./herdr-keys";
import type { SavedHost } from "./host-catalog";
import type { HostConnections } from "./host-connections";
import type { Failure, HostConnection, TerminalChannel, TerminalExit } from "./ports";
import type { Attachment } from "./attachment-draft";
import { uploadTerminalAttachments, type AttachmentUploads, type UploadProgress } from "./attachment-uploads";
import type { UploadsFolderLookup } from "./uploads-folder";

/** Same allow-list as native: absolute safe path to Herdr, or the legacy bare name. */
export function validHerdrPath(value: unknown): value is string {
 if (typeof value !== "string") return false;
 if (value === "herdr") return true;
 if (!/^(?:\/|[A-Za-z]:\\)/.test(value) || !/^[A-Za-z0-9._/\\: -]+$/.test(value)) return false;
 const parts = value.split(/[/\\]/);
 return !parts.includes("..") && /^(?:herdr|herdr\.exe)$/.test(parts.at(-1) ?? "");
}

export type HerdrState =
 | { status: "connecting" | "open" | "reconnecting" }
 | { status: "closed"; reason: string; code?: Failure["code"] }
 | { status: "unlock-required"; reason: string; code: Failure["code"] };
export type HerdrOptions = { cols: number; rows: number; sessionKey?: string };
export type HerdrDeps = {
 connections: Pick<HostConnections, "connection" | "drop">;
 channel: TerminalChannel;
 host: HostConnection;
 uploadsFolder: UploadsFolderLookup;
 clock: () => number;
 random: () => number;
 history?: AttachmentUploads["history"];
 /** Best-effort SessionBridge operation; absent for standalone terminals. */
 /** isCurrent turns false once this open is closed or replaced: check it before acting. */
 focusSession?: (key: string, fresh: boolean, isCurrent: () => boolean) => Promise<void>;
};
type Result = { ok: true } | { ok: false; message: string };
const validSize = (cols: number, rows: number) => [cols, rows].every(n => Number.isInteger(n) && n >= 1 && n <= 1000);
const offline = (): Failure => ({ ok: false, code: "NOT_CONNECTED", message: "The terminal is not connected." });
const backoff = [1000, 2000, 5000, 10000];

/** Full Herdr client. After opening, a session bridge may focus its own workspace/tab;
 * Herdr shares that focus with the PC (S11). Reattaching a view to an open PTY
 * discards the detached tail, resets the emulator and debounces a full resize redraw. */
export class HerdrTerminal {
 private readonly sessionKey: string | undefined;
 state: HerdrState = { status: "closed", reason: "" };
 private readonly observers = new Set<(state: HerdrState) => void>();
 private output: ((bytes: Uint8Array) => void) | null = null;
 private buffer = new Uint8Array(0);
 private terminalId: string | null = null;
 private unsubscribe: (() => void) | null = null;
 private retry: ReturnType<typeof setTimeout> | null = null;
 private resizeTimer: ReturnType<typeof setTimeout> | null = null;
 private redrawTimer: ReturnType<typeof setTimeout> | null = null;
 private attempt = 0;
 private generation = 0;
 private active = true;
 private stopped = false;
 private dropped = false;
 private cols: number;
 private rows: number;
 private sending = false;
 private fallback = false;
 private openedAt = 0;

 constructor(private readonly deps: HerdrDeps, private readonly computer: SavedHost, options: HerdrOptions) {
  if (!validSize(options.cols, options.rows)) throw new RangeError("PTY dimensions must be between 1 and 1000.");
  this.cols = options.cols; this.rows = options.rows; this.sessionKey = options.sessionKey;
 }
 subscribe(listener: (state: HerdrState) => void): () => void {
  this.observers.add(listener); listener(this.state); return () => { this.observers.delete(listener); };
 }
 /** Exactly one emulator owns output; replacing it invalidates the old unsubscribe. */
 subscribeOutput(listener: (bytes: Uint8Array) => void, reset?: () => void): () => void {
  this.output = listener;
  const replay = this.buffer; this.buffer = new Uint8Array(0);
  if (this.terminalId && this.state.status === "open") {
   reset?.();
   if (this.redrawTimer) clearTimeout(this.redrawTimer);
   const id = this.terminalId;
   this.redrawTimer = setTimeout(() => {
    this.redrawTimer = null;
    if (this.terminalId === id && this.output) this.redraw();
   }, 100);
  } else if (replay.length) listener(replay);
  return () => { if (this.output === listener) this.output = null; };
 }
 async open(): Promise<void> {
  if (this.stopped || !this.active || this.terminalId || this.state.status === "connecting" || this.state.status === "reconnecting" || this.retry) return;
  await this.connect(false);
 }
 private publish(state: HerdrState) { this.state = state; this.observers.forEach(listener => listener(state)); }
 private fail(failure: Failure) {
  this.publish(failure.code === "UNLOCK_REQUIRED"
   ? { status: "unlock-required", reason: failure.message, code: failure.code }
   : { status: "closed", reason: failure.message, code: failure.code });
 }
 private async connect(fresh: boolean): Promise<void> {
  const generation = ++this.generation;
  this.publish({ status: fresh ? "reconnecting" : "connecting" });
  const current = () => generation === this.generation && !this.stopped && this.active;
  try {
   if (fresh) await this.deps.connections.drop(this.computer.id);
   if (!current()) return;
   const connection = await this.deps.connections.connection(this.computer);
   if (!current()) return;
   if (!connection.ok) {
    if (fresh && ["UNREACHABLE", "TIMEOUT", "NOT_CONNECTED", "HOST_NOT_FOUND", "SSH_ERROR"].includes(connection.code)) this.schedule();
    else { this.dropped = false; this.fail(connection); }
    return;
   }
   let path = "herdr";
   this.fallback = true;
   const candidate = (await readHostRecord(this.deps.host, connection.connectionId))?.herdr;
   if (validHerdrPath(candidate) && candidate !== "herdr") { path = candidate; this.fallback = false; }
   if (!current()) return;
   this.openedAt = this.deps.clock();
   const opened = await this.deps.channel.open(connection.connectionId, [path], this.cols, this.rows);
   if (!current()) { if (opened.ok) await this.deps.channel.close(opened.terminalId); return; }
   if (!opened.ok) { if (fresh && ["NOT_CONNECTED", "SSH_ERROR", "TIMEOUT"].includes(opened.code)) this.schedule(); else this.fail(opened); return; }
   this.terminalId = opened.terminalId; this.attempt = 0; this.dropped = false;
   this.publish({ status: "open" });
   const unsubscribe = this.deps.channel.subscribe(opened.terminalId, {
    onOutput: bytes => { if (generation === this.generation && !this.stopped) this.receive(bytes); },
    onExit: exit => { if (generation === this.generation && !this.stopped) this.exited(exit); },
   });
   // Native adapters may replay an exit synchronously during subscription.
   if (this.terminalId === opened.terminalId && current()) {
    this.unsubscribe = unsubscribe;
    // Never await focus: an old/unavailable bridge must not delay or close the PTY.
    if (this.sessionKey && this.deps.focusSession) {
     try { void this.deps.focusSession(this.sessionKey, fresh, current).catch(() => {}); } catch { /* Best effort, including synchronous port failures. */ }
    }
   } else unsubscribe();
  } catch {
   if (current()) { if (fresh) this.schedule(); else this.fail({ ok: false, code: "SSH_ERROR", message: "The terminal could not be opened." }); }
  }
 }
 private receive(bytes: Uint8Array) {
  if (this.output) { this.output(bytes.slice()); return; }
  const cap = 256 * 1024;
  const tail = bytes.slice(-cap);
  const kept = this.buffer.slice(-Math.max(0, cap - tail.length));
  const result = new Uint8Array(Math.min(cap, this.buffer.length + tail.length));
  if (tail.length === cap) result.set(tail);
  else { result.set(kept); result.set(tail, kept.length); }
  this.buffer = result;
 }
 private exited(exit: TerminalExit) {
  // The adapter dropped output it kept before a view attached: not an exit. A size change makes Herdr redraw.
  if (exit.reason === "overflow") { this.redraw(); return; }
  if (this.redrawTimer) clearTimeout(this.redrawTimer); this.redrawTimer = null;
  this.terminalId = null; this.unsubscribe?.(); this.unsubscribe = null;
  if (exit.exitStatus === null && ["disconnected", "connection_closed", "channel_closed"].includes(exit.reason)) {
   this.dropped = true; this.publish({ status: "reconnecting" }); this.schedule();
  } else { this.dropped = false; this.stopped = true; this.publish({ status: "closed", reason: this.fallback && exit.exitStatus !== null && exit.exitStatus !== 0 && this.deps.clock() - this.openedAt <= 2000
   ? "HERDR_NOT_FOUND" : exit.exitStatus === 0 ? "Herdr se cerró" : exit.reason }); }
 }
 private redraw() {
  const id = this.terminalId;
  if (!id) return;
  void this.deps.channel.resize(id, this.cols, this.rows === 1 ? 2 : this.rows - 1)
   .then(() => this.terminalId === id ? this.deps.channel.resize(id, this.cols, this.rows) : undefined)
   .catch(() => {});
 }
 private schedule() {
  this.dropped = true; this.publish({ status: "reconnecting" });
  if (!this.active || this.stopped || this.retry) return;
  this.retry = setTimeout(() => { this.retry = null; void this.connect(true); }, backoff[Math.min(this.attempt++, backoff.length - 1)]);
 }
 /** Inactivity pauses retry work, not a healthy terminal; active resumes pending retries. */
 setActive(active: boolean): void {
  if (this.active === active) return;
  this.active = active;
  if (!active) {
   if (this.retry) clearTimeout(this.retry); this.retry = null;
   // Do not invalidate a healthy channel's listeners.
   if (!this.terminalId) ++this.generation;
  } else if (this.dropped) this.schedule();
  else if (!this.stopped && !this.terminalId && this.state.status === "connecting") void this.connect(false);
 }
 async keys(): Promise<HerdrKeys> {
  try {
   const connection = await this.deps.connections.connection(this.computer);
   return connection.ok ? await readHerdrKeys(this.deps.host, connection.connectionId) : parseHerdrKeys(null);
  } catch { return parseHerdrKeys(null); }
 }
 async write(bytes: Uint8Array): Promise<Result> {
  if (!this.terminalId || this.stopped) return offline();
  if (bytes.length > 65536) return { ok: false, message: "A terminal write is limited to 64 KiB." };
  try { return await this.deps.channel.write(this.terminalId, bytes); } catch { return { ok: false, message: "Terminal input could not be sent." }; }
 }
 resize(cols: number, rows: number): Result {
  if (!validSize(cols, rows)) return { ok: false, message: "PTY dimensions must be between 1 and 1000." };
  this.cols = cols; this.rows = rows;
  if (this.resizeTimer) clearTimeout(this.resizeTimer);
  this.resizeTimer = setTimeout(() => {
   this.resizeTimer = null;
   if (this.terminalId) void this.deps.channel.resize(this.terminalId, this.cols, this.rows).catch(() => {});
  }, 100);
  return { ok: true };
 }
 async close(): Promise<void> {
  this.stopped = true; this.dropped = false; ++this.generation;
  if (this.retry) clearTimeout(this.retry); this.retry = null;
  if (this.resizeTimer) clearTimeout(this.resizeTimer); this.resizeTimer = null;
  if (this.redrawTimer) clearTimeout(this.redrawTimer); this.redrawTimer = null;
  const id = this.terminalId; this.terminalId = null; this.unsubscribe?.(); this.unsubscribe = null;
  this.buffer = new Uint8Array(0); this.publish({ status: "closed", reason: "closed" });
  if (id) await this.deps.channel.close(id);
 }
 /** Upload the whole batch before pasting paths at the cursor. Never submit or retry input. */
 async pasteAttachmentPaths(attachments: readonly Attachment[], progress?: UploadProgress): Promise<Result> {
  if (!this.terminalId || this.stopped) return offline();
  if (!attachments.length) return { ok: true };
  if (this.sending) return { ok: false, message: "A paste is already in progress." };
  this.sending = true;
  const id = this.terminalId;
  try {
   let paths: string[] = [];
   if (attachments.length) {
    const connection = await this.deps.connections.connection(this.computer);
    if (!connection.ok) return connection;
    const uploads = await uploadTerminalAttachments({ host: this.deps.host, folder: this.deps.uploadsFolder, connection: async () => connection, clock: this.deps.clock, random: this.deps.random, history: this.deps.history }, attachments, progress);
    if (!uploads.ok) return uploads;
    // The host's absolute folder, in its native form: the agent reads these exact paths.
    const { path, windows } = uploads.folder;
    paths = uploads.names.map(name => {
     const absolute = `${path}${windows ? "\\" : "/"}${name}`;
     return !absolute.includes(" ") ? absolute : windows ? `"${absolute}"` : `'${absolute.replace(/'/g, "'\\''")}'`;
    });
   }
   if (id !== this.terminalId || this.stopped) return offline();
   return await this.write(new TextEncoder().encode(`\x1b[200~${paths.join(" ")}\x1b[201~`));
  } catch { return { ok: false, message: "The paste could not be completed. Keep your draft and try again." }; }
  finally { this.sending = false; }
 }
}

/** xterm default key encodings; DECCKM belongs to the emulator, not this core. */
export function terminalKey(name: string, applicationCursorMode: boolean): Uint8Array {
 const key = name.toLowerCase();
 const cursor: Record<string, string> = { up: "A", down: "B", right: "C", left: "D", home: "H", end: "F" };
 const fixed: Record<string, string> = { esc: "\x1b", tab: "\t", enter: "\r", backspace: "\x7f", pageup: "\x1b[5~", pagedown: "\x1b[6~" };
 const value = /^ctrl\+[a-z]$/.test(key) ? String.fromCharCode(key.charCodeAt(5) - 96)
  : cursor[key] ? `\x1b${applicationCursorMode ? "O" : "["}${cursor[key]}` : fixed[key] ?? "";
 return new TextEncoder().encode(value);
}
