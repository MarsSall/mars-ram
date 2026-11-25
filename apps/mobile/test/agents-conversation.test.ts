import { describe, expect, it } from "vitest";
import { type BridgeEvent, LEGACY_PI_CAPABILITIES, NO_CAPABILITIES, PROTOCOL_VERSION, type StateResponse } from "@workspace/protocol";
import { applyEvent, type Conversation, fromSnapshot, resolveApproval, statusOf, visiblePrompt } from "../src/core/conversation";
import { composerAgent, expectedCapabilities, sessionControls } from "../src/core/session-controls";

// claude-codex-support T3b: agent, capabilities and approvals in the session view (S5, S6, S7).
const state = (extra: Record<string, unknown> = {}): StateResponse => ({
	protocolVersion: PROTOCOL_VERSION,
	bridgeInstanceId: "b",
	sessionId: "s",
	idle: true,
	pendingMessages: false,
	pendingPrompt: null,
	model: null,
	lastSeq: 10,
	oldestSeq: 1,
	lastActivityAt: 1000,
	...extra,
}) as StateResponse;

const approval = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "command", title: "Run tests", detail: "pnpm test", choices: ["accept", "decline"], ...extra });
const claude = { agent: "claude-code", capabilities: { message: true, steer: false, abort: true, attachments: false, terminal: true, approvals: true } };

let seq = 10;
const ev = (event: Record<string, unknown>) => ({ seq: ++seq, at: seq * 100, ...event }) as BridgeEvent;
const apply = (c: Conversation, ...events: BridgeEvent[]) => events.reduce(applyEvent, c);

describe("the session's agent and capabilities", () => {
	it("is Pi with every Pi feature and no approvals when the state says nothing (S5)", () => {
		const c = fromSnapshot(state(), []);
		expect(c.agent).toBe("pi");
		expect(c.capabilities).toEqual(LEGACY_PI_CAPABILITIES);
		expect(c.approvals).toEqual([]);
		expect(statusOf(c)).toBe("done");
	});

	it("reads Claude Code and Codex, and gives an unknown agent nothing it did not declare", () => {
		expect(fromSnapshot(state(claude), [])).toMatchObject({ agent: "claude-code", capabilities: claude.capabilities });
		expect(fromSnapshot(state({ agent: "codex" }), [])).toMatchObject({ agent: "codex", capabilities: NO_CAPABILITIES });
		expect(fromSnapshot(state({ agent: "rex", capabilities: { message: true, future: true } }), [])).toMatchObject({ agent: "unknown", capabilities: { ...NO_CAPABILITIES, message: true } });
	});

	it("bounds the snapshot's approvals and counts them as attention", () => {
		const c = fromSnapshot(state({ ...claude, approvals: [approval("a1"), approval("a1"), { id: "bad" }, approval("a2", { kind: "permission" })] }), []);
		expect(c.approvals.map((a) => a.id)).toEqual(["a1", "a2"]);
		expect(statusOf(c)).toBe("attention");
	});
});

