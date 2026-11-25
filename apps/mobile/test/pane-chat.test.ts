import { describe, expect, it } from "vitest";
import { chatSessionForPane, terminalChatSession, focusedHerdrPane, currentPaneChatBinding, fullChatMetadata, nextPaneChatBinding } from "../src/core/pane-chat";
import type { SessionSummary } from "../src/core/session-list";
const a: SessionSummary = { key: "host/a", hostId: "host", bridgeInstanceId: "a", terminalPane: "w2G:p2", project: "a", cwd: "/a", status: "done", lastActivityAt: 1, lastMessage: null };
const b = { ...a, key: "host/b", terminalPane: "w2G:p3" };
describe("pane chat", () => {
 it("F1: never falls back for known ambiguous or concrete unmatched focus", () => {
  expect(terminalChatSession("host", a.key, null, [a])).toBeUndefined();
  expect(terminalChatSession("host", a.key, "w2G:p4", [])).toBeUndefined();
  expect(terminalChatSession("host", a.key, "w2G:p4", [{ ...a, terminalPane: undefined, hostId: "other" }])).toBeUndefined();
 });
 it("keeps the live route session when its older bridge reports no pane, unless a newer bridge owns the focused pane", () => {
  const oldA = { ...a, terminalPane: undefined };
  expect(terminalChatSession("host", a.key, "w2G:p2", [oldA])).toBe(a.key);
  expect(terminalChatSession("host", a.key, null, [oldA])).toBe(a.key);
  expect(terminalChatSession("host", a.key, "w2G:p3", [oldA, b])).toBe(b.key);
  expect(terminalChatSession("host", undefined, "w2G:p2", [oldA])).toBeUndefined();
 });
 it("F2: rejects cached bindings from a different route on the same host", () => {
  const cached = { hostId: "host", routeKey: a.key, key: a.key, session: a };
  expect(currentPaneChatBinding(cached, "host", b.key)).toEqual({ key: b.key });
  expect(currentPaneChatBinding(cached, "host", undefined)).toEqual({ key: undefined });
  expect(currentPaneChatBinding(cached, "other", a.key)).toEqual({ key: a.key });
  expect(currentPaneChatBinding(cached, "host", a.key)).toBe(cached);
 });
 it("F3: full chat uses mapped metadata, retaining params only for the route session", () => {
  const route = { project: "route project", cwd: "/route" };
  expect(fullChatMetadata(b.key, a.key, { ...b, project: "mapped", cwd: "/mapped" }, route)).toEqual({ project: "mapped", cwd: "/mapped" });
  expect(fullChatMetadata(a.key, a.key, a, route)).toEqual(route);
  expect(fullChatMetadata(b.key, a.key, undefined, route)).toEqual({});
 });
 it("matches only a live session on the same host, including either bridge agent", () => {
  expect(chatSessionForPane("host", "w2G:p2", [a, b])?.key).toBe(a.key);
  expect(chatSessionForPane("other", "w2G:p2", [a])).toBeUndefined();
  expect(chatSessionForPane("host", undefined, [a])).toBeUndefined();
  expect(chatSessionForPane("host", "w2G:p2", [{ ...a, terminalPane: undefined }])).toBeUndefined();
 });
 it("preserves legacy route binding, switches sessions and hides on unmatched panes", () => {
  expect(terminalChatSession("host", a.key, undefined, [a, b])).toBe(a.key);
  expect(terminalChatSession("host", a.key, "w2G:p2", [a, b])).toBe(a.key);
  expect(terminalChatSession("host", a.key, "w2G:p3", [a, b])).toBe(b.key);
  expect(terminalChatSession("host", a.key, "w2G:p4", [a, b])).toBeUndefined();
  expect(terminalChatSession("host", a.key, undefined, [{ ...a, terminalPane: undefined }])).toBe(a.key);
  expect(terminalChatSession("host", undefined, "w2G:p2", [a])).toBe(a.key);
 });
 it("uses the focused pane or an unambiguous focused-tab singleton, never another tab", () => {
  const tab = { id: "w2G:t1", label: "x", focused: true, status: "idle" as const, kind: "shell" as const, panes: [{ id: "w2G:p2", focused: false }] };
  const w = { id: "w2G", label: "x", focused: true, status: "idle" as const, branch: null, tabs: [tab] };
  expect(focusedHerdrPane({ workspaces: [w], truncated: false })).toBe("w2G:p2");
  expect(focusedHerdrPane({ workspaces: [{ ...w, tabs: [{ ...tab, panes: [...tab.panes, { id: "w2G:p3", focused: true }] }] }], truncated: false })).toBe("w2G:p3");
  expect(focusedHerdrPane({ workspaces: [{ ...w, tabs: [{ ...tab, panes: undefined }] }], truncated: false })).toBeUndefined();
  const ambiguous = focusedHerdrPane({ workspaces: [{ ...w, tabs: [{ ...tab, panes: [...tab.panes, { id: "w2G:p3", focused: false }] }] }], truncated: false });
  expect(ambiguous).toBeNull();
  expect(terminalChatSession("host", a.key, ambiguous, [a])).toBeUndefined();
 });
});

