import { expect, it } from "vitest";
import { AppTour, advanceRun, effectiveFlags, parseTourFlags, presentStep, shouldStartAfterPairing, startRun, TIP_IDS, TIPS, TOUR_STEPS, type TourFlagsRecord, type TourFlagsStore } from "../src/core/tour";

function fakeStore(initial: TourFlagsRecord, fail: { read?: boolean; write?: boolean } = {}) {
 const writes: unknown[] = [];
 let record = initial;
 const store: TourFlagsStore = {
  read: async () => { if (fail.read) throw new Error("disk"); return record; },
  write: async flags => { if (fail.write) throw new Error("disk full"); writes.push(flags); record = { kind: "saved", flags }; },
 };
 return { store, writes };
}
const none: TourFlagsRecord = { kind: "none" };

it("lists the nine steps of the artboard in order, with screen, target and kind, plus «Abrir terminal» when Inicio has it", () => {
 expect(TOUR_STEPS.map(s => s.id)).toEqual(["sessions", "openTerminal", "tabs", "diffs", "selector", "addComputer", "createLink", "notifications", "about", "done"]);
 expect(TOUR_STEPS.map(s => s.screen)).toEqual(["home", "home", "home", "terminal", "terminal", "computers", "files", "settings", "settings", "home"]);
 expect(TOUR_STEPS.map(s => s.anchor)).toEqual(["home.sessions", "home.openTerminal", "tabs.bar", "terminal.project", "terminal.selector", "computers.add", "files.createLink", "settings.notifications", "settings.about", null]);
 // A tab really navigates; + and «Crear link» only advance; the last step closes with «Empezar».
 expect(TOUR_STEPS.map(s => s.kind)).toEqual(["action", "action", "navigate", "action", "action", "action", "action", "action", "action", "finish"]);
 expect(TOUR_STEPS.filter(s => s.needsSession).map(s => s.id)).toEqual(["diffs", "selector"]);
 expect(TOUR_STEPS.map(s => s.route)).toEqual(["/", "/", "/", null, null, "/computers", "/files", "/settings", "/settings", "/"]);
 // Without the tile the run is the artboard's nine steps.
 expect(startRun({ hasSession: true }).steps.map(s => s.id)).toEqual(["sessions", "tabs", "diffs", "selector", "addComputer", "createLink", "notifications", "about", "done"]);
});

it("walks the steps one by one and ends after the last", () => {
 let run = startRun({ hasSession: true });
 const seen: number[] = [];
 for (let next: typeof run | null = run; next; next = advanceRun(next)) { run = next; seen.push(presentStep(next).number); }
 expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
 expect(presentStep(run)).toMatchObject({ number: 9, total: 9, mode: "finish", anchor: null });
});

it("with a session, steps 3 and 4 target the terminal's real controls; without one they only explain", () => {
 const at = (index: number, hasSession: boolean) => presentStep({ ...startRun({ hasSession }), index });
 expect(at(2, true)).toMatchObject({ mode: "target", anchor: "terminal.project", screen: "terminal" });
 expect(at(3, true)).toMatchObject({ mode: "target", anchor: "terminal.selector", screen: "terminal" });
 // Nothing is opened and nothing invented: no target, explained on Inicio.
 expect(at(2, false)).toMatchObject({ mode: "explain", anchor: null, screen: "home" });
 expect(at(3, false)).toMatchObject({ mode: "explain", anchor: null, screen: "home" });
 expect(at(0, false)).toMatchObject({ mode: "target", anchor: "home.sessions", screen: "home" });
});

it("starts once after the first pairing only", () => {
 expect(shouldStartAfterPairing(0, { tourSeen: false, tips: [] })).toBe(true);
 expect(shouldStartAfterPairing(1, { tourSeen: false, tips: [] })).toBe(false);
 expect(shouldStartAfterPairing(0, { tourSeen: true, tips: [] })).toBe(false);
});

it("treats a missing file as nothing seen and a damaged one as tour seen with no tips seen", () => {
 expect(effectiveFlags({ kind: "none" })).toEqual({ tourSeen: false, tips: [] });
 expect(effectiveFlags({ kind: "damaged" })).toEqual({ tourSeen: true, tips: [] });
 expect(effectiveFlags({ kind: "saved", flags: { tourSeen: false, tips: ["terminal"] } })).toEqual({ tourSeen: false, tips: ["terminal"] });
});

it("parses the stored flags leniently and rejects anything that is not a record", () => {
 expect(parseTourFlags(JSON.stringify({ version: 1, tourSeen: true, tips: ["terminal", "nope", 3, "projectSheet"] }))).toEqual({ tourSeen: true, tips: ["terminal", "projectSheet"] });
 expect(parseTourFlags(JSON.stringify({ version: 1 }))).toEqual({ tourSeen: false, tips: [] });
 expect(() => parseTourFlags("null")).toThrow();
 expect(() => parseTourFlags("[]")).toThrow();
 expect(() => parseTourFlags("{")).toThrow();
});

