import { describe, expect, it } from "vitest";
import { groupSessions, type ComputerSessions, type SessionSummary } from "../src/core/session-list";

const hosts = [{ id: "a", name: "devbox" }, { id: "b", name: "Mars" }];
const empty = { computers: [], needsYou: [], groupOrder: {} };
const session = (key: string, hostId: string, status: SessionSummary["status"], lastActivityAt: number): SessionSummary => ({ key, hostId, status, lastActivityAt, bridgeInstanceId: key, project: key, cwd: `/work/${key}`, lastMessage: null });
const build = async (computers: ComputerSessions[], saved = hosts) => {
 const { buildHome } = await import("../src/core/home");
 return buildHome(saved, groupSessions(empty, computers, "focus"));
};

describe("home sections", () => {
 it("shows welcome without computers", async () => {
  expect((await build([], [])).kind).toBe("welcome");
 });
 it("selects attention oldest first and identifies each computer", async () => {
  const home = await build([{ hostId: "a", state: "ok", sessions: [session("new", "a", "attention", 20), session("work", "a", "working", 40)] }, { hostId: "b", state: "ok", sessions: [session("old", "b", "attention", 10)] }]);
  expect(home.needsYou.map(s => [s.key, s.computerName])).toEqual([["old", "Mars"], ["new", "devbox"]]);
  expect(home.emptySessions).toBe(false);
 });
 it("groups remaining sessions by computer without duplicating attention", async () => {
  const home = await build([{ hostId: "a", state: "ok", sessions: [session("ask", "a", "attention", 1), session("done", "a", "done", 2), session("work", "a", "working", 3)] }, { hostId: "b", state: "no-pi", sessions: [] }]);
  expect(home.computers.map(c => [c.name, c.sessions.map(s => s.key)])).toEqual([["devbox", ["work", "done"]], ["Mars", []]]);
 });
 it("provides compact status lines without claiming locked or changed hosts respond", async () => {
  const states = ["ok", "no-pi", "unreachable", "locked", "identity-changed"] as const;
  const home = await build(states.map((state, i) => ({ hostId: String(i), state, sessions: [] })), states.map((_, i) => ({ id: String(i), name: `host${i}` })));
  expect(home.computers.map(c => [c.name, c.status])).toEqual([["host0", "responding"], ["host1", "responding"], ["host2", "unreachable"], ["host3", "locked"], ["host4", "identity-changed"]]);
 });
 it("shows empty sessions on a dashboard, not welcome", async () => {
  const home = await build([{ hostId: "a", state: "no-pi", sessions: [] }]);
  expect(home.kind).toBe("dashboard");
  expect(home.emptySessions).toBe(true);
  expect(home.needsYou).toEqual([]);
 });
 it("preserves automatic queue order supplied by the session list", async () => {
  const { buildHome } = await import("../src/core/home");
  const first = groupSessions(empty, [{ hostId: "a", state: "ok", sessions: [session("first", "a", "attention", 20)] }], "focus");
  const next = groupSessions(first, [{ hostId: "a", state: "ok", sessions: [session("second", "a", "attention", 10), session("first", "a", "attention", 30)] }], "automatic");
  expect(buildHome(hosts, next).needsYou.map(s => s.key)).toEqual(["first", "second"]);
 });
});
