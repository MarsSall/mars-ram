import { describe, expect, it } from "vitest";
import { herdrKeyBytes } from "../src/core/herdr-keys";
import { terminalKey } from "../src/core/herdr-terminal";
import { terminalPadLayout, terminalToolbarKeys, terminalToolbarWidth, type TerminalToolbarKey } from "../src/core/terminal-controls";
import {
 CUSTOM_HOLD_HINT, CUSTOM_HOLD_MS, CUSTOM_LIMITS, FIXED_BAR_KEYS, TERMINAL_KEY_CATALOG, addToBar, customBytes, customFires, customGesture,
 defaultTerminalKeys, fits, moveInBar, padSlots, parseTerminalKeys, remaining, removeCustom, removeFromBar, restore, saveCustom,
 serializeTerminalKeys, setPadSlot, terminalKeyInfo, visibleBar, type CustomButton, type TerminalKeyLayout,
} from "../src/core/terminal-keys";

const moments = [false, true].flatMap(keyboard => [false, true].map(prefixPanel => ({ keyboard, prefixPanel })));
const button = (over: Partial<CustomButton> = {}): CustomButton => ({ id: "b1", name: "Estado", text: "git status", enter: true, ignoreCtrl: true, ...over });
const ok = (result: ReturnType<typeof addToBar>) => { if (!result.ok) throw new Error(result.reason); return result.layout; };
const withCustom = (...buttons: CustomButton[]) => buttons.reduce((layout, b) => ok(saveCustom(layout, b)), defaultTerminalKeys());

describe("default terminal keys", () => {
 it("is exactly today's bar in every moment", () => {
  expect(defaultTerminalKeys().bar).toEqual(terminalToolbarKeys({ keyboard: false, prefixPanel: false }));
  for (const moment of moments) expect(visibleBar(defaultTerminalKeys(), moment)).toEqual(terminalToolbarKeys(moment));
 });
 it("is exactly today's D-pad: seven keys in their places and both bottom corners empty", () => {
  const layout = defaultTerminalKeys();
  expect(layout.pad).toEqual(["esc", "up", "backspace", "left", "enter", "right", null, "down", null]);
  expect(padSlots(layout).map(({ key, x, y }) => ({ key, x, y }))).toEqual(expect.arrayContaining([...terminalPadLayout()]));
  expect(padSlots(layout)).toHaveLength(7);
  expect(layout).toEqual({ v: 1, bar: layout.bar, pad: layout.pad, custom: [] });
 });
 it("returns a fresh copy each time", () => {
  const a = defaultTerminalKeys(); a.bar.pop(); a.pad[0] = null;
  expect(defaultTerminalKeys().bar.at(-1)).toBe("keyboard");
  expect(defaultTerminalKeys().pad[0]).toBe("esc");
 });
});

describe("terminal key catalog", () => {
 it("keeps today's widths for today's keys and has no duplicate ids", () => {
  const ids = TERMINAL_KEY_CATALOG.map(key => key.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ["attach", "ctrl", "prefix", "esc", "tab", "paste", "mic", "up", "down", "left", "right", "enter", "backspace", "dpad", "keyboard"] as TerminalToolbarKey[]) {
   expect(terminalKeyInfo(defaultTerminalKeys(), id)?.width).toBe(terminalToolbarWidth(id));
  }
 });
 it("only lists keys the app can already send", () => {
  for (const key of TERMINAL_KEY_CATALOG) {
   if (key.kind === "key") expect(key.send && "key" in key.send && terminalKey(key.send.key, false).length).toBeGreaterThan(0);
   if (key.kind === "herdr" && key.send && "spec" in key.send) expect(herdrKeyBytes(key.send.spec)).not.toBeNull();
   if (key.kind === "control") expect(key.send).toBeNull();
  }
  for (const id of ["home", "end", "pageUp", "pageDown", "space", "ctrl+c", "ctrl+d", "ctrl+r", "ctrl+l", "ctrl+z", "f1", "f12", "previousAgent", "nextAgent"]) {
   expect(TERMINAL_KEY_CATALOG.some(key => key.id === id)).toBe(true);
  }
 });
 it("keeps app controls out of the D-pad", () => {
  for (const id of ["attach", "ctrl", "prefix", "paste", "mic", "dpad", "keyboard"]) expect(terminalKeyInfo(defaultTerminalKeys(), id as TerminalToolbarKey)?.pad).toBe(false);
  expect(setPadSlot(defaultTerminalKeys(), 6, "mic")).toEqual({ ok: false, reason: "unknown" });
 });
});

