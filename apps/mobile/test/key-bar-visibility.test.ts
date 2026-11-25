import { describe, expect, it, vi } from "vitest";
import * as visibility from "../src/core/key-bar-visibility";
import {
 DEFAULT_KEY_BAR_MODE, DEFAULT_KEY_BAR_SETTINGS, KEY_BAR_BAND_MIN, KEY_BAR_GESTURE_FALLBACK, KEY_BAR_HANDLE_SIZE, KEY_BAR_MODES, KEY_BAR_TIMING, clampKeyBarHandleSize, keyBarGestureInset, keyBarHandleMetrics, keyBarHandleSlot,
 KeyBarModePreference, initialKeyBarState, isMousePointer, keyBarMotion, keyBarReducer, keyBarTimer, parseKeyBarSettings,
 type KeyBarEvent, type KeyBarSettings, type KeyBarState,
} from "../src/core/key-bar-visibility";

const run = (state: KeyBarState, ...events: KeyBarEvent[]) => events.reduce(keyBarReducer, state);
const fire = (state: KeyBarState) => { const timer = keyBarTimer(state); if (!timer) throw new Error("no timer"); return keyBarReducer(state, { type: "idle-timeout", epoch: timer.epoch }); };

describe("key bar mode setting (S4)", () => {
 it("offers the three modes and defaults to «Siempre visible», as today", () => {
  expect(KEY_BAR_MODES).toEqual(["always", "auto", "tap"]);
  expect(DEFAULT_KEY_BAR_MODE).toBe("always");
 });
 it("reads the older file that held only the mode, with the default handle size", () => {
  for (const mode of KEY_BAR_MODES) expect(parseKeyBarSettings(JSON.stringify(mode))).toEqual({ mode, handleSize: 14 });
  for (const raw of [null, "", "{", "\"hidden\"", "3", "null", "[\"auto\"]"]) expect(parseKeyBarSettings(raw)).toEqual({ mode: "always", handleSize: 14 });
 });
 it("reads the mode and the handle size together; a damaged field falls back alone", () => {
  expect(parseKeyBarSettings("{\"mode\":\"tap\",\"handleSize\":14}")).toEqual({ mode: "tap", handleSize: 14 });
  expect(parseKeyBarSettings("{\"mode\":\"auto\",\"handleSize\":99}")).toEqual({ mode: "auto", handleSize: 14 });
  expect(parseKeyBarSettings("{\"mode\":\"auto\",\"handleSize\":13.5}")).toEqual({ mode: "auto", handleSize: 14 });
  expect(parseKeyBarSettings("{\"mode\":\"nope\",\"handleSize\":30}")).toEqual({ mode: "always", handleSize: 30 });
  expect(parseKeyBarSettings("{}")).toEqual(DEFAULT_KEY_BAR_SETTINGS);
 });
 it("persists like the other terminal settings: applies at once, notifies, and coalesces fast writes", async () => {
  const writes: string[] = [];
  const store = { read: () => "\"tap\"", write: vi.fn(async (text: string) => { writes.push(text); }) };
  const preference = new KeyBarModePreference(store);
  expect(preference.get()).toEqual({ mode: "tap", handleSize: 14 });
  const seen: KeyBarSettings[] = []; const off = preference.subscribe(value => seen.push(value));
  const first = preference.set({ mode: "auto", handleSize: 20 }); const second = preference.set({ mode: "auto", handleSize: 32 });
  expect(preference.get()).toEqual({ mode: "auto", handleSize: 32 }); expect(seen).toEqual([{ mode: "auto", handleSize: 20 }, { mode: "auto", handleSize: 32 }]);
  expect(first).toBe(second);
  await second;
  expect(writes).toEqual(["{\"mode\":\"auto\",\"handleSize\":20}", "{\"mode\":\"auto\",\"handleSize\":32}"]);
  expect(parseKeyBarSettings(writes[1])).toEqual({ mode: "auto", handleSize: 32 });
  off(); await preference.set({ mode: "tap", handleSize: 32 }); expect(seen).toHaveLength(2);
 });
 it("ignores invalid and unchanged values, survives unreadable storage, and rejects a failed write", async () => {
  const broken = new KeyBarModePreference({ read: () => { throw new Error("io"); }, write: () => Promise.reject(new Error("disk")) });
  expect(broken.get()).toEqual({ mode: "always", handleSize: 14 });
  await broken.set({ mode: "always", handleSize: 14 });
  await broken.set({ mode: "nope" as KeyBarSettings["mode"], handleSize: 14 });
  await broken.set({ mode: "tap", handleSize: 200 });
  expect(broken.get()).toEqual({ mode: "always", handleSize: 14 });
  await expect(broken.set({ mode: "tap", handleSize: 16 })).rejects.toThrow("disk");
  expect(broken.get()).toEqual({ mode: "tap", handleSize: 16 });
 });
});

