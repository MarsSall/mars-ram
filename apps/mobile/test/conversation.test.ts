import { describe, expect, it } from "vitest";
import { type BridgeEvent, PROTOCOL_VERSION, type StateResponse } from "@workspace/protocol";
import { addQueued, applyEvent, type Conversation, fromSnapshot, statusOf } from "../src/core/conversation";

const state = (extra: Partial<StateResponse> = {}): StateResponse => ({
	protocolVersion: PROTOCOL_VERSION,
	bridgeInstanceId: "b",
	sessionId: "s",
	idle: true,
	pendingMessages: false,
	pendingPrompt: null,
	model: { id: "gpt", provider: "openai", acceptsImages: true },
	lastSeq: 10,
	oldestSeq: 1,
	lastActivityAt: 1000,
	...extra,
});

const msg = (entryId: string, role: string, text: string, toolCalls = 0) => ({ entryId, role, text, images: 0, toolCalls });

let seq = 10;
const ev = (event: Record<string, unknown>) => ({ seq: ++seq, at: seq * 100, ...event }) as BridgeEvent;
const apply = (c: Conversation, ...events: BridgeEvent[]) => events.reduce(applyEvent, c);
const empty = () => fromSnapshot(state(), []);

describe("activity", () => {
	it("normalizes optional snapshots and carries known or future phase ids", () => {
		expect(fromSnapshot(state(), []).activity).toBeNull();
		expect(fromSnapshot(state({ activity: null }), []).activity).toBeNull();
		expect(fromSnapshot(state({ activity: "exploring" }), []).activity).toBe("exploring");
	});
	it("updates, clears, and ignores already applied activity events", () => {
		const working = apply(empty(), ev({ type: "activity", activity: "future-phase" }));
		expect(working.activity).toBe("future-phase");
		expect(applyEvent(working, { seq: working.lastSeq, at: 0, type: "activity", activity: null }).activity).toBe("future-phase");
		expect(apply(working, ev({ type: "activity", activity: null })).activity).toBeNull();
		for (const type of ["agent_start", "agent_settled"]) {
			expect(apply(working, ev({ type, aborted: false })).activity).toBeNull();
		}
	});
});

describe("fromSnapshot", () => {
	it("shows the user's and the agent's messages and sums up tool use between them", () => {
		const c = fromSnapshot(state(), [
			msg("1", "user", "fix the cart"),
			msg("2", "assistant", "", 2),
			msg("3", "toolResult", "ok"),
			msg("4", "toolResult", "ok"),
			msg("5", "assistant", "Done, the total is right now."),
		]);
		expect(c.items).toEqual([
			{ kind: "user", key: "1", text: "fix the cart", images: 0 },
			{ kind: "tools", key: "3", count: 2, failed: 0, running: null },
			{ kind: "assistant", key: "5", text: "Done, the total is right now.", streaming: false },
		]);
		expect(c).toMatchObject({ lastSeq: 10, updatedAt: 1000, running: false, model: { id: "gpt" } });
	});

	it("takes the status from the state", () => {
		expect(statusOf(fromSnapshot(state({ idle: false }), []))).toBe("working");
		expect(statusOf(fromSnapshot(state({ idle: false, pendingPrompt: { kind: "confirm" } }), []))).toBe("attention");
		expect(statusOf(fromSnapshot(state(), []))).toBe("done");
	});
});

