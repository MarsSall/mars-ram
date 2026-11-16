// Where each tour target is on screen, in window coordinates. No React Native imports.
import type { TourAnchorId } from "../../core/tour";

export type Rect = { x: number; y: number; width: number; height: number };
/** Reports the control's window rect, for example through View.measureInWindow. */
export type Measure = (done: (rect: Rect) => void) => void;

const same = (a: Rect | undefined, b: Rect | undefined) => a?.x === b?.x && a?.y === b?.y && a?.width === b?.width && a?.height === b?.height;

export class TourAnchorRegistry {
 private readonly measures = new Map<TourAnchorId, { measure: Measure }>();
 private readonly rects = new Map<TourAnchorId, Rect>();
 private readonly listeners = new Set<() => void>();
 private readonly tapListeners = new Set<(id: TourAnchorId) => void>();

 /** The newest registration of an id wins; the returned function forgets only this one. */
 register(id: TourAnchorId, measure: Measure): () => void {
  const entry = { measure };
  this.measures.set(id, entry);
  this.measure(id);
  return () => {
   if (this.measures.get(id) !== entry) return;
   this.measures.delete(id);
   if (this.rects.delete(id)) this.emit();
  };
 }

 /** Re-measure one control, or all after a scroll or rotation. */
 measure(id?: TourAnchorId): void {
  for (const [key, entry] of id ? [[id, this.measures.get(id)] as const] : [...this.measures]) {
   entry?.measure(rect => {
    if (this.measures.get(key) !== entry) return;
    const next = rect.width > 0 && rect.height > 0 ? rect : undefined;
    if (same(this.rects.get(key), next)) return;
    if (next) this.rects.set(key, next); else this.rects.delete(key);
    this.emit();
   });
  }
 }

 /** Whether a mounted control registered this id, measured or not. */
 has(id: TourAnchorId): boolean { return this.measures.has(id); }
 /** null until the control is mounted and laid out. */
 rect(id: TourAnchorId): Rect | null { return this.rects.get(id) ?? null; }
 subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

 /** A touch ended on the control itself (navigate steps let it through). */
 tapped(id: TourAnchorId): void { for (const listener of [...this.tapListeners]) listener(id); }
 onTap(listener: (id: TourAnchorId) => void): () => void { this.tapListeners.add(listener); return () => { this.tapListeners.delete(listener); }; }

 private emit() { for (const listener of [...this.listeners]) listener(); }
}
