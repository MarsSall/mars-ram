import { describe, expect, it } from "vitest";
import { beginHerdrRefresh, finishHerdrRefresh, type HerdrEntry, type HerdrSnapshot } from "../src/core/herdr-switcher";

const snapshot: HerdrSnapshot = { workspaces: [{ id: "wA", label: "Project", focused: true, status: "idle", branch: "main", tabs: [] }], truncated: true };
const success = { ok: true as const, value: snapshot };
const failure = { ok: false as const, code: "HERDR_FAILED" as const };

describe("switcher cached refresh state", () => {
 it("loads only without a cached snapshot, including first-load retry", () => {
  expect(beginHerdrRefresh()).toEqual({ state: "loading" });
  const failed = finishHerdrRefresh(undefined, failure);
  expect(failed).toEqual({ state: "error", code: "HERDR_FAILED" });
  expect(beginHerdrRefresh(failed)).toEqual({ state: "loading" });
 });
 it("keeps rows, counts and truncation immediately on every reopening/refresh", () => {
  let entry: HerdrEntry = finishHerdrRefresh(undefined, success);
  for (let opening = 0; opening < 3; opening++) {
   entry = beginHerdrRefresh(entry);
   expect(entry).toEqual({ state: "ok", ...snapshot });
  }
 });
 it("retains stale rows on refresh failure and clears the warning on success", () => {
  const cached = finishHerdrRefresh(undefined, success);
  const stale = finishHerdrRefresh(beginHerdrRefresh(cached), failure);
  expect(stale).toEqual({ state: "ok", ...snapshot, refreshError: true });
  expect(beginHerdrRefresh(stale)).toEqual(stale);
  expect(finishHerdrRefresh(stale, { ok: true, value: { workspaces: [], truncated: false } })).toEqual({ state: "ok", workspaces: [], truncated: false });
 });
 it("treats a cached empty list as data and keeps computers isolated", () => {
  const entries = {
   a: finishHerdrRefresh(undefined, success),
   b: finishHerdrRefresh(undefined, { ok: true, value: { workspaces: [], truncated: false } }),
  };
  expect(finishHerdrRefresh(entries.b, failure)).toEqual({ state: "ok", workspaces: [], truncated: false, refreshError: true });
  expect(beginHerdrRefresh(entries.a)).toEqual({ state: "ok", ...snapshot });
  expect(beginHerdrRefresh(entries.b)).toEqual({ state: "ok", workspaces: [], truncated: false });
 });
});