it("runs after the first pairing, records it when skipped and never starts again by itself", async () => {
 const { store, writes } = fakeStore(none);
 const tour = new AppTour({ store });
 expect(await tour.shouldStartAfterPairing(0)).toBe(true);
 tour.start({ hasSession: false });
 expect(tour.current()).toMatchObject({ number: 1, total: 9 });
 tour.advance();
 expect(tour.current()).toMatchObject({ number: 2 });
 await tour.skip();
 expect(tour.current()).toBeNull();
 expect(writes).toEqual([{ tourSeen: true, tips: [] }]);
 expect(await tour.shouldStartAfterPairing(0)).toBe(false);
 // The next app start reads the record.
 expect(await new AppTour({ store }).shouldStartAfterPairing(0)).toBe(false);
});

it("records the tour when the last step finishes and on demand always runs", async () => {
 const { store, writes } = fakeStore({ kind: "saved", flags: { tourSeen: true, tips: [] } });
 const tour = new AppTour({ store });
 tour.start({ hasSession: true });
 for (let i = 0; i < 8; i++) tour.advance();
 expect(tour.current()).toMatchObject({ number: 9, mode: "finish" });
 await tour.advance();
 expect(tour.current()).toBeNull();
 expect(writes).toEqual([{ tourSeen: true, tips: [] }]);
});

it("notifies listeners on every change", async () => {
 const { store } = fakeStore(none);
 const tour = new AppTour({ store });
 const changes: (number | null)[] = [];
 const off = tour.subscribe(() => changes.push(tour.current()?.number ?? null));
 tour.start({ hasSession: true });
 tour.advance();
 await tour.finish();
 off();
 tour.start({ hasSession: true });
 expect(changes).toEqual([1, 2, null]);
});

it("never shows a tip while the tour runs, and each tip only once", async () => {
 const { store, writes } = fakeStore(none);
 const tour = new AppTour({ store });
 tour.start({ hasSession: true });
 expect(await tour.shouldShowTip("terminal")).toBe(false);
 await tour.skip();
 expect(await tour.shouldShowTip("terminal")).toBe(true);
 await tour.dismissTip("terminal");
 expect(await tour.shouldShowTip("terminal")).toBe(false);
 expect(await tour.shouldShowTip("chatFloating")).toBe(true);
 expect(writes.at(-1)).toEqual({ tourSeen: true, tips: ["terminal"] });
 expect(await new AppTour({ store }).shouldShowTip("terminal")).toBe(false);
});

it("never re-shows the tour once recorded, even if the file is later damaged or unreadable", async () => {
 for (const fail of [{ read: true }, {}]) {
  const { store, writes } = fakeStore({ kind: "damaged" }, fail);
  const tour = new AppTour({ store });
  expect(await tour.shouldStartAfterPairing(0)).toBe(false);
  // Tips in a damaged file count as not seen; recording one keeps the tour recorded.
  expect(await tour.shouldShowTip("projectSheet")).toBe(true);
  await tour.dismissTip("projectSheet");
  if (!fail.read) expect(writes).toEqual([{ tourSeen: true, tips: ["projectSheet"] }]);
 }
});

it("keeps what was recorded in memory when the write fails, and never erases a flag", async () => {
 const { store } = fakeStore(none, { write: true });
 const tour = new AppTour({ store });
 await expect(tour.skip()).resolves.toBeUndefined();
 await expect(tour.dismissTip("sessionSelector")).resolves.toBeUndefined();
 expect(await tour.shouldStartAfterPairing(0)).toBe(false);
 expect(await tour.shouldShowTip("sessionSelector")).toBe(false);
 // Starting on demand again does not forget the record.
 tour.start({ hasSession: false });
 expect(tour.isRunning()).toBe(true);
 await tour.skip();
 expect(await tour.shouldStartAfterPairing(0)).toBe(false);
});

it("defines the six first-visit tips with their targets", () => {
 expect(TIP_IDS).toEqual(["terminal", "chatFloating", "projectSheet", "sessionSelector", "keyBarTab", "approval"]);
 expect(TIPS.terminal.anchors).toEqual(["terminal.chatHandle", "terminal.prefix"]);
 expect(TIPS.chatFloating.anchors).toEqual(["chat.composer"]);
 expect(TIPS.projectSheet.anchors).toEqual(["projectSheet.tabs"]);
 expect(TIPS.sessionSelector.anchors).toEqual(["selector.list"]);
 expect(TIPS.keyBarTab.anchors).toEqual(["terminal.keyBarTab"]);
 expect(TIPS.approval.anchors).toEqual(["approvals.first"]);
});
