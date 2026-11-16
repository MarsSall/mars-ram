// Guided tour over the real screens and first-visit tips. No invented data: each step
// points at a real control, or only explains it when that control needs a session.
import type { SavedHost } from "./host-catalog";
import { groupSessions, type ComputerSessions } from "./session-list";

export type TourScreen = "home" | "computers" | "files" | "settings" | "terminal";
export type TourAnchorId =
 | "home.sessions" | "home.openTerminal" | "tabs.bar" | "terminal.project" | "terminal.selector" | "computers.add" | "files.createLink" | "settings.notifications" | "settings.about"
 | "terminal.chatHandle" | "terminal.prefix" | "chat.composer" | "projectSheet.tabs" | "selector.list";
export type TourStepId = "sessions" | "openTerminal" | "tabs" | "diffs" | "selector" | "addComputer" | "createLink" | "notifications" | "about" | "done";
/** navigate: the tap reaches the real control; action: the tap only advances; finish: «Empezar» closes. */
export type TourStepKind = "navigate" | "action" | "finish";
/** Which «Tocá … para seguir» hint the bubble shows. */
export type TourHint = "area" | "bar" | "control" | "card";

export type TourStep = {
 id: TourStepId;
 screen: TourScreen;
 /** Tab route to show; null for the open session's terminal. */
 route: "/" | "/computers" | "/files" | "/settings" | null;
 anchor: TourAnchorId | null;
 kind: TourStepKind;
 hint: TourHint | null;
 /** Needs an open session's terminal; without one the step only explains. */
 needsSession: boolean;
 /** Left out of a run when its anchor is not registered as the tour starts (a control this build may not have). */
 optional: boolean;
};

const step = (id: TourStepId, screen: TourScreen, route: TourStep["route"], anchor: TourAnchorId | null, kind: TourStepKind, hint: TourHint | null, extra: { needsSession?: boolean; optional?: boolean } = {}): TourStep =>
 ({ id, screen, route, anchor, kind, hint, needsSession: extra.needsSession ?? false, optional: extra.optional ?? false });

/** Inicio's «Abrir terminal» tile; wrap it with `<TourAnchor id={HOME_OPEN_TERMINAL}>` to add its step. */
export const HOME_OPEN_TERMINAL = "home.openTerminal" satisfies TourAnchorId;

export const TOUR_STEPS: readonly TourStep[] = [
 step("sessions", "home", "/", "home.sessions", "action", "area"),
 step("openTerminal", "home", "/", HOME_OPEN_TERMINAL, "action", "control", { optional: true }),
 step("tabs", "home", "/", "tabs.bar", "navigate", "bar"),
 step("diffs", "terminal", null, "terminal.project", "action", "control", { needsSession: true }),
 step("selector", "terminal", null, "terminal.selector", "action", "control", { needsSession: true }),
 step("addComputer", "computers", "/computers", "computers.add", "action", "control"),
 step("createLink", "files", "/files", "files.createLink", "action", "control"),
 step("notifications", "settings", "/settings", "settings.notifications", "action", "card"),
 step("about", "settings", "/settings", "settings.about", "action", "card"),
 step("done", "home", "/", null, "finish", null),
];

/** A tour in progress over its steps; hasSession is settled before the first session step (AppTour.begin). */
export type TourRun = { steps: readonly TourStep[]; index: number; hasSession: boolean };
export type TourPresentation = {
 step: TourStep;
 number: number;
 total: number;
 /** target: ring the anchor; explain: no target, «Siguiente»; finish: «Empezar». */
 mode: "target" | "explain" | "finish";
 anchor: TourAnchorId | null;
 /** Screen to show for this step; explain-only steps show Inicio. */
 screen: TourScreen;
};

/** available: whether an anchor is registered now; optional steps without it are left out, and the count follows. */
export const startRun = (options: { hasSession: boolean; available?: (anchor: TourAnchorId) => boolean }): TourRun => ({
 steps: TOUR_STEPS.filter(s => !s.optional || (s.anchor !== null && (options.available?.(s.anchor) ?? false))),
 index: 0, hasSession: options.hasSession,
});
export const advanceRun = (run: TourRun): TourRun | null => run.index + 1 < run.steps.length ? { ...run, index: run.index + 1 } : null;

export function presentStep(run: TourRun): TourPresentation {
 const current = run.steps[run.index];
 const base = { step: current, number: run.index + 1, total: run.steps.length };
 if (current.kind === "finish") return { ...base, mode: "finish", anchor: null, screen: current.screen };
 // Nothing is opened: explained on Inicio, whatever tab the previous step's tap opened.
 if (current.needsSession && !run.hasSession) return { ...base, mode: "explain", anchor: null, screen: "home" };
 return { ...base, mode: "target", anchor: current.anchor, screen: current.screen };
}

