import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TERMINAL_FONT, TerminalFontPreference, parseTerminalFontSize, stepTerminalFontSize, type TerminalFontStore } from "../src/core/terminal-font";

class FakeTerminalFontStore implements TerminalFontStore {
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

describe("terminal font size preference", () => {
 it("starts with the stored size", () => {
  expect(new TerminalFontPreference(new FakeTerminalFontStore("20")).get()).toBe(20);
 });
 it.each([null, "", "nope", "14.5", "7", "29", "\"20\"", "null", "{}"])("falls back to 14 for stored %j", raw => {
  expect(parseTerminalFontSize(raw)).toBe(14);
  expect(new TerminalFontPreference(new FakeTerminalFontStore(raw)).get()).toBe(TERMINAL_FONT.default);
 });
 it("falls back to 14 when the store cannot be read", () => {
  expect(new TerminalFontPreference(new FakeTerminalFontStore("20", true)).get()).toBe(14);
 });
 it("accepts the 8 and 28 bounds", () => {
  expect(parseTerminalFontSize("8")).toBe(8);
  expect(parseTerminalFontSize("28")).toBe(28);
 });
 it("saves a pinch size, notifies listeners, and ignores sizes the page could not send", async () => {
  const store = new FakeTerminalFontStore(); const font = new TerminalFontPreference(store);
  const seen: number[] = []; const off = font.subscribe(value => seen.push(value));
  await font.set(18);
  expect(font.get()).toBe(18); expect(store.stored).toBe("18"); expect(seen).toEqual([18]);
  for (const bad of [7, 29, 12.5, Number.NaN]) await font.set(bad);
  await font.set(18);
  expect(store.writes).toEqual(["18"]); expect(seen).toEqual([18]);
  off(); await font.set(19); expect(seen).toEqual([18]);
 });
 it("coalesces a fast pinch so the last size wins on disk", async () => {
  const store = new FakeTerminalFontStore(); store.hold = true; const font = new TerminalFontPreference(store);
  const saves = [15, 16, 17, 18].map(value => font.set(value));
  expect(font.get()).toBe(18);
  store.pending.shift()!(); await flush();
  store.pending.shift()!();
  await Promise.all(saves);
  expect(store.writes).toEqual(["15", "18"]); expect(store.stored).toBe("18");
 });
 it("keeps the new size in memory and reports a failed save", async () => {
  const store = new FakeTerminalFontStore(); store.fail = true; const font = new TerminalFontPreference(store);
  await expect(font.set(20)).rejects.toThrow("disk full");
  expect(font.get()).toBe(20);
  store.fail = false; await font.set(21); expect(store.stored).toBe("21");
 });
 it("steps by one and clamps at 8 and 28", () => {
  expect(stepTerminalFontSize(14, 1)).toBe(15);
  expect(stepTerminalFontSize(8, -1)).toBe(8);
  expect(stepTerminalFontSize(28, 1)).toBe(28);
 });
});

describe("terminal screen font wiring", () => {
 const screen = readFileSync(new URL("../src/app/session/terminal/[id].tsx", import.meta.url), "utf8");
 it("starts from the stored size instead of a hard-coded 14", () => {
  expect(screen).not.toContain("useState(14)");
  expect(screen).toContain("useState(terminalFont.get)");
  expect(screen).toContain("terminalFont.subscribe(setFontSize)");
 });
 it("saves pinch zoom through the preference", () => {
  expect(screen).toContain("else if (message.type === \"fontSize\") void terminalFont.set(message.value)");
 });
});