describe("«Siempre visible»", () => {
 it("is always shown and no event hides it", () => {
  let state = initialKeyBarState("always");
  expect(state.shown).toBe(true);
  for (const event of [{ type: "terminal-tap" }, { type: "handle-tap" }, { type: "handle-tap", assistive: true }, { type: "pointer-leave" }, { type: "idle-timeout", epoch: state.epoch }] as KeyBarEvent[]) state = keyBarReducer(state, event);
  expect(state.shown).toBe(true);
  expect(keyBarTimer(state)).toBeNull();
 });
 it("key presses leave the state untouched outside «Autodesplegable», so the screen does not re-render per key", () => {
  for (const mode of ["always", "tap"] as const) {
   const state = initialKeyBarState(mode);
   expect(keyBarReducer(state, { type: "key-press", held: true })).toBe(state);
  }
 });
});

describe("«Autodesplegable» with touch (S2)", () => {
 const hidden = () => initialKeyBarState("auto");
 it("starts hidden and a tap on the handle tab shows it, like the D-pad button; another tap hides it", () => {
  expect(hidden().shown).toBe(false);
  const shown = run(hidden(), { type: "handle-tap" });
  expect(shown.shown).toBe(true);
  expect(run(shown, { type: "handle-tap" }).shown).toBe(false);
 });
 it("has no swipe reveal any more (L4)", () => {
  expect("isRevealSwipe" in visibility).toBe(false);
  const state = hidden();
  expect(keyBarReducer(state, { type: "reveal-swipe" } as unknown as KeyBarEvent)).toBe(state);
 });
 it("hides on a tap in the terminal", () => {
  expect(run(hidden(), { type: "handle-tap" }, { type: "terminal-tap" }).shown).toBe(false);
 });
 it("hides after ~4 s without pressing a bar key", () => {
  const shown = run(hidden(), { type: "handle-tap" });
  expect(keyBarTimer(shown)).toEqual({ ms: KEY_BAR_TIMING.idleMs, epoch: shown.epoch });
  expect(KEY_BAR_TIMING.idleMs).toBe(4000);
  expect(fire(shown).shown).toBe(false);
 });
 it("a key press restarts the wait and a stale timeout is ignored", () => {
  const shown = run(hidden(), { type: "handle-tap" });
  const stale = keyBarTimer(shown)!;
  const pressed = run(shown, { type: "key-press", held: true }, { type: "key-press", held: false });
  expect(pressed.epoch).not.toBe(stale.epoch);
  expect(keyBarReducer(pressed, { type: "idle-timeout", epoch: stale.epoch }).shown).toBe(true);
  expect(fire(pressed).shown).toBe(false);
 });
 it("never hides while a key is held, the D-pad is shown or the mic records", () => {
  const shown = run(hidden(), { type: "handle-tap" });
  for (const hold of [{ type: "key-press", held: true }, { type: "hold", source: "pad", on: true }, { type: "hold", source: "mic", on: true }] as KeyBarEvent[]) {
   const busy = keyBarReducer(shown, hold);
   expect(keyBarTimer(busy)).toBeNull();
   expect(keyBarReducer(busy, { type: "idle-timeout", epoch: busy.epoch }).shown).toBe(true);
   expect(keyBarReducer(busy, { type: "terminal-tap" }).shown).toBe(true);
  }
  const released = run(shown, { type: "hold", source: "pad", on: true }, { type: "hold", source: "mic", on: true }, { type: "hold", source: "pad", on: false });
  expect(keyBarTimer(released)).toBeNull();
  const free = keyBarReducer(released, { type: "hold", source: "mic", on: false });
  expect(keyBarTimer(free)).toEqual({ ms: KEY_BAR_TIMING.idleMs, epoch: free.epoch });
 });
 it("a terminal tap or timeout while hidden changes nothing", () => {
  const state = hidden();
  expect(keyBarReducer(state, { type: "terminal-tap" })).toBe(state);
  expect(keyBarReducer(state, { type: "idle-timeout", epoch: state.epoch })).toBe(state);
  expect(keyBarTimer(state)).toBeNull();
 });
 it("opened from TalkBack (the tab's accessibility action) it shows without the idle timer; a second activation or a terminal tap hides it", () => {
  const shown = run(hidden(), { type: "handle-tap", assistive: true });
  expect(shown.shown).toBe(true);
  expect(keyBarTimer(shown)).toBeNull();
  expect(run(shown, { type: "handle-tap", assistive: true }).shown).toBe(false);
  expect(run(shown, { type: "terminal-tap" }).shown).toBe(false);
  const mouse = run(shown, { type: "pointer-enter" }, { type: "pointer-leave" });
  expect(mouse.shown).toBe(true); expect(keyBarTimer(mouse)).toBeNull();
 });
});

