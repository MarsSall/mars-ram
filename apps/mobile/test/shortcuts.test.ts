import { describe, expect, it } from "vitest";
import { addShortcut, removeShortcut, shortcutLabel, parseRepos, parseLaunch, parseStoredShortcuts } from "../src/core/shortcuts";

const a = { id: "1", computerId: "c", repoPath: "/Work/a", repoName: "a", program: "pi" as const };
const b = { ...a, id: "2", program: "opencode" as const };
const json = JSON.stringify;
describe("session shortcuts", () => {
 it("deduplicates by computer, repository and program while keeping order", () => {
  expect(addShortcut([a, b], { ...a, id: "3" })).toEqual([a, b]);
  expect(addShortcut([a], b)).toEqual([a, b]);
  expect(removeShortcut([a, b], "1")).toEqual([b]);
  expect(shortcutLabel(a)).toBe("a · Pi");
  expect(() => addShortcut([], { ...a, program: "evil" } as never)).toThrow();
 });
 it("loads versioned preferences and treats damage as empty", () => {
  expect(parseStoredShortcuts(json({ version: 1, shortcuts: [a, b] }))).toEqual([a, b]);
  expect(parseStoredShortcuts("{" )).toEqual([]);
  expect(parseStoredShortcuts(json({ version: 2, shortcuts: [a] }))).toEqual([]);
  expect(parseStoredShortcuts(json({ version: 1, shortcuts: [{ ...a, program: "unknown" }] }))).toEqual([]);
 });
 it("preserves over-cap storage and refuses only new additions at the limit", () => {
  const rows = Array.from({ length: 501 }, (_, i) => ({ ...a, id: String(i), repoPath: `/r${i}` }));
  expect(parseStoredShortcuts(json({ version: 1, shortcuts: rows }))).toEqual(rows);
  expect(() => addShortcut(rows.slice(0, 500), b)).toThrow("SHORTCUT_LIMIT");
  expect(addShortcut(rows, rows[0])).toEqual(rows);
  expect(removeShortcut(rows, "0")).toHaveLength(500);
 });
 it("strictly parses repository envelopes", () => {
  const valid = { version: 1, ok: true, roots: ["/Work"], repos: [{ path: "/Work/a", name: "a", root: "/Work" }], truncated: false };
  expect(parseRepos(json(valid))).toEqual(valid);
  for (const value of [{ ...valid, version: 2 }, { ...valid, extra: 1 }, { ...valid, repos: [{ path: 2, name: "a", root: "/Work" }] }, { ...valid, truncated: 0 }]) expect(() => parseRepos(json(value))).toThrow();
  expect(parseRepos(json({ version: 1, ok: false, code: "CONFIG_FAILED", message: "failed" }))).toEqual({ version: 1, ok: false, code: "CONFIG_FAILED", message: "failed" });
  expect(() => parseRepos(json({ version: 1, ok: false, code: "UNKNOWN", message: "bad" }))).toThrow();
 });
 it("strictly parses launch envelopes and scoped tab IDs", () => {
  const valid = { version: 1, ok: true, reused: false, workspace: "w1", tab: "w1:t2" };
  expect(parseLaunch(json(valid))).toEqual(valid);
  for (const value of [{ ...valid, tab: "w2:t2" }, { ...valid, reused: "yes" }, { ...valid, other: true }, { ...valid, ok: false }]) expect(() => parseLaunch(json(value))).toThrow();
  expect(parseLaunch(json({ version: 1, ok: false, code: "PROGRAM_NOT_FOUND", message: "missing" })).ok).toBe(false);
  expect(() => parseLaunch("not json")).toThrow();
 });
});