// claude-codex L20: the chat target only changes by an explicit user action.
describe("pane chat target stays put without an explicit action", () => {
 const claude: SessionSummary = { ...a, key: "host/claude", terminalPane: "w2G:p2", project: "mars-ram", agent: "claude-code" };
 const lnedev: SessionSummary = { ...a, key: "host/lnedev", terminalPane: "w2G:p9", project: "lnedev", status: "working" };
 it("a poll after another session's tab gets Herdr focus (or finishes) keeps the target", () => {
  const bound = nextPaneChatBinding(null, "host", claude.key, "w2G:p2", [claude, lnedev], "initial");
  expect(bound.key).toBe(claude.key);
  const after = nextPaneChatBinding(bound, "host", claude.key, "w2G:p9", [claude, { ...lnedev, status: "done" }], "poll");
  expect(after.key).toBe(claude.key);
  expect(after.session?.key).toBe(claude.key);
 });
 it("the opened session's terminal is the target even when Herdr still focuses another pane", () => {
  expect(nextPaneChatBinding(null, "host", claude.key, "w2G:p9", [claude, lnedev], "initial").key).toBe(claude.key);
 });
 it("an explicit choice follows the chosen pane", () => {
  const bound = nextPaneChatBinding(null, "host", claude.key, "w2G:p2", [claude, lnedev], "initial");
  const chosen = nextPaneChatBinding(bound, "host", claude.key, "w2G:p9", [claude, lnedev], "explicit");
  expect(chosen.key).toBe(lnedev.key);
  expect(chosen.session?.project).toBe("lnedev");
 });
 it("an explicitly chosen pane without a session gets its session later, never another pane's", () => {
  const bound = nextPaneChatBinding(null, "host", claude.key, "w2G:p2", [claude, lnedev], "initial");
  const empty = nextPaneChatBinding(bound, "host", claude.key, "w2G:p5", [claude, lnedev], "explicit");
  expect(empty.key).toBeUndefined();
  expect(nextPaneChatBinding(empty, "host", claude.key, "w2G:p9", [claude, lnedev], "poll").key).toBeUndefined();
  const started = { ...a, key: "host/new", terminalPane: "w2G:p5" };
  expect(nextPaneChatBinding(empty, "host", claude.key, "w2G:p9", [claude, lnedev, started], "poll").key).toBe(started.key);
 });
 it("a standalone terminal binds once to the focused pane, then keeps it", () => {
  const bound = nextPaneChatBinding(null, "host", undefined, "w2G:p2", [claude, lnedev], "initial");
  expect(bound.key).toBe(claude.key);
  expect(nextPaneChatBinding(bound, "host", undefined, "w2G:p9", [claude, lnedev], "poll").key).toBe(claude.key);
 });
 it("a binding from another route is never reused", () => {
  const bound = nextPaneChatBinding(null, "host", claude.key, "w2G:p2", [claude, lnedev], "initial");
  expect(nextPaneChatBinding(bound, "host", lnedev.key, "w2G:p2", [claude, lnedev], "poll").key).toBe(lnedev.key);
 });
});
