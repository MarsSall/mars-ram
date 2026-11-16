// Where the coach mark's bubble, hand and «Saltar recorrido» go around a target. Pure.
import type { Rect } from "./anchor-registry";

export const BUBBLE_MAX_WIDTH = 280;
export const SKIP_WIDTH = 168;
const EDGE = 16;
const GAP = 12;
const SKIP_EDGE = 12;
const TOUCH = 48;
/** The hand icon's box, and its gap to the target. */
export const HAND = 36;
const HAND_GAP = 4;

export type CoachLayout = {
 side: "above" | "below" | "center";
 bubble: { left: number; top: number; width: number };
 /** Notch x inside the bubble, pointing at the target; null when centered. */
 notchLeft: number | null;
 hand: { left: number; top: number } | null;
 /** Right-aligned at 12 dp from the edge. */
 skip: { top: number; width: number };
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The smallest rect holding every target (a tip can mark two controls). */
export function union(rects: Rect[]): Rect | null {
 if (rects.length === 0) return null;
 const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
 return { x, y, width: Math.max(...rects.map(r => r.x + r.width)) - x, height: Math.max(...rects.map(r => r.y + r.height)) - y };
}

/** keyboard: the open keyboard's height; nothing is placed under it. */
export function layoutCoachMark({ target, window, insets, bubbleHeight, keyboard = 0 }: { target: Rect | null; window: { width: number; height: number }; insets: { top: number; bottom: number }; bubbleHeight: number; keyboard?: number }): CoachLayout {
 const width = Math.min(BUBBLE_MAX_WIDTH, window.width - 2 * EDGE);
 const skipWidth = Math.min(SKIP_WIDTH, window.width - 2 * SKIP_EDGE);
 const topLimit = insets.top, bottomLimit = window.height - Math.max(insets.bottom, keyboard);
 if (!target) {
  const top = clamp((window.height - bubbleHeight) / 2, topLimit, bottomLimit - bubbleHeight);
  return { side: "center", bubble: { left: (window.width - width) / 2, top, width }, notchLeft: null, hand: null, skip: { top: topLimit + SKIP_EDGE, width: skipWidth } };
 }
 // The roomier side, so the bubble never covers the control.
 const room = { above: target.y - topLimit, below: bottomLimit - (target.y + target.height) };
 const side = room.above >= room.below ? "above" : "below";
 const centerX = target.x + target.width / 2, centerY = target.y + target.height / 2;
 // The hand goes beside the target, never over it: on the roomier side, else above or below it,
 // away from the bubble when it fits there; else between them, and the bubble moves away.
 const reach = HAND + HAND_GAP;
 const across = { left: target.x, right: window.width - (target.x + target.width) };
 const handSide = Math.max(across.left, across.right) >= reach ? (across.right >= across.left ? "right" : "left")
  : room[side === "above" ? "below" : "above"] >= reach ? (side === "above" ? "below" : "above") : side;
 const handLeft = handSide === "right" ? target.x + target.width + HAND_GAP : handSide === "left" ? target.x - reach : clamp(centerX - HAND / 2, 0, window.width - HAND);
 const handTop = handSide === "above" ? target.y - reach : handSide === "below" ? target.y + target.height + HAND_GAP : clamp(centerY - HAND / 2, topLimit, bottomLimit - HAND);
 // Beside a short target the hand sticks out above and below it; between it and the bubble it takes its place.
 const gap = handSide === side ? GAP + reach : handSide === "left" || handSide === "right" ? GAP + Math.max(0, (HAND - target.height) / 2) : GAP;
 const top = side === "above"
  ? Math.max(topLimit, target.y - gap - bubbleHeight)
  : Math.min(bottomLimit - bubbleHeight, target.y + target.height + gap);
 const left = clamp(centerX - width / 2, EDGE, window.width - EDGE - width);
 const bubble = { x: left, y: top, width, height: bubbleHeight };
 // Top right unless the target or the bubble is there; otherwise at the bottom, then the free gap.
 const candidates = [topLimit + SKIP_EDGE, bottomLimit - 96 - TOUCH, bottomLimit - SKIP_EDGE - TOUCH];
 const free = (y: number) => { const skip = { x: window.width - SKIP_EDGE - skipWidth, y, width: skipWidth, height: TOUCH }; return !overlaps(skip, target) && !overlaps(skip, bubble); };
 const skipTop = candidates.find(free) ?? (side === "above" ? Math.max(topLimit, top - GAP - TOUCH) : Math.min(bottomLimit - TOUCH, top + bubbleHeight + GAP));
 return {
  side, bubble: { left, top, width },
  notchLeft: clamp(centerX - left - 8, 16, width - 32),
  hand: { left: handLeft, top: handTop },
  skip: { top: skipTop, width: skipWidth },
 };
}

type KeyboardEventName = "keyboardWillShow" | "keyboardDidShow" | "keyboardWillHide" | "keyboardDidHide";
/** React Native's Keyboard, or a fake. */
export type KeyboardSource = {
 addListener(event: KeyboardEventName, listener: (event: { endCoordinates: { height: number } }) => void): { remove(): void };
 isVisible(): boolean;
 metrics(): { height: number } | null | undefined;
};

/** Reports the keyboard's height now and whenever it opens, changes or closes (0 when closed). */
export function trackKeyboard(keyboard: KeyboardSource, onChange: (height: number) => void): () => void {
 onChange(keyboard.isVisible() ? keyboard.metrics()?.height ?? 0 : 0);
 const subs = [
  ...(["keyboardWillShow", "keyboardDidShow"] as const).map(event => keyboard.addListener(event, e => onChange(e.endCoordinates.height))),
  ...(["keyboardWillHide", "keyboardDidHide"] as const).map(event => keyboard.addListener(event, () => onChange(0))),
 ];
 return () => { for (const sub of subs) sub.remove(); };
}