describe("approval events", () => {
	it("adds a request, replaces a repeated id in place, and drops it when resolved", () => {
		let c = fromSnapshot(state(claude), []);
		c = apply(c, ev({ type: "approval_request", ...approval("a1") }), ev({ type: "approval_request", ...approval("a2") }));
		expect(c.approvals.map((a) => a.id)).toEqual(["a1", "a2"]);
		expect(statusOf(c)).toBe("attention");
		c = apply(c, ev({ type: "approval_request", ...approval("a1", { title: "Run all tests" }) }));
		expect(c.approvals.map((a) => [a.id, a.title])).toEqual([["a1", "Run all tests"], ["a2", "Run tests"]]);
		c = apply(c, ev({ type: "approval_resolved", id: "a1", decision: "accept" }), ev({ type: "approval_resolved", id: "zz", decision: "decline" }));
		expect(c.approvals.map((a) => a.id)).toEqual(["a2"]);
		expect(statusOf(resolveApproval(c, "a2"))).toBe("done");
	});

	it("keeps detailTruncated from events and snapshots, and nothing when absent (older bridges)", () => {
		let c = fromSnapshot(state({ ...claude, approvals: [approval("a1", { detailTruncated: true }), approval("a2")] }), []);
		expect(c.approvals.map((a) => a.detailTruncated)).toEqual([true, undefined]);
		c = apply(c, ev({ type: "approval_request", ...approval("a3", { detail: "y".repeat(2500) }) }));
		expect(c.approvals[2]).toMatchObject({ id: "a3", detailTruncated: true });
		expect(c.approvals[2]!.detail).toHaveLength(2000);
	});

	it("ignores already applied events", () => {
		const c = apply(fromSnapshot(state(claude), []), ev({ type: "approval_request", ...approval("a1") }));
		expect(applyEvent(c, { seq: c.lastSeq, at: 0, type: "approval_resolved", id: "a1", decision: "accept" } as BridgeEvent).approvals).toHaveLength(1);
	});
});

describe("session controls", () => {
	it("keeps every control for a legacy Pi bridge, stop only while it runs (S5)", () => {
		expect(sessionControls(LEGACY_PI_CAPABILITIES, false)).toEqual({ composer: true, attachments: true, sendWhileRunning: true, stop: false, terminal: true, answerApprovals: false });
		expect(sessionControls(LEGACY_PI_CAPABILITIES, true).stop).toBe(true);
	});

	it("follows what Claude Code declares", () => {
		expect(sessionControls(claude.capabilities, true)).toEqual({ composer: true, attachments: false, sendWhileRunning: false, stop: true, terminal: true, answerApprovals: true });
	});

	it("hides everything for an agent that declares nothing, and attachments without messages", () => {
		expect(sessionControls(NO_CAPABILITIES, true)).toEqual({ composer: false, attachments: false, sendWhileRunning: false, stop: false, terminal: false, answerApprovals: false });
		expect(sessionControls({ ...NO_CAPABILITIES, attachments: true }, false).attachments).toBe(false);
	});

	it("assumes Pi before the snapshot unless the Home card named another agent", () => {
		expect(expectedCapabilities(undefined)).toEqual(LEGACY_PI_CAPABILITIES);
		expect(expectedCapabilities("pi")).toEqual(LEGACY_PI_CAPABILITIES);
		expect(expectedCapabilities("codex")).toEqual(NO_CAPABILITIES);
		expect(composerAgent("pi")).toBeNull();
		expect(composerAgent(undefined)).toBeNull();
		expect(composerAgent("claude-code")).toBe("claude-code");
	});
});

// claude-codex L21: Claude Code's idle Notification («waiting for your input») is not a question for the user.
describe("Claude Code's idle reminder", () => {
	const idleInput = { pendingPrompt: { kind: "input", title: "Claude is waiting for your input" } };
	it("is done, with no waiting banner, for an idle Claude Code session", () => {
		const c = fromSnapshot(state({ agent: "claude-code", idle: true, ...idleInput }), []);
		expect(statusOf(c)).toBe("done");
		expect(visiblePrompt(c)).toBeNull();
	});
	it("still needs the user while Claude Code works (an MCP question) or for a permission prompt", () => {
		expect(statusOf(fromSnapshot(state({ agent: "claude-code", idle: false, ...idleInput }), []))).toBe("attention");
		const permission = fromSnapshot(state({ agent: "claude-code", idle: true, pendingPrompt: { kind: "confirm", title: "Claude needs your permission" } }), []);
		expect(statusOf(permission)).toBe("attention");
	});
	it("keeps every Pi prompt as it was (S5)", () => {
		const pi = fromSnapshot(state({ idle: true, ...idleInput }), []);
		expect(statusOf(pi)).toBe("attention");
		expect(visiblePrompt(pi)).toEqual(idleInput.pendingPrompt);
	});
});