describe("fixed keys and the pad toggle (S3)", () => {
 it("refuses to remove Ctrl, PREFIX and Teclado", () => {
  expect(FIXED_BAR_KEYS).toEqual(["ctrl", "prefix", "keyboard"]);
  for (const id of FIXED_BAR_KEYS) expect(removeFromBar(defaultTerminalKeys(), id)).toEqual({ ok: false, reason: "fixed" });
 });
 it("lets the pad toggle go", () => {
  expect(ok(removeFromBar(defaultTerminalKeys(), "dpad")).bar).not.toContain("dpad");
 });
 it("puts a missing fixed key back in its default position when loading", () => {
  const stored = { v: 1, bar: ["attach", "esc", "tab"], pad: defaultTerminalKeys().pad, custom: [] };
  expect(parseTerminalKeys(JSON.stringify(stored)).bar).toEqual(["attach", "ctrl", "prefix", "esc", "tab", "keyboard"]);
  expect(parseTerminalKeys(JSON.stringify({ ...stored, bar: [] })).bar).toEqual(["ctrl", "prefix", "keyboard"]);
 });
});

describe("bar width budget (S2 hard limit)", () => {
 it("measures the room left with today's 360dp math", () => {
  const layout = defaultTerminalKeys();
  const used = layout.bar.reduce((sum, id) => sum + terminalToolbarWidth(id as TerminalToolbarKey), 20 + 14 + (layout.bar.length - 1) * 2);
  expect(remaining(layout)).toBe(360 - used);
  expect(fits(layout)).toBe(true);
 });
 it("refuses a key that doesn't fit and keeps the layout", () => {
  let layout = defaultTerminalKeys();
  const added: string[] = [];
  for (const id of ["ctrl+c", "ctrl+d", "ctrl+z", "f1", "f2"] as const) {
   const result = addToBar(layout, id);
   if (!result.ok) { expect(result.reason).toBe("full"); break; }
   layout = result.layout; added.push(id);
  }
  expect(added.length).toBeLessThan(5);
  expect(remaining(layout)).toBeGreaterThanOrEqual(0);
  const before = serializeTerminalKeys(layout);
  expect(addToBar(layout, "f5")).toEqual({ ok: false, reason: "full" });
  expect(serializeTerminalKeys(layout)).toBe(before);
 });
 it("keeps today's spare room (22dp) and fits a key into freed room", () => {
  expect(remaining(defaultTerminalKeys())).toBe(22);
  const freed = ok(removeFromBar(defaultTerminalKeys(), "attach"));
  expect(remaining(ok(addToBar(freed, "ctrl+c")))).toBe(22);
 });
 it("frees room when a key leaves and sizes custom buttons by name", () => {
  const layout = ok(removeFromBar(ok(removeFromBar(defaultTerminalKeys(), "attach")), "mic"));
  expect(remaining(layout)).toBe(remaining(defaultTerminalKeys()) + 52);
  const custom = withCustom(button());
  expect(terminalKeyInfo(custom, "custom:b1")).toMatchObject({ kind: "custom", label: "Estado", width: 44, pad: true, bar: true });
  expect(terminalKeyInfo(withCustom(button({ name: "A" })), "custom:b1")?.width).toBe(24);
  expect(terminalKeyInfo(withCustom(button({ name: "ABCDEFGH" })), "custom:b1")?.width).toBe(56);
 });
 it("adds before Teclado by default, at a position, and moves keys within the bar", () => {
  const roomy = ok(removeFromBar(defaultTerminalKeys(), "mic"));
  expect(ok(addToBar(roomy, "f5")).bar.slice(-2)).toEqual(["f5", "keyboard"]);
  const layout = ok(addToBar(roomy, "ctrl+c", 3));
  expect(layout.bar.slice(0, 4)).toEqual(["attach", "ctrl", "prefix", "ctrl+c"]);
  expect(ok(moveInBar(layout, "ctrl+c", 0)).bar.slice(0, 2)).toEqual(["ctrl+c", "attach"]);
  expect(ok(moveInBar(layout, "keyboard", 0)).bar[0]).toBe("keyboard");
  expect(moveInBar(layout, "f5", 0)).toEqual({ ok: false, reason: "missing" });
 });
});

