import { describe, expect, it } from "vitest";
import { addToBar, defaultTerminalKeys, removeFromBar, saveCustom, setPadSlot, type CustomButton, type KeyEdit, type KeyRefusal, type TerminalKeyLayout } from "../src/core/terminal-keys";
import {
 KEY_GROUPS, barInsertIndex, barMeter, catalogGroups, customFormProblems, draftChanged, draftReducer, dropAction, formButton, formIgnoresCtrl, meterWith,
 newCustomId, padSlotAt, refusalMessage, startDraft,
} from "../src/ui/terminal-keys-draft";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

const ok = (result: KeyEdit) => { if (!result.ok) throw new Error(result.reason); return result.layout; };
const button = (over: Partial<CustomButton> = {}): CustomButton => ({ id: "b1", name: "Estado", text: "git status", enter: true, ignoreCtrl: true, ...over });
const roomy = () => ok(removeFromBar(ok(removeFromBar(defaultTerminalKeys(), "attach")), "mic"));

describe("keys editor draft (S2)", () => {
 it("starts from the saved layout, unchanged", () => {
  const state = startDraft(defaultTerminalKeys());
  expect(state.draft).toEqual(defaultTerminalKeys());
  expect(state.refusal).toBeNull();
  expect(draftChanged(state)).toBe(false);
 });
 it("edits only the draft until it is saved", () => {
  const saved = defaultTerminalKeys();
  const state = draftReducer(startDraft(saved), { type: "removeBar", id: "mic" });
  expect(state.draft.bar).not.toContain("mic");
  expect(state.saved).toEqual(saved);
  expect(draftChanged(state)).toBe(true);
  const after = draftReducer(state, { type: "saved", layout: state.draft });
  expect(draftChanged(after)).toBe(false);
 });
 it("keeps the draft and reports the reason when an edit is refused", () => {
  const start = startDraft(defaultTerminalKeys());
  const fixed = draftReducer(start, { type: "removeBar", id: "ctrl" });
  expect(fixed.refusal).toBe("fixed"); expect(fixed.draft).toEqual(start.draft);
  const full = draftReducer(start, { type: "addBar", id: "f5" });
  expect(full.refusal).toBe("full"); expect(full.draft).toEqual(start.draft);
  expect(draftReducer(start, { type: "addBar", id: "esc" }).refusal).toBe("duplicate");
  expect(draftReducer(full, { type: "dismiss" }).refusal).toBeNull();
  // A successful edit clears an old refusal.
  expect(draftReducer(full, { type: "removeBar", id: "mic" }).refusal).toBeNull();
 });
 it("nudges a placed key left or right, fixed keys included, and stops at the ends", () => {
  const start = startDraft(defaultTerminalKeys());
  expect(draftReducer(start, { type: "nudge", id: "esc", by: -1 }).draft.bar.slice(2, 4)).toEqual(["esc", "prefix"]);
  expect(draftReducer(start, { type: "nudge", id: "ctrl", by: 1 }).draft.bar.slice(1, 3)).toEqual(["prefix", "ctrl"]);
  expect(draftReducer(start, { type: "nudge", id: "attach", by: -1 }).draft).toEqual(start.draft);
  expect(draftReducer(start, { type: "nudge", id: "keyboard", by: 1 }).draft).toEqual(start.draft);
 });
 it("places pad keys, empties slots, and refuses app controls on the pad", () => {
  const start = startDraft(defaultTerminalKeys());
  expect(draftReducer(start, { type: "setSlot", slot: 6, id: "tab" }).draft.pad[6]).toBe("tab");
  expect(draftReducer(start, { type: "setSlot", slot: 4, id: null }).draft.pad[4]).toBeNull();
  expect(draftReducer(start, { type: "setSlot", slot: 6, id: "mic" }).refusal).toBe("unknown");
 });
 it("restores the original bar and pad but keeps custom buttons (S3)", () => {
  let state = startDraft(ok(saveCustom(roomy(), button())));
  state = draftReducer(state, { type: "addBar", id: "custom:b1" });
  state = draftReducer(state, { type: "restore" });
  expect(state.draft.bar).toEqual(defaultTerminalKeys().bar);
  expect(state.draft.pad).toEqual(defaultTerminalKeys().pad);
  expect(state.draft.custom).toEqual([button()]);
 });
 it("creates, edits and deletes custom buttons in the draft (S5)", () => {
  let state = draftReducer(startDraft(defaultTerminalKeys()), { type: "saveCustom", button: button() });
  expect(state.draft.custom).toEqual([button()]);
  state = draftReducer(state, { type: "saveCustom", button: button({ name: "" }) });
  expect(state.refusal).toBe("name"); expect(state.draft.custom).toEqual([button()]);
  state = draftReducer(state, { type: "setSlot", slot: 6, id: "custom:b1" });
  state = draftReducer(state, { type: "deleteCustom", id: "b1" });
  expect(state.draft.custom).toEqual([]); expect(state.draft.pad[6]).toBeNull();
 });
});

