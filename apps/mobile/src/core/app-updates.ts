// Google Play update notice: ask Play at most once per app start and once a day,
// offer its flexible update, then a restart once downloaded. Always silent on failure.
// A running or finished download is restored on every start; the daily limit is for
// the availability check only.

/** What Play reports; any failure is reported as available:false by the adapter. */
export type AppUpdateCheck = { available: boolean; versionCode?: number; downloaded?: boolean };
export type AppUpdateStart = { started: boolean; downloaded: boolean };
/** Where Play's flexible download stands now, whatever the daily check says. */
export type AppInstallProgress = "none" | "downloading" | "downloaded";
/** How a running flexible download ended. */
export type AppInstallEvent = "downloaded" | "failed" | "canceled";

/** Google Play In-App Updates (architecture: AppUpdateSource). */
export interface AppUpdateSource {
 check(): Promise<AppUpdateCheck>;
 /** Shows Play's flexible update prompt; started is false when the user declines. */
 start(): Promise<AppUpdateStart>;
 /** Installs a downloaded update; Play restarts the app. */
 complete(): Promise<void>;
 /** Cheap; also resumes listening when a download is still running. */
 progress(): Promise<AppInstallProgress>;
 onInstallEvent(listener: (event: AppInstallEvent) => void): () => void;
}

export type AppUpdateCheckEntry = { checkedAt: number; available: boolean; versionCode?: number };
/** The last attempt time and answer, so restarts within a day do not ask again. */
export interface AppUpdateCheckStore {
 read(): Promise<AppUpdateCheckEntry | null>;
 write(entry: AppUpdateCheckEntry): Promise<void>;
}

export type AppUpdatePhase = "idle" | "available" | "downloading" | "downloaded";
/** failed: the last download failed; the notice says so and offers «Actualizar» again. */
export type AppUpdateState = { phase: AppUpdatePhase; dismissed: boolean; failed?: true };

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseAppUpdateEntry(text: string): AppUpdateCheckEntry {
 const value: unknown = JSON.parse(text);
 if (!value || typeof value !== "object") throw new Error("Invalid update check");
 const { checkedAt, available, versionCode } = value as Record<string, unknown>;
 if (typeof checkedAt !== "number" || !Number.isFinite(checkedAt) || typeof available !== "boolean") throw new Error("Invalid update check");
 return typeof versionCode === "number" && Number.isSafeInteger(versionCode) ? { checkedAt, available, versionCode } : { checkedAt, available };
}

export class AppUpdates {
 private state: AppUpdateState = { phase: "idle", dismissed: false };
 private readonly listeners = new Set<() => void>();
 private started: Promise<void> | null = null;
 private answering = 0;
 private held: AppInstallEvent | null = null;

 constructor(private readonly deps: { source: AppUpdateSource; store: AppUpdateCheckStore; clock: () => number; build: number | null }) {
  // While Play is still answering, the shown state may be stale: hold the latest event
  // and apply it once the answer is in, so how the download ended wins.
  deps.source.onInstallEvent(event => {
   if (this.answering > 0) this.held = event;
   else this.apply(event);
  });
 }

 snapshot = (): AppUpdateState => this.state;

 subscribe = (listener: () => void): (() => void) => {
  this.listeners.add(listener);
  return () => { this.listeners.delete(listener); };
 };

 /** Once per app start; repeated calls share the first. */
 start(): Promise<void> {
  this.started ??= this.answer(() => this.check()).catch(() => {});
  return this.started;
 }

 async update(): Promise<void> {
  if (this.state.phase !== "available") return;
  await this.answer(async () => {
   try {
    const result = await this.deps.source.start();
    if (result.downloaded) this.set({ phase: "downloaded", dismissed: false });
    else if (result.started && this.state.phase === "available") this.set({ phase: "downloading", dismissed: this.state.dismissed });
   } catch { /* The offer stays; Play may be unavailable right now. */ }
  });
 }

 async restart(): Promise<void> {
  if (this.state.phase !== "downloaded") return;
  try { await this.deps.source.complete(); } catch { /* Keep offering the restart. */ }
 }

 dismiss(): void {
  if (this.state.phase !== "idle") this.set({ ...this.state, dismissed: true });
 }

 private async check(): Promise<void> {
  const { store, source, clock, build } = this.deps;
  const progress = await source.progress().catch(() => "none" as const);
  if (progress !== "none") {
   if (this.state.phase === "idle") this.set({ phase: progress, dismissed: false });
   return;
  }
  const now = clock();
  const last = await store.read();
  if (last && now - last.checkedAt < DAY_MS) {
   // A remembered answer counts only if this build is known to be older.
   if (last.available && build !== null && last.versionCode !== undefined && last.versionCode > build) this.set({ phase: "available", dismissed: false });
   return;
  }
  // Record the attempt first, so failures also use up the day.
  await store.write({ checkedAt: now, available: false });
  let result: AppUpdateCheck;
  try { result = await source.check(); } catch { return; }
  if (!result.available) return;
  await store.write(result.versionCode === undefined ? { checkedAt: now, available: true } : { checkedAt: now, available: true, versionCode: result.versionCode }).catch(() => {});
  if (this.state.phase === "idle") this.set({ phase: result.downloaded ? "downloaded" : "available", dismissed: false });
 }

 private async answer<T>(work: () => Promise<T>): Promise<T> {
  this.answering += 1;
  try { return await work(); } finally {
   this.answering -= 1;
   const event = this.answering === 0 ? this.held : null;
   if (event) { this.held = null; this.apply(event, true); }
  }
 }

 private apply(event: AppInstallEvent, held = false): void {
  if (event === "downloaded") {
   // A download confirmed while Play was answering (start-up included) offers the restart even if those
   // answers said nothing; a stray event with no notice shown is still ignored.
   if (this.state.phase === "available" || this.state.phase === "downloading" || (held && this.state.phase === "idle")) this.set({ phase: "downloaded", dismissed: false });
  } else if (this.state.phase === "downloading") {
   this.set(event === "failed" ? { phase: "available", dismissed: false, failed: true } : { phase: "available", dismissed: false });
   void this.recheck();
  }
 }

 /** After a download ends without the update, ask Play whether it is still offered. */
 private async recheck(): Promise<void> {
  let result: AppUpdateCheck;
  try { result = await this.deps.source.check(); } catch { return; }
  if (this.state.phase !== "available") return;
  if (!result.available) this.set({ phase: "idle", dismissed: false });
  else if (result.downloaded) this.set({ phase: "downloaded", dismissed: false });
 }

 private set(next: AppUpdateState): void {
  this.state = next;
  for (const listener of [...this.listeners]) listener();
 }
}
