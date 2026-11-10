import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TerminalKeysPreference, addToBar, defaultTerminalKeys, removeFromBar, serializeTerminalKeys, type TerminalKeyLayout, type TerminalKeysStore } from "../src/core/terminal-keys";

class FakeTerminalKeysStore implements TerminalKeysStore {
 writes: string[] = []; pending: (() => void)[] = []; hold = false; fail = false;
 constructor(public stored: string | null = null, private readonly broken = false) {}
 read() { if (this.broken) throw new Error("unreadable"); return this.stored; }
 write(text: string) {
  this.writes.push(text);
  if (this.fail) return Promise.reject(new Error("disk full"));
  if (!this.hold) { this.stored = text; return Promise.resolve(); }
  return new Promise<void>(resolve => this.pending.push(() => { this.stored = text; resolve(); }));
 }
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const without = (...ids: Parameters<typeof removeFromBar>[1][]) => ids.reduce<TerminalKeyLayout>((layout, id) => {
 const result = removeFromBar(layout, id); if (!result.ok) throw new Error(result.reason); return result.layout;
}, defaultTerminalKeys());

describe("terminal keys preference (S6)", () => {
 it("starts with the stored layout", () => {
  const stored = without("attach");
  expect(new TerminalKeysPreference(new FakeTerminalKeysStore(serializeTerminalKeys(stored))).get()).toEqual(stored);
 });
 it.each([null, "", "nope", "{\"v\":9}"])("starts with the original keys for stored %j", raw => {
  expect(new TerminalKeysPreference(new FakeTerminalKeysStore(raw)).get()).toEqual(defaultTerminalKeys());
 });
 it("starts with the original keys when the store cannot be read", () => {
  expect(new TerminalKeysPreference(new FakeTerminalKeysStore(serializeTerminalKeys(without("attach")), true)).get()).toEqual(defaultTerminalKeys());
 });
 it("saves, notifies listeners live, and skips unchanged layouts", async () => {
  const store = new FakeTerminalKeysStore(); const keys = new TerminalKeysPreference(store);
  const seen: TerminalKeyLayout[] = []; const off = keys.subscribe(value => seen.push(value));
  const next = without("mic");
  await keys.set(next);
  expect(keys.get()).toEqual(next); expect(store.stored).toBe(serializeTerminalKeys(next)); expect(seen).toEqual([next]);
  await keys.set(without("mic"));
  expect(store.writes).toHaveLength(1);
  off(); await keys.set(without("attach")); expect(seen).toHaveLength(1);
 });
 it("repairs what it is given like stored data (fixed keys come back)", async () => {
  const store = new FakeTerminalKeysStore(); const keys = new TerminalKeysPreference(store);
  await keys.set({ ...defaultTerminalKeys(), bar: ["esc"] });
  expect(keys.get().bar).toEqual(["ctrl", "prefix", "esc", "keyboard"]);
 });
 it("never hands out its own copy", () => {
  const keys = new TerminalKeysPreference(new FakeTerminalKeysStore());
  keys.get().bar.length = 0;
  expect(keys.get().bar).toEqual(defaultTerminalKeys().bar);
 });
 it("coalesces fast saves so the last layout wins on disk", async () => {
  const store = new FakeTerminalKeysStore(); store.hold = true; const keys = new TerminalKeysPreference(store);
  const layouts = [without("attach"), without("mic"), without("tab"), without("paste")];
  const saves = layouts.map(layout => keys.set(layout));
  expect(keys.get()).toEqual(layouts[3]);
  store.pending.shift()!(); await flush();
  store.pending.shift()!();
  await Promise.all(saves);
  expect(store.writes).toEqual([serializeTerminalKeys(layouts[0]), serializeTerminalKeys(layouts[3])]);
 });
 it("keeps the new layout in memory and reports a failed save", async () => {
  const store = new FakeTerminalKeysStore(); store.fail = true; const keys = new TerminalKeysPreference(store);
  await expect(keys.set(without("attach"))).rejects.toThrow("disk full");
  expect(keys.get()).toEqual(without("attach"));
  store.fail = false;
  const added = addToBar(without("attach", "mic"), "ctrl+c");
  if (!added.ok) throw new Error(added.reason);
  await keys.set(added.layout); expect(store.stored).toBe(serializeTerminalKeys(added.layout));
 });
 it("retries the same layout after a failed save («Guardar» again)", async () => {
  const store = new FakeTerminalKeysStore(); store.fail = true; const keys = new TerminalKeysPreference(store);
  await expect(keys.set(without("attach"))).rejects.toThrow("disk full");
  store.fail = false;
  await keys.set(without("attach"));
  expect(store.stored).toBe(serializeTerminalKeys(without("attach")));
  await keys.set(without("attach"));
  expect(store.writes).toHaveLength(2);
 });
});

describe("terminal keys wiring", () => {
 it("stores the one global layout in its own private file, exposed to screens through services", () => {
  const adapter = readFileSync(new URL("../src/adapters/file-terminal-keys.ts", import.meta.url), "utf8");
  const services = readFileSync(new URL("../src/services.ts", import.meta.url), "utf8");
  expect(adapter).toContain("\"terminal-keys.json\"");
  expect(adapter).toContain("writeDurable");
  expect(services).toContain("export const terminalKeys = new TerminalKeysPreference(fileTerminalKeys)");
 });
});
