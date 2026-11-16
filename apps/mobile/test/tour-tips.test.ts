import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppTour, type TourAnchorId, type TourFlagsRecord, type TourFlagsStore } from "../src/core/tour";
import { TourAnchorRegistry, type Rect } from "../src/ui/tour/anchor-registry";
import { TIP_SETTLE_MS, TipGate } from "../src/ui/tour/tip-gate";

function fakeStore(record: TourFlagsRecord = { kind: "none" }) {
 const writes: unknown[] = [];
 const store: TourFlagsStore = { read: async () => record, write: async flags => { writes.push(structuredClone(flags)); } };
 return { store, writes };
}
/** Registers each target with a measure the test controls; null is "not on screen". */
function screen(registry: TourAnchorRegistry, rects: Partial<Record<TourAnchorId, Rect | null>>) {
 const current = { ...rects };
 for (const id of Object.keys(rects) as TourAnchorId[]) registry.register(id, done => done(current[id] ?? { x: 0, y: 0, width: 0, height: 0 }));
 return { move(id: TourAnchorId, rect: Rect | null) { current[id] = rect; registry.measure(id); } };
}
const handle = { x: 152, y: 640, width: 56, height: 20 };
const prefix = { x: 77, y: 708, width: 46, height: 44 };
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it("shows one tip at a time and records it only on «Entendido»", async () => {
 const { store, writes } = fakeStore();
 const tour = new AppTour({ store });
 expect(await tour.claimTip("terminal")).toBe("shown");
 expect(tour.shownTip()).toBe("terminal");
 expect(await tour.claimTip("projectSheet")).toBe("wait");
 tour.releaseTip("terminal");
 expect(tour.shownTip()).toBeNull();
 expect(writes).toEqual([]);
 expect(await tour.claimTip("projectSheet")).toBe("shown");
 await tour.dismissTip("projectSheet");
 expect(tour.shownTip()).toBeNull();
 expect(writes.at(-1)).toEqual({ tourSeen: false, tips: ["projectSheet"] });
 expect(await tour.claimTip("projectSheet")).toBe("seen");
});

it("never shows a tip while the tour runs, and the tour hides one already shown without recording it", async () => {
 const { store, writes } = fakeStore();
 const tour = new AppTour({ store });
 expect(await tour.claimTip("chatFloating")).toBe("shown");
 tour.start({ hasSession: false });
 expect(tour.shownTip()).toBeNull();
 expect(await tour.claimTip("chatFloating")).toBe("wait");
 await tour.skip();
 expect(writes).toEqual([{ tourSeen: true, tips: [] }]);
 expect(await tour.claimTip("chatFloating")).toBe("shown");
});

it("shows a tip only once its targets are measured and have stayed put", async () => {
 const tour = new AppTour({ store: fakeStore().store });
 const registry = new TourAnchorRegistry();
 const view = screen(registry, { "terminal.chatHandle": null, "terminal.prefix": prefix });
 const gate = new TipGate("terminal", { tour, registry });
 gate.setReady(true);
 vi.advanceTimersByTime(TIP_SETTLE_MS * 3); await flush();
 // The chat handle is not on screen: never shown, never recorded.
 expect(tour.shownTip()).toBeNull();
 view.move("terminal.chatHandle", handle);
 vi.advanceTimersByTime(TIP_SETTLE_MS - 100); await flush();
 view.move("terminal.prefix", { ...prefix, y: 400 });
 vi.advanceTimersByTime(TIP_SETTLE_MS - 100); await flush();
 expect(tour.shownTip()).toBeNull();
 vi.advanceTimersByTime(100); await flush();
 expect(tour.shownTip()).toBe("terminal");
 gate.stop();
});

it("waits for the keyboard to finish moving the screen", async () => {
 const tour = new AppTour({ store: fakeStore().store });
 const registry = new TourAnchorRegistry();
 screen(registry, { "chat.composer": { x: 8, y: 600, width: 344, height: 128 } });
 const gate = new TipGate("chatFloating", { tour, registry });
 gate.setReady(true);
 vi.advanceTimersByTime(TIP_SETTLE_MS - 100); await flush();
 gate.moved();
 vi.advanceTimersByTime(TIP_SETTLE_MS - 100); await flush();
 expect(tour.shownTip()).toBeNull();
 vi.advanceTimersByTime(100); await flush();
 expect(tour.shownTip()).toBe("chatFloating");
 gate.stop();
});

