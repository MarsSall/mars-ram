// On-device dictation (odd/tasks/voice-dictation.md): the gesture, the text it produces, and the
// model it needs. Pure: recording, the model file and transcription live in the adapter.

/** Hold to talk; a double tap locks recording until the next tap (S3). */
export type DictationState =
 | { phase: "idle"; hint?: boolean }
 | { phase: "holding"; since: number }
 | { phase: "tapped"; since: number; until: number }
 | { phase: "locked"; since: number; armed: boolean }
 | { phase: "transcribing" };
/** abort: the app left the foreground; any recording is dropped, a transcription may finish. */
export type DictationEvent = { type: "pressIn" | "pressOut" | "tick" | "done" | "abort"; now: number };
/** start: open the microphone; transcribe: stop and transcribe; cancel: stop and drop the audio. */
export type DictationEffect = "start" | "transcribe" | "cancel";

export const HOLD_MS = 300;
export const DOUBLE_TAP_MS = 300;
export const MAX_RECORDING_MS = 120_000;

export function dictationReduce(state: DictationState, { type, now }: DictationEvent): { state: DictationState; effects?: DictationEffect[] } {
 if (type === "abort") return state.phase === "holding" || state.phase === "tapped" || state.phase === "locked" ? { state: { phase: "idle" }, effects: ["cancel"] } : { state };
 switch (state.phase) {
  case "idle":
   return type === "pressIn" ? { state: { phase: "holding", since: now }, effects: ["start"] } : { state };
  case "holding":
   if (type === "pressOut") return now - state.since >= HOLD_MS ? { state: { phase: "transcribing" }, effects: ["transcribe"] } : { state: { phase: "tapped", since: state.since, until: now + DOUBLE_TAP_MS } };
   if (type === "tick" && now - state.since > MAX_RECORDING_MS) return { state: { phase: "transcribing" }, effects: ["transcribe"] };
   return { state };
  case "tapped":
   // The microphone keeps running through the window, so a locked dictation loses no words.
   if (type === "pressIn") return now <= state.until ? { state: { phase: "locked", since: state.since, armed: false } } : { state: { phase: "holding", since: now }, effects: ["cancel", "start"] };
   if (type === "tick" && now > state.until) return { state: { phase: "idle", hint: true }, effects: ["cancel"] };
   return { state };
  case "locked":
   // The release of the tap that locked only arms the stop; the next tap's release stops.
   if (type === "pressOut") return state.armed ? { state: { phase: "transcribing" }, effects: ["transcribe"] } : { state: { ...state, armed: true } };
   if (type === "tick" && now - state.since > MAX_RECORDING_MS) return { state: { phase: "transcribing" }, effects: ["transcribe"] };
   return { state };
  case "transcribing":
   return type === "done" ? { state: { phase: "idle" } } : { state };
 }
}

/** Dictation joins the draft after one space; the transcript itself is trimmed. */
export function appendDictation(draft: string, transcript: string): string {
 const text = transcript.trim();
 if (!text) return draft;
 return !draft || /\s$/.test(draft) ? draft + text : `${draft} ${text}`;
}
/** Typed at the prompt as one bracketed paste: line breaks become spaces, control bytes are
 * dropped (so the text can never close the paste or press Enter). */