describe("applyEvent", () => {
	it("matches queued attachments by upload name despite host path separators", () => {
		const queued = addQueued(empty(), "q1", "look", ["photo.png"]);
		expect(queued.outgoing[0]).toMatchObject({ text: "look", files: ["photo.png"] });
		const taken = apply(queued, ev({ type: "message_start", message: msg("", "user", "look\n\nAttached files:\nC:\\Users\\me\\uploads\\photo.png"), pendingMessages: false }));
		expect(taken.outgoing).toEqual([]);
	});
	it("does not match a different attachment with the same caption", () => {
		const queued = addQueued(empty(), "q1", "look", ["other.png"]);
		const taken = apply(queued, ev({ type: "message_start", message: msg("", "user", "look\n\nAttached files:\n/uploads/photo.png"), pendingMessages: false }));
		expect(taken.outgoing).toHaveLength(1);
	});
	it("streams the agent's reply and keeps the full text at the end", () => {
		const c = apply(
			empty(),
			ev({ type: "message_start", message: msg("", "assistant", ""), pendingMessages: false }),
			ev({ type: "text_delta", delta: "Hel" }),
			ev({ type: "text_delta", delta: "lo" }),
		);
		expect(c.items.at(-1)).toMatchObject({ kind: "assistant", text: "Hello", streaming: true });
		const done = apply(c, ev({ type: "message_end", message: msg("", "assistant", "Hello there") }));
		expect(done.items.at(-1)).toMatchObject({ kind: "assistant", text: "Hello there", streaming: false });
		expect(done.items).toHaveLength(1);
	});

	it("starts a reply that was already being written when the phone joined", () => {
		const c = apply(empty(), ev({ type: "text_delta", delta: "…and then" }));
		expect(c.items).toEqual([expect.objectContaining({ kind: "assistant", text: "…and then", streaming: true })]);
	});

	it("drops a reply that only called tools", () => {
		const c = apply(
			empty(),
			ev({ type: "message_start", message: msg("", "assistant", ""), pendingMessages: false }),
			ev({ type: "message_end", message: msg("", "assistant", "", 1) }),
		);
		expect(c.items).toEqual([]);
	});

	it("counts tools in one summary, naming the one running and the ones that failed", () => {
		let c = apply(empty(), ev({ type: "tool_start", toolCallId: "1", toolName: "bash" }));
		expect(c.items).toEqual([expect.objectContaining({ kind: "tools", count: 0, running: "bash" })]);
		c = apply(
			c,
			ev({ type: "tool_end", toolCallId: "1", toolName: "bash", isError: false }),
			ev({ type: "tool_start", toolCallId: "2", toolName: "read" }),
			ev({ type: "tool_end", toolCallId: "2", toolName: "read", isError: true }),
		);
		expect(c.items).toEqual([expect.objectContaining({ kind: "tools", count: 2, failed: 1, running: null })]);
	});

	it("shows the user's message when the agent takes it, also when typed at the computer", () => {
		const c = apply(empty(), ev({ type: "message_start", message: msg("", "user", "run the tests"), pendingMessages: false }));
		expect(c.items).toEqual([expect.objectContaining({ kind: "user", text: "run the tests" })]);
	});

	it("follows working, needs you, and done", () => {
		let c = apply(empty(), ev({ type: "agent_start" }));
		expect(statusOf(c)).toBe("working");
		c = apply(c, ev({ type: "prompt_start", prompt: { kind: "select", title: "Pick one" } }));
		expect(statusOf(c)).toBe("attention");
		expect(c.prompt).toEqual({ kind: "select", title: "Pick one" });
		c = apply(c, ev({ type: "prompt_end", kind: "select" }));
		expect(statusOf(c)).toBe("working");
		c = apply(c, ev({ type: "agent_settled", aborted: false, pendingMessages: false }));
		expect(statusOf(c)).toBe("done");
	});

	it("keeps a queued message as queued until the agent takes it", () => {
		let c = addQueued(apply(empty(), ev({ type: "agent_start" })), "q1", "also check the tax");
		expect(c.outgoing).toEqual([{ key: "q1", text: "also check the tax", state: "queued" }]);
		c = apply(c, ev({ type: "message_start", message: msg("", "user", "also check the tax"), pendingMessages: false }));
		expect(c.outgoing).toEqual([]);
		expect(c.items.at(-1)).toMatchObject({ kind: "user", text: "also check the tax" });
	});

	it("shows a stop as requested until the agent settles, and queued messages as returned to the editor", () => {
		let c = addQueued(apply(empty(), ev({ type: "agent_start" })), "q1", "next step");
		c = apply(c, ev({ type: "abort_requested", wasIdle: false }));
		expect(c.stopping).toBe(true);
		c = apply(c, ev({ type: "agent_settled", aborted: true, pendingMessages: false }));
		expect(c.stopping).toBe(false);
		expect(c.outgoing).toEqual([{ key: "q1", text: "next step", state: "returned" }]);
		expect(statusOf(c)).toBe("done");
	});

	it("ignores events it already applied and records when the session last changed", () => {
		const c = apply(empty(), ev({ type: "agent_start" }));
		const again = applyEvent(c, { seq: c.lastSeq, at: 1, type: "agent_settled", aborted: false, pendingMessages: false });
		expect(again).toBe(c);
		expect(c.updatedAt).toBe(c.lastSeq * 100);
	});
});
