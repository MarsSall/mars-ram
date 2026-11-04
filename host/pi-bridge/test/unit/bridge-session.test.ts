import { beforeEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@workspace/protocol";
import { BridgeSession } from "../../src/core/bridge-session.ts";
import type { OutgoingContent, PiSessionPort } from "../../src/core/ports.ts";

class FakePiSession implements PiSessionPort {
	idle = true;
	pending = false;
	sent: { content: OutgoingContent; steer: boolean }[] = [];
	aborts = 0;
	sessionId = () => "sess-1";
	isIdle = () => this.idle;
	hasPendingMessages = () => this.pending;
	model = () => ({ id: "m", provider: "p", acceptsImages: true });
	imagesBlocked = () => false;
	history = () => [{ entryId: "e1", role: "user", text: "hi", images: 0, toolCalls: 0 }];
	send(content: OutgoingContent, steer: boolean) {
		this.sent.push({ content, steer });
	}
	abort() {
		this.aborts++;
	}
}

let pi: FakePiSession;
let now: number;
let bridge: BridgeSession;
const envelope = { protocolVersion: PROTOCOL_VERSION, bridgeInstanceId: "inst-1", sessionId: "sess-1" };

beforeEach(() => {
	pi = new FakePiSession();
	now = 1000;
	bridge = new BridgeSession({ pi, instanceId: "inst-1", capacity: 3, clock: () => now });
});

describe("activity", () => {
	it("starts null and emits numbered events only when the phase changes", () => {
		expect(bridge.state().activity).toBeNull();
		bridge.setActivity(null);
		expect(bridge.state().lastSeq).toBe(0);
		bridge.setActivity("exploring");
		bridge.setActivity("exploring");
		expect(bridge.state().activity).toBe("exploring");
		bridge.setActivity("checking");
		bridge.setActivity(null);
		expect(bridge.eventsSince(0).events).toEqual([
			{ seq: 1, at: 1000, type: "activity", activity: "exploring" },
			{ seq: 2, at: 1000, type: "activity", activity: "checking" },
			{ seq: 3, at: 1000, type: "activity", activity: null },
		]);
		expect(bridge.state().activity).toBeNull();
	});

	it.each(["agent_start", "agent_settled"] as const)("clears activity at %s", (type) => {
		bridge.setActivity("implementing");
		bridge.record(type === "agent_start" ? { type } : { type, aborted: true, pendingMessages: false });
		expect(bridge.state().activity).toBeNull();
		expect(bridge.eventsSince(0).events.at(-2)).toMatchObject({ type: "activity", activity: null });
		expect(bridge.eventsSince(0).events.at(-1)?.type).toBe(type);
	});
});

describe("event log", () => {
	it("numbers events from 1 and replays only events after the cursor", () => {
		bridge.record({ type: "agent_start" });
		bridge.record({ type: "turn_start", turnIndex: 0 });
		const replay = bridge.eventsSince(1);
		expect(replay.header).toEqual({ ...envelope, since: 1, oldestSeq: 1, gap: false });
		expect(replay.events).toEqual([{ seq: 2, at: 1000, type: "turn_start", turnIndex: 0 }]);
	});

	it("reports a gap when the cursor is older than the oldest kept event", () => {
		for (let i = 0; i < 5; i++) bridge.record({ type: "agent_start" });
		const replay = bridge.eventsSince(1);
		expect(replay.header.gap).toBe(true);
		expect(replay.header.oldestSeq).toBe(3);
		expect(replay.events.map((e) => e.seq)).toEqual([3, 4, 5]);
	});

	it("does not report a gap when nothing was dropped after the cursor", () => {
		for (let i = 0; i < 5; i++) bridge.record({ type: "agent_start" });
		expect(bridge.eventsSince(2).header.gap).toBe(false);
	});

	it("notifies live listeners and stops after unsubscribing", () => {
		const seen: number[] = [];
		const stop = bridge.subscribe((e) => seen.push(e.seq));
		bridge.record({ type: "agent_start" });
		stop();
		bridge.record({ type: "agent_start" });
		expect(seen).toEqual([1]);
	});
});

describe("sendMessage", () => {
	it("submits directly when the agent is idle", async () => {
		const result = await bridge.sendMessage({ text: "hello" });
		expect(result).toEqual({ ok: true, value: { ...envelope, status: "submitted" } });
		expect(pi.sent).toEqual([{ content: { text: "hello", images: [] }, steer: false }]);
		expect(bridge.eventsSince(0).events).toEqual([{ seq: 1, at: 1000, type: "message_submitted", queued: false, images: 0 }]);
	});

	it("queues as steering when the agent is busy, like Enter in Pi", async () => {
		pi.idle = false;
		const result = await bridge.sendMessage({ text: "also this", images: [{ data: "AAAA", mimeType: "image/png" }] });
		expect(result).toEqual({ ok: true, value: { ...envelope, status: "queued" } });
		expect(pi.sent).toEqual([{ content: { text: "also this", images: [{ data: "AAAA", mimeType: "image/png" }] }, steer: true }]);
		expect(bridge.eventsSince(0).events[0]).toMatchObject({ type: "message_submitted", queued: true, images: 1 });
	});

	it.each([
		["no text and no images", {}],
		["blank text and no images", { text: "   " }],
		["an image without data", { images: [{ data: "", mimeType: "image/png" }] }],
		["a request that is not an object", "hello"],
	])("rejects %s without sending or recording anything", async (_name, request) => {
		const result = await bridge.sendMessage(request);
		expect(result).toMatchObject({ ok: false, error: { ...envelope, error: { code: "bad_request" } } });
		expect(pi.sent).toEqual([]);
		expect(bridge.state().lastSeq).toBe(0);
	});
});

describe("abort", () => {
	it("requests a stop while the agent is working", () => {
		pi.idle = false;
		expect(bridge.abort()).toEqual({ ...envelope, status: "requested" });
		expect(pi.aborts).toBe(1);
		expect(bridge.eventsSince(0).events[0]).toMatchObject({ type: "abort_requested", wasIdle: false });
	});

	it("does nothing when the agent is idle", () => {
		expect(bridge.abort()).toEqual({ ...envelope, status: "idle" });
		expect(pi.aborts).toBe(0);
		expect(bridge.state().lastSeq).toBe(0);
	});
});

describe("pending prompts", () => {
	it("attaches the running tool call that opened a dialog", () => {
		bridge.toolStarted({ toolCallId: "c1", toolName: "ask_user_choice", args: { question: "Pick a color" } });
		bridge.promptStarted({ kind: "custom" });
		const prompt = { kind: "custom", source: { toolName: "ask_user_choice", args: { question: "Pick a color" } } };
		expect(bridge.state().pendingPrompt).toEqual(prompt);
		expect(bridge.eventsSince(0).events.at(-1)).toMatchObject({ type: "prompt_start", prompt });
	});

	it("has no source when no tool call is running", () => {
		bridge.toolStarted({ toolCallId: "c1", toolName: "bash", args: {} });
		bridge.toolEnded({ toolCallId: "c1", toolName: "bash", isError: false });
		bridge.promptStarted({ kind: "confirm", title: "Allow?" });
		expect(bridge.state().pendingPrompt).toEqual({ kind: "confirm", title: "Allow?" });
	});

	it("clears the pending prompt when it ends", () => {
		bridge.promptStarted({ kind: "confirm", title: "Allow?" });
		bridge.promptEnded({ kind: "confirm" });
		expect(bridge.state().pendingPrompt).toBeNull();
		expect(bridge.eventsSince(0).events.at(-1)).toMatchObject({ type: "prompt_end", kind: "confirm" });
	});

	it("replaces oversized tool arguments with a marker", () => {
		bridge.toolStarted({ toolCallId: "c1", toolName: "ask_user_choice", args: { blob: "x".repeat(20_000) } });
		bridge.promptStarted({ kind: "custom" });
		expect(bridge.state().pendingPrompt?.source?.args).toEqual({ omitted: "arguments larger than 16384 bytes" });
	});
});

describe("state and history", () => {
	it("reports the live session state with the envelope", () => {
		pi.idle = false;
		pi.pending = true;
		bridge.record({ type: "agent_start" });
		expect(bridge.state()).toEqual({
			...envelope,
			terminal: false,
			activity: null,
			idle: false,
			pendingMessages: true,
			pendingPrompt: null,
			model: { id: "m", provider: "p", acceptsImages: true },
			lastSeq: 1,
			oldestSeq: 1,
			lastActivityAt: 1000,
		});
	});

	it("reports when the session last changed: the time of the newest event, or null before any", () => {
		expect(bridge.state().lastActivityAt).toBeNull();
		bridge.record({ type: "agent_start" });
		now = 2500;
		bridge.record({ type: "agent_settled", aborted: false, pendingMessages: false });
		now = 9000;
		expect(bridge.state().lastActivityAt).toBe(2500);
	});

	it("returns the durable history with the envelope", () => {
		expect(bridge.history()).toEqual({ ...envelope, messages: pi.history() });
	});
});