describe("«Autodesplegable» with a mouse or trackpad (S2)", () => {
 it("shows while the pointer is at the bottom edge and hides a short delay after it leaves", () => {
  const inside = run(initialKeyBarState("auto"), { type: "pointer-enter" });
  expect(inside.shown).toBe(true);
  expect(keyBarTimer(inside)).toBeNull();
  const left = keyBarReducer(inside, { type: "pointer-leave" });
  expect(left.shown).toBe(true);
  expect(keyBarTimer(left)).toEqual({ ms: KEY_BAR_TIMING.pointerLeaveMs, epoch: left.epoch });
  expect(KEY_BAR_TIMING.pointerLeaveMs).toBeLessThan(KEY_BAR_TIMING.idleMs);
  expect(fire(left).shown).toBe(false);
 });
 it("coming back before the delay keeps it", () => {
  const left = run(initialKeyBarState("auto"), { type: "pointer-enter" }, { type: "pointer-leave" });
  const back = keyBarReducer(left, { type: "pointer-enter" });
  expect(keyBarReducer(back, { type: "idle-timeout", epoch: keyBarTimer(left)!.epoch }).shown).toBe(true);
  expect(keyBarTimer(back)).toBeNull();
 });
 it("a leave without an enter does not show it", () => {
  expect(run(initialKeyBarState("auto"), { type: "pointer-leave" }).shown).toBe(false);
 });
 it("only a mouse pointer counts, never touch", () => {
  expect(isMousePointer({ nativeEvent: { pointerType: "mouse" } })).toBe(true);
  for (const pointerType of ["touch", "pen", undefined]) expect(isMousePointer({ nativeEvent: { pointerType } })).toBe(false);
 });
 it("pointer events do nothing in the other modes", () => {
  for (const mode of ["always", "tap"] as const) {
   const state = initialKeyBarState(mode);
   expect(run(state, { type: "pointer-enter" }, { type: "pointer-leave" }).shown).toBe(state.shown);
  }
 });
});

describe("«Con un toque» (S3)", () => {
 it("starts hidden unless the app remembers it open; the handle toggles it", () => {
  expect(initialKeyBarState("tap").shown).toBe(false);
  expect(initialKeyBarState("tap", true).shown).toBe(true);
  const shown = run(initialKeyBarState("tap"), { type: "handle-tap" });
  expect(shown.shown).toBe(true);
  expect(run(shown, { type: "handle-tap" }).shown).toBe(false);
 });
 it("stays as chosen: terminal taps, key presses and timeouts never change it", () => {
  for (const start of [false, true]) {
   const state = initialKeyBarState("tap", start);
   const after = run(state, { type: "terminal-tap" }, { type: "pointer-enter" }, { type: "key-press", held: true }, { type: "key-press", held: false }, { type: "idle-timeout", epoch: state.epoch });
   expect(after.shown).toBe(start);
   expect(keyBarTimer(after)).toBeNull();
  }
 });
});

describe("mode changes", () => {
 it("switching mode applies the new mode's starting state; the same mode is a no-op", () => {
  const auto = run(initialKeyBarState("always"), { type: "mode-change", mode: "auto" });
  expect(auto).toMatchObject({ mode: "auto", shown: false });
  expect(run(auto, { type: "handle-tap" }, { type: "mode-change", mode: "tap" })).toMatchObject({ mode: "tap", shown: false });
  expect(run(auto, { type: "mode-change", mode: "always" })).toMatchObject({ mode: "always", shown: true });
  expect(keyBarReducer(auto, { type: "mode-change", mode: "auto" })).toBe(auto);
 });
 it("keeps the holds across a mode change", () => {
  const state = run(initialKeyBarState("always"), { type: "hold", source: "pad", on: true }, { type: "mode-change", mode: "auto" }, { type: "handle-tap" });
  expect(keyBarTimer(state)).toBeNull();
 });
});

describe("show/hide motion", () => {
 it("translates and fades in about 150 ms, and is instant with reduce motion", () => {
  expect(KEY_BAR_TIMING.animationMs).toBe(150);
  expect(keyBarMotion(true, false)).toEqual({ opacity: 1, translateY: 0, duration: 150 });
  expect(keyBarMotion(false, false)).toEqual({ opacity: 0, translateY: 16, duration: 150 });
  expect(keyBarMotion(false, true)).toEqual({ opacity: 0, translateY: 0, duration: 0 });
  expect(keyBarMotion(true, true)).toEqual({ opacity: 1, translateY: 0, duration: 0 });
 });
});