describe("space meter (S2 hard limit)", () => {
 it("shows the room left in dp and how full the bar is", () => {
  const meter = barMeter(defaultTerminalKeys());
  expect(meter.remaining).toBe(22);
  expect(meter.level).toBe("almost");
  expect(meter.used).toBeGreaterThan(0.9); expect(meter.used).toBeLessThanOrEqual(1);
  expect(barMeter(roomy()).level).toBe("room");
 });
 it("says «Sin espacio» when not even the narrowest key fits", () => {
  const full = ok(addToBar(defaultTerminalKeys(), "left"));
  expect(barMeter(full)).toMatchObject({ remaining: 0, level: "full", used: 1 });
 });
 it("predicts the result before a key is dropped, and refuses what doesn't fit", () => {
  expect(meterWith(defaultTerminalKeys(), "left")).toMatchObject({ fits: true, meter: { remaining: 0, level: "full" } });
  expect(meterWith(defaultTerminalKeys(), "f5")).toEqual({ fits: false, meter: null });
  expect(meterWith(defaultTerminalKeys(), "esc")).toEqual({ fits: false, meter: null });
 });
});

describe("refusal messages", () => {
 it("has plain text in both languages for every KeyEdit reason", () => {
  const reasons: KeyRefusal[] = ["fixed", "full", "duplicate", "unknown", "missing", "slot", "id", "name", "text", "limit"];
  for (const strings of [es, en]) for (const reason of reasons) expect(refusalMessage(reason, strings.terminalKeys).length).toBeGreaterThan(8);
  expect(refusalMessage("full", es.terminalKeys)).toBe("No entra: sacá otra tecla primero");
 });
});

describe("catalog groups (S4)", () => {
 it("groups every catalog key in the artboard's order, with own buttons last", () => {
  expect(KEY_GROUPS).toEqual(["tools", "basic", "navigation", "combos", "functions", "herdr", "custom"]);
  const groups = catalogGroups(ok(saveCustom(defaultTerminalKeys(), button())));
  expect(groups.map(g => g.group)).toEqual(KEY_GROUPS);
  expect(groups.find(g => g.group === "tools")?.keys.map(k => k.id)).toEqual(["attach", "ctrl", "prefix", "paste", "mic", "dpad", "keyboard"]);
  expect(groups.find(g => g.group === "custom")?.keys.map(k => k.id)).toEqual(["custom:b1"]);
  expect(catalogGroups(defaultTerminalKeys()).find(g => g.group === "custom")?.keys).toEqual([]);
 });
});

