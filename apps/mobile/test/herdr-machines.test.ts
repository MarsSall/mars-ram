import { describe, expect, it } from "vitest";
import { finishHerdrRefresh, HerdrSwitcher, parseHerdrList } from "../src/core/herdr-switcher";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";
import { savedHost } from "./fakes";

const workspace = { id: "wX", label: "WindowsOS", focused: true, status: "idle", branch: null, tabs: [] };
const list = (extra: Record<string, unknown> = {}) => JSON.stringify({ version: 1, truncated: false, workspaces: [workspace], ...extra });

describe("Herdr saved machines in the switcher list", () => {
 it("keeps the previous snapshot when an older host omits the field", () => {
  const snapshot = parseHerdrList(list());
  expect(snapshot).toEqual({ workspaces: [workspace], truncated: false });
  expect("machines" in snapshot).toBe(false);
 });
 it("reads the enabled machine labels when present", () => {
  expect(parseHerdrList(list({ machines: ["Beelink", "Old box"] }))).toEqual({ workspaces: [workspace], truncated: false, machines: ["Beelink", "Old box"] });
 });
 it("treats an empty list like an absent field", () => {
  expect("machines" in parseHerdrList(list({ machines: [] }))).toBe(false);
 });
 it.each([
  ["not an array", "Beelink"],
  ["null", null],
  ["a non-string", [1]],
  ["an empty label", [""]],
  ["a blank label", ["  "]],
  ["a control character", ["Bee\nlink"]],
  ["an escape sequence", ["Bee\x1b[31m"]],
  ["a label over 64 characters", ["x".repeat(65)]],
  ["a duplicate", ["Beelink", "Beelink"]],
  ["more than 16 machines", Array.from({ length: 17 }, (_, i) => `Box ${i}`)],
 ])("rejects %s", (_, machines) => {
  expect(() => parseHerdrList(list({ machines }))).toThrow();
 });
 it("carries the labels through the use case and the cached entry", async () => {
  const service = new HerdrSwitcher({ connections: { connection: async () => ({ ok: true, connectionId: "ssh" }) }, host: {
   readFile: async () => ({ ok: true, content: JSON.stringify({ node: "/usr/bin/node", cli: "/home/dev/cli/main.ts" }) }),
   exec: async () => ({ ok: true, stdout: list({ machines: ["Beelink"] }), stderr: "", exitStatus: 0 }),
  } });
  const result = await service.list(savedHost("a"));
  expect(result).toEqual({ ok: true, value: { workspaces: [workspace], truncated: false, machines: ["Beelink"] } });
  if (!result.ok) throw Error("list failed");
  expect(finishHerdrRefresh(undefined, result)).toMatchObject({ state: "ok", machines: ["Beelink"] });
  // A later snapshot without machines must not keep stale labels.
  expect("machines" in finishHerdrRefresh({ state: "ok", workspaces: [], truncated: false, machines: ["Beelink"] }, { ok: true, value: { workspaces: [], truncated: false } })).toBe(false);
 });
 it("explains the line in both languages", () => {
  expect(es.switcher.alsoShows(["Beelink"])).toBe("Este Herdr también muestra: Beelink");
  expect(en.switcher.alsoShows(["Beelink"])).toBe("This Herdr also shows: Beelink");
  expect(en.switcher.alsoShows(["Beelink", "Old box"])).toBe("This Herdr also shows: Beelink, Old box");
 });
});