describe("bar and pad contents", () => {
 it("refuses duplicates in the bar", () => {
  expect(addToBar(defaultTerminalKeys(), "esc")).toEqual({ ok: false, reason: "duplicate" });
 });
 it("refuses unknown keys and missing custom buttons", () => {
  expect(addToBar(defaultTerminalKeys(), "nope" as never)).toEqual({ ok: false, reason: "unknown" });
  expect(addToBar(defaultTerminalKeys(), "custom:ghost")).toEqual({ ok: false, reason: "unknown" });
 });
 it("allows one key in both the bar and the pad", () => {
  const layout = ok(setPadSlot(defaultTerminalKeys(), 6, "tab"));
  expect(layout.bar).toContain("tab");
  expect(layout.pad[6]).toBe("tab");
 });
 it("moves a pad key instead of duplicating it, and empties a slot", () => {
  const layout = ok(setPadSlot(defaultTerminalKeys(), 8, "esc"));
  expect(layout.pad[0]).toBeNull(); expect(layout.pad[8]).toBe("esc");
  expect(ok(setPadSlot(layout, 4, null)).pad[4]).toBeNull();
  expect(setPadSlot(layout, 9, "tab")).toEqual({ ok: false, reason: "slot" });
 });
 it("dynamic visibility: up/down hide with the keyboard; the PREFIX panel drops the mic and shows four arrows", () => {
  const layout = ok(addToBar(ok(removeFromBar(ok(removeFromBar(defaultTerminalKeys(), "up")), "down")), "left"));
  expect(visibleBar(layout, { keyboard: true, prefixPanel: false })).toContain("left");
  const panel = visibleBar(layout, { keyboard: true, prefixPanel: true });
  expect(panel).toEqual(expect.arrayContaining(["up", "down", "left", "right"]));
  expect(panel).not.toContain("mic");
  expect(remaining({ ...layout, bar: panel })).toBeGreaterThanOrEqual(0);
 });
 it("drops optional keys from the right when the PREFIX panel's arrows need the room", () => {
  let layout = ok(removeFromBar(ok(removeFromBar(defaultTerminalKeys(), "up")), "down"));
  for (const id of ["ctrl+c", "ctrl+d", "ctrl+z", "f1", "f2", "f3"] as const) { const r = addToBar(layout, id); if (r.ok) layout = r.layout; }
  const panel = visibleBar(layout, { keyboard: false, prefixPanel: true });
  expect(panel).toEqual(expect.arrayContaining(["up", "down", "left", "right", ...FIXED_BAR_KEYS]));
  expect(remaining({ ...layout, bar: panel })).toBeGreaterThanOrEqual(0);
 });
});