export type TipId = "terminal" | "chatFloating" | "projectSheet" | "sessionSelector";
export const TIP_IDS: readonly TipId[] = ["terminal", "chatFloating", "projectSheet", "sessionSelector"];
/** Each tip's targets, numbered in the bubble when there is more than one. */
export const TIPS: Record<TipId, { anchors: TourAnchorId[] }> = {
 terminal: { anchors: ["terminal.chatHandle", "terminal.prefix"] },
 chatFloating: { anchors: ["chat.composer"] },
 projectSheet: { anchors: ["projectSheet.tabs"] },
 sessionSelector: { anchors: ["selector.list"] },
};

export type TipClaim = "shown" | "wait" | "seen";

export type TourFlags = { tourSeen: boolean; tips: TipId[] };
/** none: no file; damaged: a file exists but cannot be read. */
export type TourFlagsRecord = { kind: "none" } | { kind: "damaged" } | { kind: "saved"; flags: TourFlags };

/** The tour seen and each tip seen (architecture: TourFlagsStore). */
export interface TourFlagsStore {
 read(): Promise<TourFlagsRecord>;
 write(flags: TourFlags): Promise<void>;
}

/** A damaged file may hold the tour's record, so the tour stays seen; its tips may show once more. */
export function effectiveFlags(record: TourFlagsRecord): TourFlags {
 if (record.kind === "none") return { tourSeen: false, tips: [] };
 if (record.kind === "damaged") return { tourSeen: true, tips: [] };
 return { tourSeen: record.flags.tourSeen, tips: [...record.flags.tips] };
}

/** Once, after the first computer is saved; «Ver tutorial» starts it regardless. */
export const shouldStartAfterPairing = (savedHostsBefore: number, flags: TourFlags) => savedHostsBefore === 0 && !flags.tourSeen;

/** Wraps a pairing or manual add: counts the saved computers before it, so the tour starts once after the first (S1). */
export async function pairAndCheckTour<R extends { ok: boolean }>(deps: { savedHosts: () => Promise<number>; tour: Pick<AppTour, "shouldStartAfterPairing"> }, run: () => Promise<R>): Promise<{ result: R; startTour: boolean }> {
 // An unknown count never shows the tour to someone who already had computers.
 const before = await deps.savedHosts().catch(() => null);
 const result = await run();
 return { result, startTour: result.ok && before !== null && await deps.tour.shouldStartAfterPairing(before) };
}

/** The session whose terminal steps 3-4 open. */
export type TourSession = { key: string; project: string; cwd: string; computer: string };

/** The first session in Inicio's order (those that need you first) that runs in a terminal (Herdr); null explains steps 3-4. */
export function tourSession(hosts: Pick<SavedHost, "id" | "name">[], computers: ComputerSessions[]): TourSession | null {
 const names = new Map(hosts.map(host => [host.id, host.name]));
 const groups = groupSessions({ computers: [], needsYou: [], groupOrder: {} }, computers, "focus");
 // Like the session screen's «Terminal» button: `terminal` is enough, a bridge from before terminalPane still drives its pane.
 const found = [...groups.needsYou, ...groups.computers.flatMap(computer => computer.sessions)].find(s => (s.terminal === true || s.terminalPane !== undefined) && names.has(s.hostId));
 return found ? { key: found.key, project: found.project, cwd: found.cwd, computer: names.get(found.hostId)! } : null;
}

export type TourListing = { hosts: Pick<SavedHost, "id" | "name">[]; computers: ComputerSessions[] };

/**
 * The session for steps 3-4: from the sessions Inicio already shows when one runs in a terminal, so the
 * answer is there before the user reaches step 3; otherwise from a new list, given up after timeoutMs.
 */
export async function findTourSession(deps: { shown: () => TourListing | null; list: () => Promise<TourListing>; timeoutMs: number; wait: (ms: number) => Promise<void> }): Promise<TourSession | null> {
 const shown = deps.shown();
 const found = shown ? tourSession(shown.hosts, shown.computers) : null;
 if (found) return found;
 return Promise.race([
  deps.list().then(listed => tourSession(listed.hosts, listed.computers), () => null),
  deps.wait(deps.timeoutMs).then(() => null),
 ]);
}

/** Throws on anything that is not a record; unknown tip ids are dropped. */
export function parseTourFlags(text: string): TourFlags {
 const value: unknown = JSON.parse(text);
 if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tour flags are not a record.");
 const record = value as Record<string, unknown>;
 const tips = Array.isArray(record.tips) ? record.tips.filter((id): id is TipId => TIP_IDS.includes(id as TipId)) : [];
 return { tourSeen: record.tourSeen === true, tips: [...new Set(tips)] };
}

export class AppTour {
 private flags: TourFlags | null = null;
 private loading: Promise<TourFlags> | null = null;
 private run: TourRun | null = null;
 private presented: TourPresentation | null = null;
 private target: TourSession | null = null;
 private tip: TipId | null = null;
 private anchors: { has(id: TourAnchorId): boolean } | null = null;
 /** The session lookup of the current run while it has not answered. */
 private lookup: Promise<void> | null = null;
 private waiting = false;
 private starts = 0;
 private readonly listeners = new Set<() => void>();

 constructor(private readonly deps: { store: TourFlagsStore }) {}