describe("drag and drop", () => {
 const rects = [0, 30, 60].map(x => ({ x, y: 0, width: 28, height: 44 }));
 it("finds where a key lands in the bar from the finger's x", () => {
  expect(barInsertIndex(rects, -5)).toBe(0);
  expect(barInsertIndex(rects, 10)).toBe(0);
  expect(barInsertIndex(rects, 20)).toBe(1);
  expect(barInsertIndex(rects, 75)).toBe(3);
 });
 it("finds the D-pad slot under the finger", () => {
  const slots = Array.from({ length: 9 }, (_, i) => ({ x: i % 3 * 70, y: Math.floor(i / 3) * 70, width: 64, height: 64 }));
  expect(padSlotAt(slots, { x: 10, y: 150 })).toBe(6);
  expect(padSlotAt(slots, { x: 67, y: 10 })).toBeNull();
  expect(padSlotAt(slots, { x: 400, y: 10 })).toBeNull();
 });
 it("turns a drop into the same edits as the tap alternative", () => {
  const layout = defaultTerminalKeys();
  expect(dropAction(layout, { from: "catalog", id: "left" }, { bar: 3 })).toEqual({ type: "addBar", id: "left", index: 3 });
  expect(dropAction(layout, { from: "catalog", id: "tab" }, { slot: 6 })).toEqual({ type: "setSlot", slot: 6, id: "tab" });
  expect(dropAction(layout, { from: "catalog", id: "tab" }, null)).toBeNull();
  // Moving within the bar: the index is counted before lifting the key.
  expect(dropAction(layout, { from: "bar", id: "esc" }, { bar: 6 })).toEqual({ type: "moveBar", id: "esc", index: 5 });
  expect(dropAction(layout, { from: "bar", id: "esc" }, { bar: 1 })).toEqual({ type: "moveBar", id: "esc", index: 1 });
  expect(dropAction(layout, { from: "bar", id: "mic" }, null)).toEqual({ type: "removeBar", id: "mic" });
  expect(dropAction(layout, { from: "pad", id: "esc", slot: 0 }, { slot: 8 })).toEqual({ type: "setSlot", slot: 8, id: "esc" });
  expect(dropAction(layout, { from: "pad", id: "esc", slot: 0 }, null)).toEqual({ type: "setSlot", slot: 0, id: null });
 });
 it("a fixed key dragged out of the bar is refused, not removed", () => {
  const state = draftReducer(startDraft(defaultTerminalKeys()), dropAction(defaultTerminalKeys(), { from: "bar", id: "prefix" }, null)!);
  expect(state.refusal).toBe("fixed"); expect(state.draft.bar).toContain("prefix");
 });
});

describe("custom button form (S5)", () => {
 const form = (over = {}) => ({ id: null as string | null, name: "Estado", text: "git status", enter: true, ...over });
 it("names the problem under each field", () => {
  expect(customFormProblems(form())).toEqual({ name: null, text: null });
  expect(customFormProblems(form({ name: "  ", text: "" }))).toEqual({ name: "empty", text: "empty" });
  expect(customFormProblems(form({ name: "ABCDEFGHI" })).name).toBe("long");
  expect(customFormProblems(form({ name: "a\tb" })).name).toBe("invalid");
  expect(customFormProblems(form({ text: "x".repeat(513) })).text).toBe("long");
  expect(customFormProblems(form({ text: "a\u0000" })).text).toBe("invalid");
 });
 it("builds a button with a fresh valid id, or keeps the edited one", () => {
  const layout: TerminalKeyLayout = ok(saveCustom(defaultTerminalKeys(), button()));
  const created = formButton(form(), layout, () => 0.5, () => 1_700_000_000_000);
  expect(created.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  expect(created.id).not.toBe("b1");
  expect(formButton(form({ id: "b1", name: "Otro" }), layout)).toEqual(button({ name: "Otro" }));
  expect(ok(saveCustom(layout, created)).custom).toHaveLength(2);
 });
 it("«Ignorar Ctrl» starts on for a new button and keeps an edited button's choice", () => {
  const layout = ok(saveCustom(defaultTerminalKeys(), button({ ignoreCtrl: false })));
  expect(formIgnoresCtrl(form(), layout)).toBe(true);
  expect(formButton(form(), layout).ignoreCtrl).toBe(true);
  expect(formIgnoresCtrl(form({ id: "b1" }), layout)).toBe(false);
  expect(formButton(form({ id: "b1" }), layout).ignoreCtrl).toBe(false);
  expect(formButton(form({ id: "b1", ignoreCtrl: true }), layout).ignoreCtrl).toBe(true);
  expect(formButton(form({ ignoreCtrl: false }), layout).ignoreCtrl).toBe(false);
 });
 it("never reuses an existing id", () => {
  let calls = 0;
  const clock = () => (calls++ === 0 ? 0 : 1);
  const first = newCustomId(defaultTerminalKeys(), () => 0, () => 0);
  const layout = ok(saveCustom(defaultTerminalKeys(), button({ id: first })));
  const next = newCustomId(layout, () => 0, clock);
  expect(next).not.toBe(first); expect(next).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
 });
 it("a removed pad key slot can take a custom button", () => {
  const layout = ok(setPadSlot(ok(saveCustom(defaultTerminalKeys(), button())), 8, "custom:b1"));
  expect(layout.pad[8]).toBe("custom:b1");
 });
});