describe("custom buttons (S5)", () => {
 it("sends the text, plus Enter when asked", () => {
  expect(customBytes(button({ enter: false, text: "ls -la ñ" }))).toEqual(new TextEncoder().encode("ls -la ñ"));
  expect(customBytes(button({ enter: true }))).toEqual(new TextEncoder().encode("git status\r"));
 });
 it("with Enter fires only on press-and-hold; a tap shows the hint", () => {
  expect(customFires(button({ enter: true }), "tap")).toBe(false);
  expect(customFires(button({ enter: true }), "hold")).toBe(true);
  expect(customGesture(button({ enter: true }), "tap")).toBe("hint");
  expect(CUSTOM_HOLD_MS).toBe(500);
  expect(CUSTOM_HOLD_HINT).toBe("holdToSend");
 });
 it("without Enter types on a tap (and on a slow tap)", () => {
  expect(customFires(button({ enter: false }), "tap")).toBe(true);
  expect(customFires(button({ enter: false }), "hold")).toBe(true);
 });
 it("validates name and text before saving", () => {
  const base = defaultTerminalKeys();
  expect(saveCustom(base, button({ name: "" }))).toEqual({ ok: false, reason: "name" });
  expect(saveCustom(base, button({ name: "   " }))).toEqual({ ok: false, reason: "name" });
  expect(saveCustom(base, button({ name: "ABCDEFGHI" }))).toEqual({ ok: false, reason: "name" });
  expect(saveCustom(base, button({ text: "" }))).toEqual({ ok: false, reason: "text" });
  expect(saveCustom(base, button({ text: "a\u0000b" }))).toEqual({ ok: false, reason: "text" });
  expect(saveCustom(base, button({ text: "x".repeat(CUSTOM_LIMITS.text + 1) }))).toEqual({ ok: false, reason: "text" });
  expect(saveCustom(base, button({ id: "bad id" }))).toEqual({ ok: false, reason: "id" });
  expect(ok(saveCustom(base, button({ text: "x".repeat(CUSTOM_LIMITS.text) }))).custom).toHaveLength(1);
  expect(saveCustom(base, { ...button(), ignoreCtrl: "yes" as never })).toEqual({ ok: false, reason: "text" });
  expect(ok(saveCustom(base, button({ ignoreCtrl: false }))).custom[0].ignoreCtrl).toBe(false);
 });
 it("updates a button in place and caps how many exist", () => {
  const layout = ok(saveCustom(withCustom(button()), button({ name: "Otro" })));
  expect(layout.custom).toEqual([button({ name: "Otro" })]);
  let many = defaultTerminalKeys();
  for (let i = 0; i < CUSTOM_LIMITS.buttons; i++) many = ok(saveCustom(many, button({ id: `b${i}` })));
  expect(saveCustom(many, button({ id: "extra" }))).toEqual({ ok: false, reason: "limit" });
 });
 it("refuses a name that would no longer fit the bar it is on", () => {
  const roomy = ok(removeFromBar(ok(removeFromBar(withCustom(button({ name: "A" })), "attach")), "mic"));
  const layout = ok(addToBar(ok(addToBar(roomy, "custom:b1")), "ctrl+c"));
  expect(remaining(layout)).toBe(22);
  expect(saveCustom(layout, button({ name: "ABCDEFGH" }))).toEqual({ ok: false, reason: "full" });
  expect(ok(saveCustom(layout, button({ name: "ABCD" }))).custom[0].name).toBe("ABCD");
 });
 it("removing a button removes it from the bar and the pad", () => {
  let layout = ok(addToBar(ok(removeFromBar(ok(removeFromBar(withCustom(button()), "attach")), "mic")), "custom:b1"));
  layout = ok(setPadSlot(layout, 6, "custom:b1"));
  const removed = removeCustom(layout, "b1");
  expect(removed.custom).toEqual([]);
  expect(removed.bar).not.toContain("custom:b1");
  expect(removed.pad[6]).toBeNull();
 });
});

describe("restore (S3)", () => {
 it("brings back the default bar and pad but keeps custom buttons", () => {
  let layout = ok(addToBar(ok(removeFromBar(ok(removeFromBar(withCustom(button()), "attach")), "mic")), "custom:b1"));
  layout = ok(setPadSlot(layout, 6, "custom:b1"));
  const restored = restore(layout);
  expect(restored.bar).toEqual(defaultTerminalKeys().bar);
  expect(restored.pad).toEqual(defaultTerminalKeys().pad);
  expect(restored.custom).toEqual([button()]);
 });
});

