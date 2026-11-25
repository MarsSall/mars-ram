// When a first-visit tip may show: its screen is ready, no tour runs, every target is measured and
// nothing has moved for a moment (a keyboard or a sheet still settling). No React Native imports.
import { TIPS, type AppTour, type TipId } from "../../core/tour";
import type { KeyBarMode } from "../../core/key-bar-visibility";
import type { TourAnchorRegistry } from "./anchor-registry";

/** How long the targets must stay put before the tip shows. */
export const TIP_SETTLE_MS = 700;
/** Tips shown by the root layer, over the terminal and its sheets; the selector's shows inside its Modal. */
export const ROOT_TIPS: readonly TipId[] = ["terminal", "chatFloating", "projectSheet", "keyBarTab", "approval"];
export const MODAL_TIPS: readonly TipId[] = ["sessionSelector"];

/** Which of the terminal screen's tips may show: none under another overlay, the terminal's own only with nothing open. */
export function terminalTips(s: { focused: boolean; chatOpen: boolean; switcherOpen: boolean; sheetOpen: boolean; serverOpen: boolean; modelOpen: boolean }): Record<"terminal" | "chatFloating" | "projectSheet", boolean> {
 const free = s.focused && !s.switcherOpen && !s.serverOpen && !s.modelOpen;
 return { terminal: free && !s.chatOpen && !s.sheetOpen, chatFloating: free && s.chatOpen && !s.sheetOpen, projectSheet: free && s.sheetOpen };
}

/** The key bar tab's tip: when the terminal's own tip could show and the tab is drawn (a hidden mode with its slot). */
export const keyBarTabTip = (terminalFree: boolean, mode: KeyBarMode, hasSlot: boolean): boolean => terminalFree && mode !== "always" && hasSlot;

/** The approval's tip: a focused screen with no overlay over it and a pending approval that has buttons. */
export const approvalTip = (s: { focused: boolean; overlay: boolean; pending: number; canAnswer: boolean }): boolean => s.focused && !s.overlay && s.pending > 0 && s.canAnswer;

type Tour = Pick<AppTour, "claimTip" | "releaseTip" | "shownTip" | "isRunning" | "subscribe">;
type Registry = Pick<TourAnchorRegistry, "rect" | "measure" | "subscribe">;
/** settling: waiting for the targets to stay put; claiming: asked the tour; done: seen or dismissed. */
type Phase = "idle" | "settling" | "claiming" | "shown" | "done";

export class TipGate {
 private ready = false;
 private phase: Phase = "idle";
 private timer: ReturnType<typeof setTimeout> | null = null;
 private placed = "";
 private readonly offs: (() => void)[];

 constructor(private readonly id: TipId, private readonly deps: { tour: Tour; registry: Registry }) {
  this.offs = [deps.tour.subscribe(() => this.update()), deps.registry.subscribe(() => this.update())];
 }

 /** The screen can show this tip now (open, focused, no other overlay over it). */
 setReady(ready: boolean): void {
  if (ready === this.ready) return;
  this.ready = ready;
  if (ready) for (const anchor of TIPS[this.id].anchors) this.deps.registry.measure(anchor);
  this.update();
 }

 /** The keyboard moved the screen: wait for it to settle again. */
 moved(): void { if (this.phase === "settling") this.settle(); }

 /** The screen left: a tip on screen goes away unrecorded. */
 stop(): void {
  for (const off of this.offs) off();
  this.clear();
  const shown = this.phase === "shown" || this.phase === "claiming";
  this.phase = "done";
  if (shown) this.deps.tour.releaseTip(this.id);
 }

 /** Where the targets are, or null while any of them is not on screen. */
 private where(): string | null {
  const rects = TIPS[this.id].anchors.map(anchor => this.deps.registry.rect(anchor));
  return rects.every(Boolean) ? JSON.stringify(rects) : null;
 }

 private update(): void {
  if (this.phase === "done") return;
  if (this.phase === "shown") {
   // «Entendido», or the tour took over: this screen does not ask again.
   if (this.deps.tour.shownTip() !== this.id) { this.phase = "done"; return; }
   if (!this.ready || this.where() === null) { this.phase = "idle"; this.deps.tour.releaseTip(this.id); }
   return;
  }
  const where = this.ready && !this.deps.tour.isRunning() ? this.where() : null;
  if (where === null) { this.clear(); this.phase = this.phase === "claiming" ? "claiming" : "idle"; this.placed = ""; return; }
  if (this.phase === "claiming") return;
  if (this.phase === "idle" || where !== this.placed) { this.placed = where; this.settle(); }
 }

 private settle(): void {
  this.clear();
  this.phase = "settling";
  this.timer = setTimeout(() => { this.timer = null; void this.claim(); }, TIP_SETTLE_MS);
 }

 private async claim(): Promise<void> {
  this.phase = "claiming";
  const result = await this.deps.tour.claimTip(this.id);
  if (this.phase !== "claiming") {
   // Stopped while asking.
   if (result === "shown") this.deps.tour.releaseTip(this.id);
   return;
  }
  if (result === "seen") { this.phase = "done"; return; }
  if (result === "wait") { this.phase = "idle"; this.placed = ""; return; }
  this.phase = "shown";
  // The screen changed while asking.
  this.update();
 }

 private clear(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}