 /** For useSyncExternalStore: the current step, or null when no tour runs; the same object until it changes. */
 current(): TourPresentation | null { return this.presented; }
 /** The session steps 3-4 open, while the tour runs. */
 session(): TourSession | null { return this.run ? this.target : null; }
 isRunning(): boolean { return this.run !== null; }
 subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

 /** The registry of the controls on screen; optional steps whose control is not registered are left out. */
 attachAnchors(anchors: { has(id: TourAnchorId): boolean }): void { this.anchors = anchors; }

 async shouldStartAfterPairing(savedHostsBefore: number): Promise<boolean> {
  return shouldStartAfterPairing(savedHostsBefore, await this.load());
 }

 /** After the first pairing or on demand from Ajustes › Acerca de › «Ver tutorial». A tip on screen goes away unrecorded. */
 start(options: { hasSession: boolean }): void { this.starts++; this.target = null; this.tip = null; this.lookup = null; this.waiting = false; this.show(startRun({ ...options, available: id => this.anchors?.has(id) ?? false })); }

 /**
  * Shows step 1 at once and looks up the session for steps 3-4 meanwhile. Step 3 waits for a lookup
  * still running (find gives up on its own, services: 5 s); no session or a failed lookup leaves them explain-only.
  */
 async begin(find: () => Promise<TourSession | null>): Promise<void> {
  this.start({ hasSession: false });
  const started = this.starts;
  const lookup = find().catch(() => null).then(session => {
   if (started !== this.starts) return;
   this.lookup = null;
   // Ended, restarted, or already explaining step 3: keep what the user sees.
   if (!session || !this.run || this.run.index >= this.run.steps.findIndex(s => s.needsSession)) return;
   this.target = session;
   this.show({ ...this.run, hasSession: true });
  });
  this.lookup = lookup;
  await lookup;
 }

 /** The highlighted control was tapped, or «Siguiente»/«Empezar»; the last step finishes. */
 async advance(): Promise<void> {
  if (!this.run || this.waiting) return;
  const next = advanceRun(this.run);
  if (!next) return this.finish();
  if (next.steps[next.index].needsSession && this.lookup) {
   // Taps meanwhile are ignored: the step stays until the lookup answers.
   const started = this.starts;
   this.waiting = true;
   await this.lookup;
   if (started !== this.starts) return;
   this.waiting = false;
   if (!this.run) return;
   this.show({ ...this.run, index: next.index });
   return;
  }
  this.show(next);
 }

 skip(): Promise<void> { return this.finish(); }

 async finish(): Promise<void> {
  const wasRunning = this.run !== null;
  this.target = null;
  if (wasRunning) this.show(null);
  await this.record(flags => ({ ...flags, tourSeen: true }));
 }

 async shouldShowTip(id: TipId): Promise<boolean> {
  if (this.run) return false;
  const flags = await this.load();
  return !this.run && !flags.tips.includes(id);
 }

 /** The first-visit tip on screen; one at a time, never with the tour. */
 shownTip(): TipId | null { return this.tip; }

 /**
  * A screen whose targets are measured and settled asks to show its tip. wait: the tour runs or
  * another tip is on screen, ask again when that changes; seen: it never shows again.
  */
 async claimTip(id: TipId): Promise<TipClaim> {
  const seen = (await this.load()).tips.includes(id);
  if (seen) return "seen";
  if (this.run || (this.tip !== null && this.tip !== id)) return "wait";
  if (this.tip !== id) { this.tip = id; this.emit(); }
  return "shown";
 }

 /** Its screen left or its targets went away before «Entendido»: hide it without recording it. */
 releaseTip(id: TipId): void {
  if (this.tip !== id) return;
  this.tip = null;
  this.emit();
 }

 /** «Entendido»: this tip does not come back. */
 dismissTip(id: TipId): Promise<void> {
  this.releaseTip(id);
  return this.record(flags => flags.tips.includes(id) ? flags : { ...flags, tips: [...flags.tips, id] });
 }

 private load(): Promise<TourFlags> {
  if (this.flags) return Promise.resolve(this.flags);
  this.loading ??= this.deps.store.read().then(effectiveFlags, () => effectiveFlags({ kind: "damaged" })).then(read => {
   // Anything recorded while reading wins: flags only ever turn on.
   this.flags = this.flags ? merge(read, this.flags) : read;
   return this.flags;
  });
  return this.loading;
 }

 private async record(change: (flags: TourFlags) => TourFlags): Promise<void> {
  const flags = change(await this.load());
  this.flags = merge(this.flags ?? flags, flags);
  try { await this.deps.store.write(this.flags); } catch { /* Kept for this run; never block the app. */ }
 }

 private show(run: TourRun | null) {
  this.run = run;
  this.presented = run ? presentStep(run) : null;
  this.emit();
 }

 private emit() { for (const listener of [...this.listeners]) listener(); }
}

const merge = (a: TourFlags, b: TourFlags): TourFlags => ({ tourSeen: a.tourSeen || b.tourSeen, tips: [...new Set([...a.tips, ...b.tips])] });