describe("stored layout parsing (S6)", () => {
 const stored = (over: Partial<Record<keyof TerminalKeyLayout, unknown>> = {}) => JSON.stringify({ ...defaultTerminalKeys(), ...over });
 it("reads buttons saved before «Ignorar Ctrl» as ignoring Ctrl, keeps a saved choice, and drops a wrong type", () => {
  const old = { id: "b1", name: "Estado", text: "git status", enter: true };
  expect(parseTerminalKeys(stored({ custom: [old] })).custom).toEqual([button()]);
  expect(parseTerminalKeys(stored({ custom: [{ ...old, ignoreCtrl: false }] })).custom).toEqual([button({ ignoreCtrl: false })]);
  expect(parseTerminalKeys(stored({ custom: [{ ...old, ignoreCtrl: "no" }] })).custom).toEqual([]);
  expect(JSON.parse(serializeTerminalKeys(withCustom(button({ ignoreCtrl: false })))).v).toBe(1);
 });
 it("round-trips a valid layout", () => {
  const layout = ok(setPadSlot(ok(addToBar(ok(removeFromBar(ok(removeFromBar(withCustom(button()), "attach")), "mic")), "custom:b1", 3)), 6, "ctrl+c"));
  expect(parseTerminalKeys(serializeTerminalKeys(layout))).toEqual(layout);
 });
 it.each([null, "", "garbage", "null", "[]", "42", "{}", "{\"v\":1}"])("falls back to the default for %j", raw => {
  expect(parseTerminalKeys(raw)).toEqual(defaultTerminalKeys());
 });
 it("falls back on the wrong version, a wrong-sized pad, or oversized data", () => {
  expect(parseTerminalKeys(stored({ v: 2 }))).toEqual(defaultTerminalKeys());
  expect(parseTerminalKeys(stored({ pad: [null] }))).toEqual(defaultTerminalKeys());
  expect(parseTerminalKeys(stored({ bar: "esc" }))).toEqual(defaultTerminalKeys());
  expect(parseTerminalKeys(stored({ custom: {} }))).toEqual(defaultTerminalKeys());
  expect(parseTerminalKeys("x".repeat(140_000))).toEqual(defaultTerminalKeys());
 });
 it("drops unknown key ids, duplicates and pad controls", () => {
  const layout = parseTerminalKeys(stored({ bar: ["ctrl", "prefix", "warp", 7, "esc", "esc", "keyboard"], pad: ["esc", "teleport", "mic", 3, "esc", null, null, null, null] }));
  expect(layout.bar).toEqual(["ctrl", "prefix", "esc", "keyboard"]);
  expect(layout.pad).toEqual(["esc", null, null, null, null, null, null, null, null]);
 });
 it("drops invalid custom buttons and every reference to them", () => {
  const custom = [button({ id: "long", text: "x".repeat(CUSTOM_LIMITS.text + 1) }), button({ id: "name", name: "ABCDEFGHI" }), button({ id: "nul", text: "\u0000" }), { id: "shape" }, button({ id: "good" })];
  const layout = parseTerminalKeys(stored({ custom, bar: ["ctrl", "prefix", "custom:long", "custom:name", "custom:good", "custom:missing", "keyboard"], pad: ["custom:nul", null, null, null, null, null, null, null, "custom:good"] }));
  expect(layout.custom).toEqual([button({ id: "good" })]);
  expect(layout.bar).toEqual(["ctrl", "prefix", "custom:good", "keyboard"]);
  expect(layout.pad[0]).toBeNull(); expect(layout.pad[8]).toBe("custom:good");
 });
 it("replaces a bar that does not fit with the default bar", () => {
  const all = TERMINAL_KEY_CATALOG.filter(key => key.bar).map(key => key.id);
  const layout = parseTerminalKeys(stored({ bar: all }));
  expect(layout.bar).toEqual(defaultTerminalKeys().bar);
 });
});
