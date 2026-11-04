import { describe, expect, it } from "vitest";
import type { ComputerSessions, SessionSummary } from "../src/core/session-list";
import { orderSessions } from "../src/core/session-order";

const session = (id: string, status: SessionSummary["status"], lastActivityAt: number, hostId = "linux"): SessionSummary => ({
	key: `${hostId}/${id}`, hostId, bridgeInstanceId: id, project: id, cwd: `/work/${id}`, status, lastActivityAt, lastMessage: null,
});
const computer = (hostId: string, sessions: SessionSummary[]): ComputerSessions => ({ hostId, state: "ok", sessions });
const empty = { computers: [], needsYou: [], groupOrder: {} };
const keys = (computers: ComputerSessions[]) => computers.map((c) => c.sessions.map((s) => s.key));

describe("session display order", () => {
	it("appends entering sessions last without moving existing attention rows or computer rows", () => {
		const previous = orderSessions(empty, [computer("linux", [session("a", "working", 30), session("b", "done", 20), session("old", "attention", 10)]), computer("win", [session("w", "attention", 15, "win")])], "focus");
		const updated = { ...session("a", "attention", 1), lastMessage: "Please confirm" };
		const incoming = [computer("win", [session("w", "attention", 100, "win")]), computer("linux", [updated, session("old", "attention", 200), session("b", "working", 300), session("new", "done", 500)])];
		const result = orderSessions(previous, incoming, "automatic");
		expect(result.needsYou.map((s) => s.key)).toEqual(["linux/old", "win/w", "linux/a"]);
		expect(result.needsYou[2]).toEqual(updated);
		expect(keys(result.computers)).toEqual([["linux/b", "linux/new"], []]);
		expect(keys(previous.computers)).toEqual([["linux/a", "linux/b"], []]);
		expect(incoming[0]!.hostId).toBe("win");
	});

	it("returns leaving sessions to their previous group positions while others stay put", () => {
		const initial = orderSessions(empty, [computer("linux", [session("a", "working", 30), session("b", "done", 20), session("c", "done", 10)])], "focus");
		const waiting = orderSessions(initial, [computer("linux", [session("b", "done", 200), session("a", "attention", 100), session("c", "working", 300)])], "automatic");
		expect(keys(waiting.computers)).toEqual([["linux/b", "linux/c"]]);
		const result = orderSessions(waiting, [computer("linux", [session("c", "working", 400), session("a", "done", 500), session("b", "done", 200)])], "automatic");
		expect(keys(result.computers)).toEqual([["linux/a", "linux/b", "linux/c"]]);
		expect(result.needsYou).toEqual([]);
	});

	it("appends a leaving session never previously placed in its computer group", () => {
		const previous = orderSessions(empty, [computer("linux", [session("a", "attention", 10), session("b", "done", 20)])], "focus");
		const added = orderSessions(previous, [computer("linux", [session("a", "attention", 10), session("c", "done", 100), session("b", "done", 20)])], "automatic");
		const result = orderSessions(added, [computer("linux", [session("a", "done", 300), session("c", "done", 100), session("b", "done", 20)])], "automatic");
		expect(keys(result.computers)).toEqual([["linux/b", "linux/c", "linux/a"]]);
	});

	it.each(["focus", "manual"] as const)("%s orders global attention oldest-first and computer groups most-recent-first", (reason) => {
		const incoming = [computer("linux", [session("old", "done", 5), session("prompt", "attention", 20), session("recent", "working", 100)]), computer("win", [session("older-prompt", "attention", 10, "win")])];
		const previous = orderSessions(empty, [computer("linux", [session("old", "done", 200), session("prompt", "attention", 1), session("recent", "working", 2)]), computer("win", [session("older-prompt", "attention", 300, "win")])], "focus");
		const result = orderSessions(previous, incoming, reason);
		expect(keys(result.computers)).toEqual([["linux/recent", "linux/old"], []]);
		expect(result.needsYou.map((s) => s.key)).toEqual(["win/older-prompt", "linux/prompt"]);
	});

	it("preserves a reserved slot through explicit refresh and appends a repeated attention entry last", () => {
		const initial = orderSessions(empty, [computer("linux", [session("a", "working", 30), session("b", "done", 20), session("p", "attention", 1)])], "focus");
		const snapshot = [computer("linux", [session("a", "attention", 40), session("b", "done", 20), session("p", "attention", 1)])];
		const waiting = orderSessions(initial, snapshot, "automatic");
		const focused = orderSessions(waiting, snapshot, "focus");
		const returned = orderSessions(focused, [computer("linux", [session("a", "done", 100), session("b", "done", 20), session("p", "attention", 1)])], "automatic");
		expect(keys(returned.computers)).toEqual([["linux/a", "linux/b"]]);
		const again = orderSessions(returned, snapshot, "automatic");
		expect(again.needsYou.map((s) => s.key)).toEqual(["linux/p", "linux/a"]);
	});

	it("removes gone sessions, reserved positions and computers and uses fresh notices", () => {
		const previous = orderSessions(empty, [computer("linux", [session("a", "working", 30), session("b", "attention", 10)]), computer("win", [])], "focus");
		const incoming: ComputerSessions[] = [{ hostId: "linux", state: "unreachable", message: "No route", sessions: [] }];
		const result = orderSessions(previous, incoming, "automatic");
		expect(result.computers).toEqual(incoming);
		expect(result.needsYou).toEqual([]);
		expect(result.groupOrder).toEqual({ linux: [] });
	});

	it("keeps activity ties stable and sorts a newly discovered computer", () => {
		const previous = orderSessions(empty, [computer("linux", [session("b", "done", 10), session("a", "working", 10)])], "focus");
		const result = orderSessions(previous, [...previous.computers, computer("win", [session("old", "done", 10, "win"), session("new", "working", 20, "win")])], "automatic");
		expect(keys(result.computers)).toEqual([["linux/b", "linux/a"], ["win/new", "win/old"]]);
	});
});
