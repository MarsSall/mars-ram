// Fixes from the first phone check of the tour (odd/tasks/app-tour.md, L6).
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { AppTour, HOME_OPEN_TERMINAL, presentStep, startRun, TOUR_STEPS, type TourAnchorId } from "../src/core/tour";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";
import { TourAnchorRegistry } from "../src/ui/tour/anchor-registry";
import { layoutCoachMark, trackKeyboard } from "../src/ui/tour/coach-layout";
import { tourNavigation } from "../src/ui/tour/tour-navigation";

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const window = { width: 360, height: 780 };
const insets = { top: 24, bottom: 0 };
const HAND = 36;
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const fresh = () => new AppTour({ store: { read: async () => ({ kind: "none" }), write: async () => {} } });

// 1 — explain-only steps show on Inicio, whatever tab step 2's tap opened.
it("shows the explain-only steps 3-4 on Inicio, then goes on to Computadoras", () => {
 const run = startRun({ hasSession: false });
 const at = (index: number) => presentStep({ ...run, index });
 expect(at(2)).toMatchObject({ mode: "explain", screen: "home" });
 expect(at(3)).toMatchObject({ mode: "explain", screen: "home" });
 expect(tourNavigation(at(2), "/files", null)).toEqual({ kind: "tab", route: "/", leave: false });
 expect(tourNavigation(at(3), "/settings", null)).toEqual({ kind: "tab", route: "/", leave: false });
 // The tab tapped on step 2 may not have reached the pathname yet: go to Inicio anyway.
 expect(tourNavigation(at(2), "/", null)).toEqual({ kind: "tab", route: "/", leave: false });
 expect(tourNavigation(at(4), "/", null)).toEqual({ kind: "tab", route: "/computers", leave: false });
});

// 2 — the hand sits beside the target, never over it.
it("places the hand beside the target on the side with room, never over the target or the bubble", () => {
 const targets: Record<string, Box> = {
  add: { x: 296, y: 44, width: 52, height: 52 },
  createLink: { x: 26, y: 176, width: 308, height: 56 },
  prefix: { x: 77, y: 708, width: 46, height: 46 },
  leftEdge: { x: 4, y: 300, width: 48, height: 48 },
  tabBar: { x: 0, y: 704, width: 360, height: 62 },
  sessions: { x: 10, y: 206, width: 340, height: 418 },
  header: { x: 0, y: 24, width: 360, height: 56 },
 };
 for (const [id, target] of Object.entries(targets)) {
  const layout = layoutCoachMark({ target, window, insets, bubbleHeight: 96 });
  const hand = { x: layout.hand!.left, y: layout.hand!.top, width: HAND, height: HAND };
  const bubble = { x: layout.bubble.left, y: layout.bubble.top, width: layout.bubble.width, height: 96 };
  expect(overlaps(hand, target), id).toBe(false);
  expect(overlaps(hand, bubble), id).toBe(false);
  expect(overlaps(bubble, target), id).toBe(false);
  expect(hand.x, id).toBeGreaterThanOrEqual(0);
  expect(hand.x + HAND, id).toBeLessThanOrEqual(window.width);
  expect(hand.y, id).toBeGreaterThanOrEqual(0);
  expect(hand.y + HAND, id).toBeLessThanOrEqual(window.height);
 }
 // The + at the right edge: the hand goes to its left; a control at the left edge: to its right.
 expect(layoutCoachMark({ target: targets.add, window, insets, bubbleHeight: 96 }).hand!.left).toBeLessThan(targets.add.x);
 expect(layoutCoachMark({ target: targets.leftEdge, window, insets, bubbleHeight: 96 }).hand!.left).toBeGreaterThanOrEqual(targets.leftEdge.x + targets.leftEdge.width);
});