it("does not show while its screen is not ready (another overlay open), and shows once it is", async () => {
 const tour = new AppTour({ store: fakeStore().store });
 const registry = new TourAnchorRegistry();
 screen(registry, { "terminal.chatHandle": handle, "terminal.prefix": prefix });
 const gate = new TipGate("terminal", { tour, registry });
 gate.setReady(false);
 vi.advanceTimersByTime(TIP_SETTLE_MS * 3); await flush();
 expect(tour.shownTip()).toBeNull();
 gate.setReady(true);
 vi.advanceTimersByTime(TIP_SETTLE_MS); await flush();
 expect(tour.shownTip()).toBe("terminal");
 // An overlay opening over it hides it without recording it.
 gate.setReady(false);
 expect(tour.shownTip()).toBeNull();
 gate.stop();
 expect(await tour.claimTip("terminal")).toBe("shown");
});

it("never shows during the tour, and shows after it ends", async () => {
 const tour = new AppTour({ store: fakeStore().store });
 const registry = new TourAnchorRegistry();
 screen(registry, { "projectSheet.tabs": { x: 12, y: 700, width: 336, height: 64 } });
 tour.start({ hasSession: true });
 const gate = new TipGate("projectSheet", { tour, registry });
 gate.setReady(true);
 vi.advanceTimersByTime(TIP_SETTLE_MS * 3); await flush();
 expect(tour.shownTip()).toBeNull();
 await tour.skip();
 vi.advanceTimersByTime(TIP_SETTLE_MS); await flush();
 expect(tour.shownTip()).toBe("projectSheet");
 gate.stop();
});

it("waits for another tip to close, then shows; a seen tip never comes back", async () => {
 const { store } = fakeStore({ kind: "saved", flags: { tourSeen: true, tips: ["sessionSelector"] } });
 const tour = new AppTour({ store });
 const registry = new TourAnchorRegistry();
 screen(registry, { "chat.composer": { x: 8, y: 300, width: 344, height: 128 }, "selector.list": { x: 12, y: 200, width: 316, height: 48 } });
 expect(await tour.claimTip("terminal")).toBe("shown");
 const chat = new TipGate("chatFloating", { tour, registry });
 const selector = new TipGate("sessionSelector", { tour, registry });
 chat.setReady(true); selector.setReady(true);
 vi.advanceTimersByTime(TIP_SETTLE_MS); await flush();
 expect(tour.shownTip()).toBe("terminal");
 await tour.dismissTip("terminal");
 vi.advanceTimersByTime(TIP_SETTLE_MS); await flush();
 expect(tour.shownTip()).toBe("chatFloating");
 await tour.dismissTip("chatFloating");
 vi.advanceTimersByTime(TIP_SETTLE_MS * 3); await flush();
 expect(tour.shownTip()).toBeNull();
 chat.stop(); selector.stop();
});

it("leaving the screen before «Entendido» hides the tip without recording it", async () => {
 const { store, writes } = fakeStore();
 const tour = new AppTour({ store });
 const registry = new TourAnchorRegistry();
 screen(registry, { "selector.list": { x: 12, y: 200, width: 316, height: 48 } });
 const gate = new TipGate("sessionSelector", { tour, registry });
 gate.setReady(true);
 vi.advanceTimersByTime(TIP_SETTLE_MS); await flush();
 expect(tour.shownTip()).toBe("sessionSelector");
 gate.stop();
 expect(tour.shownTip()).toBeNull();
 expect(writes).toEqual([]);
});

it("a screen that leaves while its claim is in flight does not leave a tip behind", async () => {
 const tour = new AppTour({ store: fakeStore().store });
 const registry = new TourAnchorRegistry();
 screen(registry, { "selector.list": { x: 12, y: 200, width: 316, height: 48 } });
 const gate = new TipGate("sessionSelector", { tour, registry });
 gate.setReady(true);
 vi.advanceTimersByTime(TIP_SETTLE_MS);
 gate.stop();
 await flush();
 expect(tour.shownTip()).toBeNull();
});