export function terminalDictation(transcript: string): Uint8Array {
 // A command, not a sentence: no final period, and a Capitalized first word goes lower case
 // («Git status.» → git status); all-caps words like README stay.
 const text = latinize(transcript).replace(/\r\n|[\r\n]/g, " ").replace(/[\x00-\x1f\x7f-\x9f]/g, "").trim()
  .replace(/\.+$/, "").replace(/^(\p{Lu})(\p{Ll}*)(?=\s|$)/u, (_m, first: string, rest: string) => first.toLowerCase() + rest);
 return text ? new TextEncoder().encode(`\x1b[200~${text}\x1b[201~`) : new Uint8Array(0);
}
/** 16 kHz mono signed 16-bit PCM, as Parakeet expects. */
export function joinPcm(chunks: readonly Uint8Array[]): { pcm: Uint8Array; seconds: number } {
 const pcm = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let at = 0;
 for (const chunk of chunks) { pcm.set(chunk, at); at += chunk.length; }
 return { pcm, seconds: pcm.length / 32000 };
}
export function formatElapsed(ms: number): string {
 const s = Math.max(0, Math.floor(ms / 1000));
 return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Parakeet TDT 0.6B v3, q4_0 (L5, L14), pinned to an immutable revision of ggml-org/parakeet-GGUF;
 * size and MD5 are checked after download (SHA-256 aa7fe2f5…dad45e matches the published LFS oid). */
export const DICTATION_MODEL = {
 url: "https://huggingface.co/ggml-org/parakeet-GGUF/resolve/35156454d1a39de06863303dd209fd2bed6ee079/ggml-parakeet-tdt-0.6b-v3-q4_0.bin",
 fileName: "ggml-parakeet-tdt-0.6b-v3-q4_0.bin",
 bytes: 355615679,
 md5: "6c789286c397aff3cd62c7cc48de3775",
} as const;
export function modelReady(info: { exists: boolean; size?: number; md5?: string }): boolean {
 return info.exists && info.size === DICTATION_MODEL.bytes && info.md5 === DICTATION_MODEL.md5;
}

// Parakeet guesses the language and sometimes writes short English commands in Cyrillic
// («Гит статус»): such output is spelled with Latin letters (L14).
const CYRILLIC: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya", і: "i", ї: "yi", є: "ye", ґ: "g" };
export function latinize(text: string): string {
 if (!/[\u0400-\u04ff]/.test(text)) return text;
 const chars = [...text];
 return chars.map((ch, i) => {
  const lower = ch.toLowerCase(); const latin = CYRILLIC[lower];
  if (latin === undefined) return ch;
  if (ch === lower) return latin;
  // An upper-case letter in an all-caps word stays all caps (ПУШ → PUSH), otherwise Capitalized.
  const caps = [chars[i - 1], chars[i + 1]].some(n => n !== undefined && /[\u0400-\u04ff]/.test(n) && n !== n.toLowerCase());
  return caps ? latin.toUpperCase() : latin.charAt(0).toUpperCase() + latin.slice(1);
 }).join("");
}

export type DictationStep = "stopping" | "loading" | "transcribing";
/** Port for the on-device engine (adapters/parakeet-dictation.ts). */
/** BUSY: another mic owns the recorder; CANCELLED: its owner cancelled while it was starting. */
export type DictationFailure = "PERMISSION" | "NO_MODEL" | "NO_AUDIO" | "DOWNLOAD_FAILED" | "ENGINE_FAILED" | "BUSY" | "CANCELLED";
/** The model's system download (Android's DownloadManager): it outlives the sheet, the screen and
 * the app. waiting: queued or paused by the system (no network yet, retrying). failed: it failed or
 * the file did not match (DOWNLOAD_FAILED); reported once, then it is gone. */
export type ModelDownloadStatus =
 | { state: "none" }
 | { state: "downloading"; written: number; total: number; waiting: boolean }
 | { state: "ready" }
 | { state: "failed" };
export interface DictationEngine {
 /** Also finishes a download that completed while the app was closed. */
 modelReady(): Promise<boolean>;
 /** Loads the model ahead of the first press (no-op when missing or loaded). */
 warm(): Promise<void>;
 /** Starts the system download with this notification text, or attaches to the one already
 * running: never a second one. */
 download(notice: { title: string; description: string }): Promise<ModelDownloadStatus>;
 /** Where the system download stands; a finished one is verified (size and MD5) and put in place
 * first (ready), a mismatching one is deleted (failed). */
 downloadStatus(): Promise<ModelDownloadStatus>;
 /** The explicit «Cancelar descarga»: stops the system download and deletes what it wrote. */
 cancelDownload(): Promise<void>;
 removeModel(): Promise<void>;
 /** Asks for the microphone if needed, then records 16 kHz mono PCM for `owner` until it stops or
  * cancels. One owner at a time: another mic gets BUSY; a cancel during start-up wins. */
 start(owner: symbol): Promise<{ ok: true } | { ok: false; code: DictationFailure }>;
 /** Closes the microphone and drops the audio, if `owner` holds it (also during start-up). */
 cancel(owner: symbol): Promise<void>;
 /** Stops a transcription that outlived its time limit. */
 abortTranscription(): Promise<void>;
 /** Stops `owner`'s recording and transcribes what was heard, reporting each step. */
 finish(owner: symbol, step?: (step: DictationStep, seconds?: number) => void): Promise<{ ok: true; text: string; seconds: number } | { ok: false; code: DictationFailure }>;
}

export type ModelDownloadView =
 | { phase: "checking" }
 | { phase: "missing"; failed: boolean }
 | { phase: "downloading"; written: number; total: number; waiting: boolean }
 | { phase: "ready" };

/** What the sheet and the Settings card show of the model download (one for the app). Leaving
 * never cancels: watchers only subscribe, and progress is polled while someone watches. Engine
 * calls run one at a time, so a cancel pressed during the start removes what the start began. */
export class ModelDownload {
 view: ModelDownloadView = { phase: "checking" };
 private listeners = new Set<() => void>();
 private queue: Promise<void> = Promise.resolve();
 private timer: ReturnType<typeof setTimeout> | null = null;
 constructor(private readonly engine: DictationEngine, private readonly pollMs = 1000) {}
 readonly snapshot = (): ModelDownloadView => this.view;
 readonly subscribe = (listener: () => void): (() => void) => {
  // A new watcher (the sheet reopened, Settings shown) sees the download as it is now.
  this.listeners.add(listener); void this.refresh();
  return () => { this.listeners.delete(listener); if (!this.listeners.size) this.stopPolling(); };
 };
 refresh(): Promise<void> {
  return this.run(async () => {
   const status = await this.engine.downloadStatus().catch((): ModelDownloadStatus => ({ state: "none" }));
   if (status.state !== "none") return this.apply(status);
   const ready = await this.engine.modelReady().catch(() => false);
   this.set(ready ? { phase: "ready" } : { phase: "missing", failed: this.view.phase === "missing" && this.view.failed });
  });
 }
 start(notice: { title: string; description: string }): Promise<void> {
  return this.run(async () => this.apply(await this.engine.download(notice).catch((): ModelDownloadStatus => ({ state: "failed" }))));
 }
 cancel(): Promise<void> {
  return this.run(async () => { await this.engine.cancelDownload().catch(() => {}); this.set({ phase: "missing", failed: false }); });
 }
 private run(job: () => Promise<void>): Promise<void> {
  const next = this.queue.then(job, job);
  this.queue = next.catch(() => {});
  return next;
 }
 private apply(status: ModelDownloadStatus) {
  if (status.state === "downloading") this.set({ phase: "downloading", written: status.written, total: status.total, waiting: status.waiting });
  else if (status.state === "ready") this.set({ phase: "ready" });
  else this.set({ phase: "missing", failed: status.state === "failed" });
 }
 private set(view: ModelDownloadView) {
  this.view = view;
  for (const listener of [...this.listeners]) listener();
  this.stopPolling();
  if (view.phase === "downloading" && this.listeners.size) this.timer = setTimeout(() => { this.timer = null; void this.refresh(); }, this.pollMs);
 }
 private stopPolling() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}

/** Runs the gesture's effects against the engine for one mic (the hook in ui/dictation.tsx is a
 * thin wrapper). Cancellation never waits behind a start-up: every cancel, abort or dispose bumps
 * `epoch`, which voids queued starts and late results (verify mvyl83hd-d-kw31 H1–H4). */
export class DictationRunner {
 state: DictationState = { phase: "idle" };
 error: DictationFailure | null = null;
 stalled: DictationStep | null = null;
 step: { step: DictationStep; seconds?: number } | null = null;
 took: number | null = null;
 needsModel = false;
 now = Date.now();
 private readonly owner = Symbol("mic");
 private epoch = 0;
 private queue: Promise<void> = Promise.resolve();
 private ticker: ReturnType<typeof setInterval> | null = null;
 private listeners = new Set<() => void>();
 private disposed = false;
 constructor(private readonly engine: DictationEngine, private readonly deliver: (text: string) => void, private readonly limitMs = 30_000) {}
 subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
 private changed() { if (!this.disposed) for (const listener of this.listeners) listener(); }
 get elapsed(): number { const s = this.state; return s.phase === "holding" || s.phase === "tapped" || s.phase === "locked" ? this.now - s.since : 0; }
 dispatch(event: DictationEvent) {
  if (this.disposed) return;
  // Leaving the foreground also drops a dictation already released: its start-up may still be
  // pending (the mic could open in the background) and its text is not wanted any more.
  if (event.type === "abort" && this.state.phase === "transcribing") {
   this.epoch++; void this.engine.cancel(this.owner); void this.engine.abortTranscription();
   this.state = { phase: "idle" }; this.step = null; this.track(); this.changed(); return;
  }
  const next = dictationReduce(this.state, event);
  this.state = next.state;
  for (const effect of next.effects ?? []) {
   if (effect === "cancel") { this.epoch++; void this.engine.cancel(this.owner); continue; } // At once, never queued.
   const epoch = this.epoch;
   this.queue = this.queue.then(() => this.run(effect, epoch)).catch(() => {
    if (epoch !== this.epoch) return;
    this.error = "ENGINE_FAILED"; this.state = { phase: "idle" }; void this.engine.cancel(this.owner); this.track(); this.changed();
   });
  }
  this.track(); this.changed();
 }
 /** The mic left the screen: drop its recording and anything still on its way. */
 dispose() {
  this.epoch++; this.disposed = true; this.stopTicker(); void this.engine.cancel(this.owner);
  if (this.state.phase === "transcribing") void this.engine.abortTranscription(); // Its owner is gone.
 }
 clearNotice() { this.error = null; this.stalled = null; this.took = null; if (this.state.phase === "idle") this.state = { phase: "idle" }; this.changed(); }
 closeModel() { this.needsModel = false; this.changed(); }
 private track() {
  const recording = this.state.phase === "holding" || this.state.phase === "tapped" || this.state.phase === "locked";
  if (recording && !this.ticker) this.ticker = setInterval(() => { this.now = Date.now(); this.dispatch({ type: "tick", now: this.now }); }, 100);
  if (!recording) this.stopTicker();
 }
 private stopTicker() { if (this.ticker) clearInterval(this.ticker); this.ticker = null; }
 private async run(effect: DictationEffect, epoch: number) {
  if (epoch !== this.epoch) return; // Cancelled before its turn came.
  if (effect === "start") {
   this.error = null; this.took = null;
   const started = await this.engine.start(this.owner);
   if (epoch !== this.epoch) { if (started.ok) void this.engine.cancel(this.owner); return; }
   if (!started.ok) {
    if (started.code === "CANCELLED") return;
    this.state = { phase: "idle" };
    if (started.code === "NO_MODEL") this.needsModel = true; else this.error = started.code;
    this.track(); this.changed();
   }
   return;
  }
  // transcribe: bounded, and voided if the owner leaves meanwhile.
  this.step = null; this.changed();
  let last: DictationStep = "stopping"; const began = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">(resolve => { timer = setTimeout(() => resolve("timeout"), this.limitMs); });
  const result = await Promise.race([this.engine.finish(this.owner, (s, seconds) => { last = s; this.step = { step: s, seconds }; this.changed(); }), timeout])
   .catch(() => ({ ok: false as const, code: "ENGINE_FAILED" as const }))
   .finally(() => clearTimeout(timer));
  const current = epoch === this.epoch;
  if (result === "timeout") {
   // A stalled native job is stopped even when nobody waits for its text any more.
   if (!current) { void this.engine.abortTranscription(); return; }
   this.epoch++; await this.engine.abortTranscription();
   this.error = "ENGINE_FAILED"; this.stalled = last;
  } else {
   if (!current) return; // Cancelled, backgrounded or unmounted meanwhile: the text is not wanted.
   if (result.ok) { this.deliver(result.text); this.took = Math.round((Date.now() - began) / 100) / 10; }
   else if (result.code !== "CANCELLED") this.error = result.code;
  }
  this.step = null;
  this.state = dictationReduce(this.state, { type: "done", now: Date.now() }).state;
  this.changed();
 }
}