// 3 — «Abrir terminal» on Inicio, only when the tile is there.
it("adds the «Abrir terminal» step right after the sessions, and drops it when its anchor is not registered", () => {
 expect(HOME_OPEN_TERMINAL).toBe("home.openTerminal");
 expect(TOUR_STEPS.map(s => s.id).slice(0, 3)).toEqual(["sessions", "openTerminal", "tabs"]);
 expect(TOUR_STEPS[1]).toMatchObject({ screen: "home", route: "/", anchor: "home.openTerminal", kind: "action", optional: true });
 expect(TOUR_STEPS.filter(s => s.optional).map(s => s.id)).toEqual(["openTerminal"]);

 const without = startRun({ hasSession: false, available: () => false });
 expect(without.steps.map(s => s.id)).not.toContain("openTerminal");
 expect(presentStep({ ...without, index: 1 })).toMatchObject({ number: 2, total: 9, anchor: "tabs.bar" });

 const withTile = startRun({ hasSession: false, available: (id: TourAnchorId) => id === "home.openTerminal" });
 expect(presentStep({ ...withTile, index: 1 })).toMatchObject({ number: 2, total: 10, mode: "target", anchor: "home.openTerminal", screen: "home" });
 expect(presentStep({ ...withTile, index: 9 })).toMatchObject({ number: 10, total: 10, mode: "finish" });
 expect(es.tour.steps.openTerminal).toBe("Acá abrís una terminal en la computadora que elijas.");
 expect(en.tour.steps.openTerminal).toBe("Open a terminal on the computer you choose.");
});

it("asks the anchors whether the tile is on Inicio when the tour starts, and still opens the session at step 4", async () => {
 const registry = new TourAnchorRegistry();
 const tour = fresh();
 tour.attachAnchors(registry);
 tour.start({ hasSession: false });
 expect(tour.current()).toMatchObject({ number: 1, total: 9 });
 const off = registry.register("home.openTerminal", done => done({ x: 10, y: 120, width: 340, height: 64 }));
 const session = { key: "mini/api", project: "api", cwd: "/home/alex/api", computer: "devbox" };
 await tour.begin(async () => session);
 expect(tour.current()).toMatchObject({ number: 1, total: 10 });
 await tour.advance();
 expect(tour.current()).toMatchObject({ number: 2, anchor: "home.openTerminal" });
 await tour.advance(); await tour.advance();
 expect(tour.current()).toMatchObject({ number: 4, mode: "target", anchor: "terminal.project" });
 off();
 expect(registry.has("home.openTerminal")).toBe(false);
});

it("lets the tour host hand its registry to the tour", () => {
 expect(source("ui/tour/tour-host.tsx")).toMatch(/appTour\.attachAnchors\(tourAnchors\)/);
});

// 4 — the tip's bubble never goes under the keyboard.
it("places the bubble above a target sitting on the keyboard, never under the keyboard", () => {
 const keyboard = 300;
 const composer = { x: 8, y: 330, width: 344, height: 64 };
 const layout = layoutCoachMark({ target: composer, window, insets, bubbleHeight: 120, keyboard });
 expect(layout.side).toBe("above");
 expect(layout.bubble.top + 120).toBeLessThanOrEqual(composer.y);
 // Without the keyboard the same target has more room below.
 expect(layoutCoachMark({ target: composer, window, insets, bubbleHeight: 120 }).side).toBe("below");
 for (let y = 30; y < window.height - keyboard - 40; y += 37) {
  const target = { x: 8, y, width: 344, height: 40 };
  const placed = layoutCoachMark({ target, window, insets, bubbleHeight: 120, keyboard });
  expect(placed.bubble.top + 120, `y=${y}`).toBeLessThanOrEqual(window.height - keyboard);
  expect(placed.hand!.top + HAND, `y=${y}`).toBeLessThanOrEqual(window.height - keyboard);
 }
});

it("follows the keyboard's height as it opens and closes", () => {
 const handlers = new Map<string, (event: { endCoordinates: { height: number } }) => void>();
 const removed: string[] = [];
 const keyboard = {
  addListener: (event: string, handler: (event: { endCoordinates: { height: number } }) => void) => { handlers.set(event, handler); return { remove: () => removed.push(event) }; },
  isVisible: () => false, metrics: () => undefined,
 };
 const heights: number[] = [];
 const stop = trackKeyboard(keyboard, height => heights.push(height));
 handlers.get("keyboardDidShow")!({ endCoordinates: { height: 310 } });
 handlers.get("keyboardDidHide")!({ endCoordinates: { height: 0 } });
 expect(heights).toEqual([0, 310, 0]);
 stop();
 expect(removed.length).toBe(handlers.size);
 const open = { ...keyboard, isVisible: () => true, metrics: () => ({ height: 280 }) };
 const first: number[] = [];
 trackKeyboard(open, height => first.push(height))();
 expect(first).toEqual([280]);
 expect(source("ui/tour/coach-mark.tsx")).toMatch(/trackKeyboard\(Keyboard, setKeyboard\)/);
 expect(source("ui/tour/coach-mark-view.tsx")).toMatch(/layoutCoachMark\(\{ target, window, insets, bubbleHeight, keyboard \}\)/);
});