describe("Android's bottom gesture zone (S5)", () => {
 // Samsung S24 Ultra, gesture navigation, density 2.8125: nav bar 42 px (15 dp), mandatory gestures 90 px (32 dp).
 const s24 = { mandatoryBottom: 32, navigationBottom: 15 };
 it("uses the real mandatory gesture inset, which can be taller than the safe-area bottom", () => {
  expect(keyBarGestureInset(s24, 14.93)).toBe(32);
 });
 it("never goes below the safe-area bottom or the navigation bar (3-button nav reports no gesture zone)", () => {
  expect(keyBarGestureInset({ mandatoryBottom: 0, navigationBottom: 48 }, 48)).toBe(48);
  expect(keyBarGestureInset({ mandatoryBottom: 0, navigationBottom: 48 }, 0)).toBe(48);
  expect(keyBarGestureInset({ mandatoryBottom: 10, navigationBottom: 0 }, 20)).toBe(20);
 });
 it("falls back to max(safe-area bottom, 32 dp) when the native reading is unavailable", () => {
  expect(KEY_BAR_GESTURE_FALLBACK).toBe(32);
  expect(keyBarGestureInset(null, 15)).toBe(32);
  expect(keyBarGestureInset(null, 48)).toBe(48);
 });
});

describe("the hidden modes' handles never cover the terminal (S8, S9)", () => {
 it("a free size between 12 and 40 dp, 14 by default (fits a gesture-navigation band)", () => {
  expect(KEY_BAR_HANDLE_SIZE).toEqual({ min: 12, max: 40, default: 14 });
  expect([clampKeyBarHandleSize(3), clampKeyBarHandleSize(17.4), clampKeyBarHandleSize(99)]).toEqual([12, 17, 40]);
  expect(keyBarHandleMetrics(20)).toMatchObject({ pillHeight: 20, pillWidth: 56 });
  for (let size = 12; size <= 40; size++) expect(keyBarHandleMetrics(size).touchWidth).toBeGreaterThanOrEqual(48);
 });
 it("go in the empty bottom band when the pills fit there (S24 Ultra: 15 dp band)", () => {
  expect(keyBarHandleSlot("auto", 14, 15)).toEqual({ place: "band", height: 15 });
  // S8: by default the handles use the empty band of a typical gesture-navigation phone (S24 Ultra: 42 px at 450 dpi ≈ 15 dp).
  expect(keyBarHandleSlot("auto", KEY_BAR_HANDLE_SIZE.default, 15)).toEqual({ place: "band", height: 15 });
  expect(keyBarHandleSlot("tap", 20, 48)).toEqual({ place: "band", height: 48 });
  expect(keyBarHandleSlot("tap", 20, 20)).toEqual({ place: "band", height: 20 });
 });
 it("a size larger than the band, a thin band or none (3-button nav, DeX, keyboard open) gets a row of that size", () => {
  expect(KEY_BAR_BAND_MIN).toBe(12);
  expect(keyBarHandleSlot("auto", 20, 15)).toEqual({ place: "row", height: 20 });
  expect(keyBarHandleSlot("tap", 40, 34)).toEqual({ place: "row", height: 40 });
  expect(keyBarHandleSlot("tap", 12, 10)).toEqual({ place: "row", height: 12 });
  expect(keyBarHandleSlot("auto", 20, 0)).toEqual({ place: "row", height: 20 });
 });
 it("«Siempre visible» has no handles of its own", () => {
  expect(keyBarHandleSlot("always", 20, 48)).toBeNull();
 });
 it("the terminal always ends above them: band below it, or a row it gives up", () => {
  // y measured up from the screen's bottom; the terminal box ends at chromeBottom + row + bar.
  for (const mode of ["auto", "tap"] as const) for (const size of [12, 20, 40]) for (const chromeBottom of [0, 10, 15, 24, 48]) for (const bar of [0, 58]) {
   const slot = keyBarHandleSlot(mode, size, chromeBottom)!;
   const row = slot.place === "row" ? slot.height : 0;
   const handles = slot.place === "band" ? { bottom: 0, top: chromeBottom } : { bottom: chromeBottom, top: chromeBottom + row };
   const terminalBottom = chromeBottom + row + bar;
   expect(handles.top).toBeLessThanOrEqual(terminalBottom);
   expect(handles.top - handles.bottom).toBeGreaterThanOrEqual(size);
  }
 });
});
