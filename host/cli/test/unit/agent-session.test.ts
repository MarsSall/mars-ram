import { beforeEach, describe, expect, it } from "vitest";
import { boundApprovals, decodeEvent, decodeResponse, HistoryResponse, PROTOCOL_VERSION, sessionCapabilities, StateResponse } from "@workspace/protocol";
import type { TerminalPort, TerminalResult } from "@workspace/protocol/bridge-host";
import { AgentSession, terminalLine, type AgentSessionOptions } from "../../src/core/agent-session.ts";

class FakeTerminal implements TerminalPort {
	readonly paneId = "w1:p2";
	calls: unknown[][] = [];
	failure = false;
	onKeys: (() => void) | undefined;
	onText: (() => void) | undefined;
	/** While set, key presses stay in flight until it resolves. */
	gate: Promise<void> | undefined;
	/** What the pane shows: empty (no dialog) unless a test draws one. Reads are counted apart from `calls`. */
	screenText = "";
	screenFailure = false;
	screenReads = 0;
	onScreen: (() => void) | undefined;
	private result<T>(value: T): TerminalResult<T> { return this.failure ? { ok: false, message: "private" } : { ok: true, value }; }
	async screen(): Promise<TerminalResult<string>> {
		this.screenReads++;
		this.onScreen?.();
		return this.screenFailure ? { ok: false, message: "private" } : { ok: true, value: this.screenText };
	}
	async focus() { this.calls.push(["focus"]); return this.result(undefined); }
	async text(text: string, enter: boolean) { this.calls.push(["text", text, enter]); this.onText?.(); return this.result(undefined); }
	async keys(keys: string[]) { this.calls.push(["keys", keys]); this.onKeys?.(); if (this.gate) await this.gate; return this.result(undefined); }
}

class FakeTimers {
	pending: { ms: number; run: () => void; cancelled: boolean }[] = [];
	set = (ms: number, run: () => void) => { const timer = { ms, run, cancelled: false }; this.pending.push(timer); return () => { timer.cancelled = true; }; };
	fire() { for (const timer of this.pending.splice(0)) if (!timer.cancelled) timer.run(); }
}

let terminal: FakeTerminal;
let timers: FakeTimers;
let ids: number;
const make = (options: Partial<AgentSessionOptions> & { pane?: boolean } = {}) => {
	const { pane = true, ...rest } = options;
	return new AgentSession({
		agent: "claude-code", sessionId: "sess-c", instanceId: "inst-c", capacity: 100, historyLimit: 5, clock: () => 7,
		timers, submitDelayMs: 0, approvalTimeoutMs: 300_000, newId: () => `ap-${++ids}`, provider: "anthropic", ...(pane ? { terminal } : {}), ...rest,
	});
};
const envelope = { protocolVersion: PROTOCOL_VERSION, bridgeInstanceId: "inst-c", sessionId: "sess-c" };
const types = (session: AgentSession) => session.eventsSince(0).events.map((event) => event.type);

beforeEach(() => { terminal = new FakeTerminal(); timers = new FakeTimers(); ids = 0; });

describe("state", () => {
	it("declares claude-code with pane-backed capabilities and valid protocol shapes", () => {
		const session = make();
		const state = session.state();
		expect(decodeResponse(StateResponse, state).ok).toBe(true);
		expect(sessionCapabilities(state)).toEqual({ agent: "claude-code", capabilities: { message: true, steer: true, abort: true, attachments: false, terminal: true, approvals: true } });
		expect(state).toMatchObject({ ...envelope, idle: true, terminal: true, terminalPane: "w1:p2", approvals: [], pendingPrompt: null });
	});

	it("without a pane is read-only but still offers approvals", () => {
		const session = make({ pane: false });
		expect(session.capabilities()).toEqual({ message: false, steer: false, abort: false, attachments: false, terminal: false, approvals: true });
		expect(session.state().terminal).toBe(false);
	});

	it("works from a submitted prompt until Stop, with valid events", () => {
		const session = make();
		session.promptSubmitted();
		session.promptSubmitted();
		expect(session.state().idle).toBe(false);
		session.stopped();
		expect(session.state()).toMatchObject({ idle: true, lastOutcome: { outcome: "completed" } });
		expect(types(session)).toEqual(["agent_start", "agent_end", "agent_settled"]);
		for (const event of session.eventsSince(0).events) expect(decodeEvent(event).kind).toBe("known");
	});

	it("a Notification asks for the user until the next prompt", () => {
		const session = make();
		session.notified("confirm", "Claude needs your permission to use Bash");
		expect(session.state().pendingPrompt).toEqual({ kind: "confirm", title: "Claude needs your permission to use Bash" });
		session.promptSubmitted();
		expect(session.state().pendingPrompt).toBeNull();
		expect(types(session)).toEqual(["prompt_start", "prompt_end", "agent_start"]);
	});
});

describe("conversation from the transcript", () => {
	it("fills the history (bounded) and emits events only for live items", () => {
		const session = make();
		session.conversation([{ type: "user", id: "u0", text: "old", images: 0 }], false);
		expect(session.eventsSince(0).events).toEqual([]);
		session.promptSubmitted();
		session.conversation([
			{ type: "user", id: "u1", text: "hi", images: 1 },
			{ type: "assistant", id: "a1", text: "hello", toolCalls: 1, model: "claude-x" },
			{ type: "tool_use", id: "t1", toolName: "Read" },
			{ type: "tool_result", id: "u2", toolUseId: "t1", text: "x".repeat(600), isError: false },
			{ type: "assistant", id: "a2", text: "", toolCalls: 1 },
		], true);
		const history = session.history();
		expect(decodeResponse(HistoryResponse, history).ok).toBe(true);
		expect(history.messages.map((m) => [m.entryId, m.role])).toEqual([["u0", "user"], ["u1", "user"], ["a1", "assistant"], ["u2:t1", "toolResult"], ["a2", "assistant"]]);
		expect(history.messages[3]!.text).toHaveLength(501);
		expect(session.state().model).toEqual({ id: "claude-x", provider: "anthropic", acceptsImages: false });
		expect(types(session)).toEqual(["agent_start", "message_start", "message_end", "message_start", "message_end", "tool_start", "tool_end"]);
		expect(session.eventsSince(0).events.find((e) => e.type === "tool_end")).toMatchObject({ toolCallId: "t1", toolName: "Read", isError: false });
		session.conversation([{ type: "user", id: "u3", text: "more", images: 0 }], false);
		expect(session.history().messages.map((m) => m.entryId)).toEqual(["u1", "a1", "u2:t1", "a2", "u3"]);
	});

	it("an interrupt line settles the run as aborted", () => {
		const session = make();
		session.promptSubmitted();
		session.conversation([{ type: "interrupt" }], true);
		expect(session.state()).toMatchObject({ idle: true, lastOutcome: { outcome: "aborted" } });
		expect(session.eventsSince(0).events.at(-1)).toMatchObject({ type: "agent_settled", aborted: true });
	});
});

describe("messages and stop go only to the session's pane", () => {
	it("rejects a queued message if a confirmation opened and cleared before dispatch", async () => {
		const session = make();
		const send = session.sendMessage({ text: "hello" });
		session.notified("confirm", "Allow?");
		session.promptSubmitted();
		expect(await send).toMatchObject({ ok: false });
		expect(terminal.calls).toEqual([]);
		expect(types(session)).not.toContain("message_submitted");
	});

	it("refuses an already open confirmation", async () => {
		const session = make();
		session.notified("confirm", "Allow?");
		expect((await session.sendMessage({ text: "hello" })).ok).toBe(false);
		expect(terminal.calls).toEqual([]);
	});

	it("does not submit after a confirmation opens and clears during typing", async () => {
		const session = make();
		terminal.onText = () => { session.notified("confirm", "Allow?"); session.promptSubmitted(); };
		expect((await session.sendMessage({ text: "hello" })).ok).toBe(false);
		expect(terminal.calls).toEqual([["text", "hello", false]]);
	});
	it("does not retry Enter when the prompt hook does not arrive", async () => {
		const session = make();
		await session.sendMessage({ text: "hola" });
		timers.fire();
		await Promise.resolve();
		expect(terminal.calls).toEqual([["text", "hola", false], ["keys", ["enter"]]]);
		terminal.calls = [];
		await session.sendMessage({ text: "otra" });
		session.promptSubmitted();
		timers.fire();
		await Promise.resolve();
		expect(terminal.calls).toEqual([["text", "otra", false], ["keys", ["enter"]]]);
	});

	it("serializes overlapping sends: the second text is typed only after the first Enter", async () => {
		const session = make();
		await Promise.all([session.sendMessage({ text: "one" }), session.sendMessage({ text: "two" })]);
		expect(terminal.calls).toEqual([["text", "one", false], ["keys", ["enter"]], ["text", "two", false], ["keys", ["enter"]]]);
	});

	it("does not retry Enter when the prompt hook arrives during the first Enter", async () => {
		const session = make();
		terminal.onKeys = () => session.promptSubmitted();
		await session.sendMessage({ text: "hola" });
		terminal.onKeys = undefined;
		timers.fire();
		await Promise.resolve();
		expect(terminal.calls).toEqual([["text", "hola", false], ["keys", ["enter"]]]);
	});

	it("does not retry Enter when a prompt became pending or the session closed", async () => {
		const prompted = make();
		await prompted.sendMessage({ text: "a" });
		prompted.notified("confirm", "Allow Bash?");
		const closed = make();
		await closed.sendMessage({ text: "b" });
		closed.close();
		expect(timers.pending).toEqual([]);
		timers.fire();
		await Promise.resolve();
		expect(terminal.calls.filter((call) => call[0] === "keys")).toHaveLength(2);
	});

	it("does not press Enter when a prompt became pending or the session closed during the submit delay", async () => {
		const prompted = make();
		terminal.onText = () => prompted.notified("confirm", "Allow Bash?");
		const result = await prompted.sendMessage({ text: "a" });
		expect(result.ok ? undefined : result.error.error.code).toBe("no_session");
		const closed = make();
		terminal.onText = () => closed.close();
		expect((await closed.sendMessage({ text: "b" })).ok).toBe(false);
		expect((await closed.sendMessage({ text: "c" })).ok).toBe(false);
		expect(terminal.calls).toEqual([["text", "a", false], ["text", "b", false]]);
		expect(timers.pending).toEqual([]);
		expect(types(prompted)).not.toContain("message_submitted");
	});

	it("raw terminal input waits behind a message's Enter and cancels its Enter retry", async () => {
		const session = make();
		let raw: Promise<unknown> | undefined;
		terminal.onText = () => { terminal.onText = undefined; raw = session.terminalInput({ kind: "text", text: "x", enter: false }); };
		await session.sendMessage({ text: "one" });
		expect(await raw).toMatchObject({ ok: true });
		await session.sendMessage({ text: "two" });
		await session.terminalInput({ kind: "keys", keys: ["up"] });
		timers.fire();
		for (let i = 0; i < 10; i++) await Promise.resolve();
		expect(terminal.calls).toEqual([["text", "one", false], ["keys", ["enter"]], ["text", "x", false], ["text", "two", false], ["keys", ["enter"]], ["keys", ["up"]]]);
	});

	it("a send that throws does not block the sends after it", async () => {
		let broken = true;
		const session = make({ clock: () => { if (broken) throw new Error("clock"); return 7; } });
		await expect(session.sendMessage({ text: "one" })).rejects.toThrow("clock");
		broken = false;
		expect(await session.sendMessage({ text: "two" })).toMatchObject({ ok: true, value: { status: "submitted" } });
	});

	it("a second send cancels the first send's Enter retry", async () => {
		const session = make();
		await session.sendMessage({ text: "one" });
		await session.sendMessage({ text: "two" });
		timers.fire();
		await Promise.resolve();
		expect(terminal.calls).toEqual([["text", "one", false], ["keys", ["enter"]], ["text", "two", false], ["keys", ["enter"]]]);
	});

	it("types one line and Enter, submitted when idle and queued while working", async () => {
		const session = make();
		expect(await session.sendMessage({ text: "first\nsecond\tline\u001b[31m" })).toEqual({ ok: true, value: { ...envelope, status: "submitted" } });
		session.promptSubmitted();
		expect(await session.sendMessage({ text: "later" })).toMatchObject({ ok: true, value: { status: "queued" } });
		expect(terminal.calls).toEqual([["text", "first second line[31m", false], ["keys", ["enter"]], ["text", "later", false], ["keys", ["enter"]]]);
		expect(session.eventsSince(0).events.filter((e) => e.type === "message_submitted")).toMatchObject([{ queued: false, images: 0 }, { queued: true }]);
	});

	it.each([
		["attachments", { text: "x", attachments: ["a.png"] }, "bad_request"],
		["images", { text: "x", images: [{ data: "AA", mimeType: "image/png" }] }, "bad_request"],
		["empty text", { text: " \n " }, "bad_request"],
		["no text", {}, "bad_request"],
		["a malformed body", { text: 5 }, "bad_request"],
		["too long text", { text: "x".repeat(20_000) }, "too_large"],
	])("refuses %s without typing anything", async (_name, body, code) => {
		const session = make();
		const result = await session.sendMessage(body);
		expect(result.ok ? undefined : result.error.error.code).toBe(code);
		expect(terminal.calls).toEqual([]);
	});

	it("outside Herdr a message is not_found, and a Herdr failure is internal without details", async () => {
		const session = make({ pane: false });
		const missing = await session.sendMessage({ text: "hi" });
		expect(missing.ok ? undefined : missing.error.error.code).toBe("not_found");
		terminal.failure = true;
		const failed = await make().sendMessage({ text: "hi" });
		expect(failed.ok ? undefined : failed.error.error).toEqual({ code: "internal", message: "Herdr did not complete the terminal operation." });
	});

	it("abort presses Escape once while working and reports idle otherwise", async () => {
		const session = make();
		expect(await session.abort()).toMatchObject({ ok: true, value: { status: "idle" } });
		session.promptSubmitted();
		expect(await session.abort()).toMatchObject({ ok: true, value: { status: "requested" } });
		expect(await session.abort()).toMatchObject({ ok: true, value: { status: "requested" } });
		expect(terminal.calls).toEqual([["keys", ["esc"]]]);
		expect(types(session)).toEqual(["agent_start", "abort_requested"]);
	});

	it("concurrent aborts press Escape once", async () => {
		const session = make();
		session.promptSubmitted();
		const results = await Promise.all([session.abort(), session.abort()]);
		expect(results).toMatchObject([{ ok: true, value: { status: "requested" } }, { ok: true, value: { status: "requested" } }]);
		expect(terminal.calls).toEqual([["keys", ["esc"]]]);
	});

	it("a run that settles during the Escape does not block the next run's abort", async () => {
		const session = make();
		session.promptSubmitted();
		terminal.onKeys = () => session.stopped();
		await session.abort();
		terminal.onKeys = undefined;
		session.promptSubmitted();
		expect(await session.abort()).toMatchObject({ ok: true, value: { status: "requested" } });
		expect(terminal.calls).toEqual([["keys", ["esc"]], ["keys", ["esc"]]]);
	});

	it("Escape is never typed between a message's text and its Enter", async () => {
		const session = make();
		session.promptSubmitted();
		let aborted: Promise<unknown> | undefined;
		terminal.onText = () => { aborted = session.abort(); };
		await session.sendMessage({ text: "steer" });
		expect(await aborted).toMatchObject({ ok: true, value: { status: "requested" } });
		expect(terminal.calls).toEqual([["text", "steer", false], ["keys", ["enter"]], ["keys", ["esc"]]]);
	});

	it("an abort waiting behind a message presses nothing once its run has settled", async () => {
		const session = make();
		session.promptSubmitted();
		let aborted: Promise<unknown> | undefined;
		terminal.onText = () => { aborted = session.abort(); };
		terminal.onKeys = () => session.stopped();
		await session.sendMessage({ text: "steer" });
		expect(await aborted).toMatchObject({ ok: true, value: { status: "idle" } });
		expect(terminal.calls).toEqual([["text", "steer", false], ["keys", ["enter"]]]);
		expect(types(session)).not.toContain("abort_requested");
	});

	it("concurrent aborts that fail let the next abort press Escape again", async () => {
		const session = make();
		session.promptSubmitted();
		terminal.failure = true;
		const results = await Promise.all([session.abort(), session.abort()]);
		expect(results.map((result) => result.ok)).toEqual([false, false]);
		terminal.failure = false;
		expect(await session.abort()).toMatchObject({ ok: true, value: { status: "requested" } });
		expect(terminal.calls).toEqual([["keys", ["esc"]], ["keys", ["esc"]]]);
		expect(types(session).filter((type) => type === "abort_requested")).toHaveLength(1);
	});

	it("a failed Escape lets the next abort press it again", async () => {
		const session = make();
		session.promptSubmitted();
		terminal.failure = true;
		expect((await session.abort()).ok).toBe(false);
		terminal.failure = false;
		expect(await session.abort()).toMatchObject({ ok: true, value: { status: "requested" } });
		expect(terminal.calls).toEqual([["keys", ["esc"]], ["keys", ["esc"]]]);
	});

	it("terminal input refuses attachments and passes text and keys", async () => {
		const session = make();
		expect((await session.terminalInput({ kind: "text", text: "", enter: true, attachments: ["a.txt"] })).ok).toBe(false);
		expect((await session.terminalInput({ kind: "keys", keys: ["esc", "enter"] })).ok).toBe(true);
		expect((await session.terminalInput({ kind: "keys", keys: ["rm -rf"] })).ok).toBe(false);
		expect(terminal.calls).toEqual([["keys", ["esc", "enter"]]]);
	});

	it("terminalLine strips control characters and joins lines", () => {
		expect(terminalLine("\u0007a\r\nb\u009bc  ")).toBe("a bc");
	});
});

const CLAUDE_DIALOG = [
	"⏺ Bash(touch /tmp/prueba.txt)",
	"╭──────────────────────────────────────────╮",
	"│ Bash command                             │",
	"│   touch /tmp/prueba.txt                  │",
	"│ Do you want to proceed?                  │",
	"│ ❯ 1. Yes                                 │",
	"│   2. No, and tell Claude what to do (esc)│",
	"╰──────────────────────────────────────────╯",
].join("\n");
const CODEX_DIALOG = [
	"  Would you like to run the following command?",
	"  $ touch /tmp/prueba.txt",
	"› 1. Yes, proceed (y)",
	"  2. No, and tell Codex what to do differently (esc)",
	"  Press enter to confirm or esc to cancel",
].join("\n");
const IDLE_SCREEN = ["⏺ Done.", "────────────", "❯ ", "────────────", "  ? for shortcuts"].join("\n");
const code = (result: { ok: boolean; error?: { error: { code: string } } }) => (result.ok ? undefined : result.error?.error.code);

describe("the pane's own screen guards every phone message", () => {
	it.each([["Claude Code", CLAUDE_DIALOG], ["Codex", CODEX_DIALOG]])("a %s dialog on screen at the first read: nothing typed, refused", async (_agent, dialog) => {
		const session = make();
		terminal.screenText = dialog;
		const result = await session.sendMessage({ text: "hola" });
		expect(code(result)).toBe("no_session");
		expect(terminal.calls).toEqual([]);
		expect(terminal.screenReads).toBe(1);
		expect(types(session)).not.toContain("message_submitted");
	});

	it("a dialog that appears during the submit delay: text typed, no Enter, refused", async () => {
		const session = make();
		terminal.screenText = IDLE_SCREEN;
		terminal.onText = () => { terminal.screenText = CLAUDE_DIALOG; };
		const result = await session.sendMessage({ text: "hola" });
		expect(code(result)).toBe("no_session");
		expect(terminal.calls).toEqual([["text", "hola", false]]);
		expect(terminal.screenReads).toBe(2);
		expect(types(session)).not.toContain("message_submitted");
	});

	it("reads the screen before typing and again before Enter on a clean screen", async () => {
		const session = make();
		terminal.screenText = IDLE_SCREEN;
		const order: string[] = [];
		terminal.onScreen = () => order.push("screen");
		terminal.onText = () => order.push("text");
		terminal.onKeys = () => order.push("keys");
		expect(await session.sendMessage({ text: "hola" })).toMatchObject({ ok: true, value: { status: "submitted" } });
		expect(order).toEqual(["screen", "text", "screen", "keys"]);
	});

	it("an unreadable screen refuses before typing, and before Enter", async () => {
		const session = make();
		terminal.screenFailure = true;
		expect(code(await session.sendMessage({ text: "hola" }))).toBe("no_session");
		expect(terminal.calls).toEqual([]);
		terminal.screenFailure = false;
		terminal.onText = () => { terminal.screenFailure = true; };
		expect(code(await session.sendMessage({ text: "otra" }))).toBe("no_session");
		expect(terminal.calls).toEqual([["text", "otra", false]]);
	});

	it("a screen read that throws refuses too", async () => {
		const session = make();
		terminal.onScreen = () => { throw new Error("/private/path"); };
		const result = await session.sendMessage({ text: "hola" });
		expect(code(result)).toBe("no_session");
		expect(JSON.stringify(result)).not.toContain("private");
		expect(terminal.calls).toEqual([]);
	});

	it("raw terminal input and Escape do not read the screen and pass through a dialog", async () => {
		const session = make();
		session.promptSubmitted();
		terminal.screenText = CLAUDE_DIALOG;
		expect((await session.terminalInput({ kind: "keys", keys: ["enter"] })).ok).toBe(true);
		expect(await session.abort()).toMatchObject({ ok: true, value: { status: "requested" } });
		expect(terminal.calls).toEqual([["keys", ["enter"]], ["keys", ["esc"]]]);
		expect(terminal.screenReads).toBe(0);
	});

	it("a stale interrupt marks the run idle before its approval times out: the dialog on screen still refuses (L33 1)", async () => {
		const session = make();
		session.promptSubmitted();
		const decision = session.requestApproval({ kind: "command", title: "Bash: touch", detail: "touch /tmp/prueba.txt" });
		session.conversation([{ type: "interrupt" }], true);
		timers.fire();
		expect(await decision).toBeNull();
		// The events say nothing is open; the pane shows the agent's own dialog.
		expect(session.state()).toMatchObject({ idle: true, pendingPrompt: null });
		terminal.screenText = CLAUDE_DIALOG;
		expect(code(await session.sendMessage({ text: "hola" }))).toBe("no_session");
		expect(terminal.calls).toEqual([]);
	});
});

describe("a terminal fallback the screen shows is over (Claude after Escape)", () => {
	let now: number;
	const fallen = async () => {
		const session = make({ clock: () => now });
		session.promptSubmitted();
		const decision = session.requestApproval({ kind: "command", title: "Bash: touch", detail: "touch /tmp/prueba.txt" });
		timers.fire();
		expect(await decision).toBeNull();
		// Escape closed Claude's dialog: the transcript interrupt settles the run, no hook clears the fallback.
		session.conversation([{ type: "interrupt" }], true);
		expect(session.state()).toMatchObject({ idle: true, pendingPrompt: { kind: "confirm" } });
		return session;
	};
	beforeEach(() => { now = 1_000; });

	it("older than the settle window with a clean screen: cleared, the message is sent", async () => {
		const session = await fallen();
		now += 3_000;
		terminal.screenText = IDLE_SCREEN;
		expect(await session.sendMessage({ text: "hola" })).toMatchObject({ ok: true, value: { status: "submitted" } });
		expect(terminal.calls).toEqual([["text", "hola", false], ["keys", ["enter"]]]);
		expect(session.state().pendingPrompt).toBeNull();
	});

	it("a newer fallback in the same turn restarts the settle window", async () => {
		const session = make({ clock: () => now });
		session.promptSubmitted();
		const first = session.requestApproval({ kind: "command", title: "Bash: a", detail: "a" });
		timers.fire();
		expect(await first).toBeNull();
		now += 3_001;
		const second = session.requestApproval({ kind: "command", title: "Bash: b", detail: "b" });
		timers.fire();
		expect(await second).toBeNull();
		// The agent is drawing the second dialog: a clean read right now proves nothing.
		terminal.screenText = IDLE_SCREEN;
		expect(code(await session.sendMessage({ text: "hola" }))).toBe("no_session");
		expect(terminal.calls).toEqual([]);
	});

	it("younger than the settle window: refused without typing, even on a clean screen", async () => {
		const session = await fallen();
		now += 2_999;
		expect(code(await session.sendMessage({ text: "hola" }))).toBe("no_session");
		expect(terminal.calls).toEqual([]);
		expect(session.state().pendingPrompt).toMatchObject({ kind: "confirm" });
	});

	it("older than the window but the dialog is still on screen: refused, fallback kept", async () => {
		const session = await fallen();
		now += 10_000;
		terminal.screenText = CLAUDE_DIALOG;
		expect(code(await session.sendMessage({ text: "hola" }))).toBe("no_session");
		terminal.screenText = "";
		terminal.screenFailure = true;
		expect(code(await session.sendMessage({ text: "hola" }))).toBe("no_session");
		expect(terminal.calls).toEqual([]);
		expect(session.state().pendingPrompt).toMatchObject({ kind: "confirm" });
	});

	it("an approval still pending keeps refusing whatever the screen shows", async () => {
		const session = await fallen();
		void session.requestApproval({ kind: "command", title: "Bash: ls", detail: "ls" });
		now += 10_000;
		expect(code(await session.sendMessage({ text: "hola" }))).toBe("no_session");
		expect(terminal.calls).toEqual([]);
	});

	it("a new confirmation during the screen read is not cleared with the old fallback", async () => {
		const session = await fallen();
		now += 10_000;
		terminal.onScreen = () => { terminal.onScreen = undefined; session.notified("confirm", "Claude needs your permission"); };
		expect(code(await session.sendMessage({ text: "hola" }))).toBe("no_session");
		expect(terminal.calls).toEqual([]);
		expect(session.state().pendingPrompt).toMatchObject({ kind: "confirm" });
	});

	it("a Notification-only confirm is not cleared by a clean screen", async () => {
		const session = make({ clock: () => now });
		session.notified("confirm", "Allow?");
		now += 10_000;
		expect(code(await session.sendMessage({ text: "hola" }))).toBe("no_session");
		expect(terminal.screenReads).toBe(0);
	});

	it("the settle window is configurable", async () => {
		const session = make({ clock: () => now, fallbackSettleMs: 50 });
		session.promptSubmitted();
		const decision = session.requestApproval({ kind: "command", title: "Bash", detail: "ls" });
		timers.fire();
		await decision;
		now += 50;
		expect((await session.sendMessage({ text: "hola" })).ok).toBe(true);
	});
});

describe("approvals", () => {
	const ask = (session: AgentSession, closed?: AbortSignal) => session.requestApproval({ kind: "command", title: "Bash: ls", detail: "ls\n-la", source: { toolName: "Bash", args: {} } }, closed);

	it("shows a bounded request, waits, and resolves once with the app's answer", async () => {
		const session = make();
		const decision = ask(session);
		const state = session.state();
		expect(boundApprovals(state.approvals)).toEqual([{ id: "ap-1", kind: "command", title: "Bash: ls", detail: "ls\n-la", choices: ["accept", "decline"] }]);
		expect(state.pendingPrompt).toMatchObject({ kind: "confirm", title: "Bash: ls" });
		expect(await session.answerApproval({ id: "ap-1", decision: "accept" })).toEqual({ ok: true, value: { ...envelope, status: "answered" } });
		expect(await decision).toBe("accept");
		const again = await session.answerApproval({ id: "ap-1", decision: "decline" });
		expect(again.ok ? undefined : again.error.error.code).toBe("not_found");
		expect(session.state().approvals).toEqual([]);
		expect(session.state().pendingPrompt).toBeNull();
		const events = session.eventsSince(0).events;
		expect(events.filter((e) => e.type === "approval_resolved")).toEqual([expect.objectContaining({ id: "ap-1", decision: "accept" })]);
		for (const event of events) expect(decodeEvent(event).kind).toBe("known");
		timers.fire();
		expect(session.eventsSince(0).events.filter((e) => e.type === "approval_resolved")).toHaveLength(1);
	});

	it("a throwing subscriber neither blocks the resolution nor other subscribers", async () => {
		const session = make();
		session.subscribe((event) => { if (event.type === "approval_resolved" || event.type === "approval_request") throw new Error("boom"); });
		const seen: string[] = [];
		session.subscribe((event) => seen.push(event.type));
		const decision = ask(session);
		expect(await session.answerApproval({ id: "ap-1", decision: "accept" })).toMatchObject({ ok: true });
		expect(await decision).toBe("accept");
		expect(seen).toContain("approval_resolved");
	});

	it("a subscriber that answers at once leaves no prompt, timer or listener behind", async () => {
		const session = make();
		session.subscribe((event) => { if (event.type === "approval_request") void session.answerApproval({ id: event.id, decision: "decline" }); });
		const gone = new AbortController();
		expect(await ask(session, gone.signal)).toBe("decline");
		expect(session.state()).toMatchObject({ approvals: [], pendingPrompt: null });
		expect(timers.pending.every((timer) => timer.cancelled)).toBe(true);
		gone.abort();
		expect(session.eventsSince(0).events.filter((e) => e.type === "approval_resolved")).toHaveLength(1);
	});

	it("every subscriber sees events in replay order when one answers synchronously", async () => {
		const session = make();
		session.subscribe((event) => { if (event.type === "approval_request") void session.answerApproval({ id: event.id, decision: "accept" }); });
		const seen: number[] = [];
		session.subscribe((event) => seen.push(event.seq));
		expect(await ask(session)).toBe("accept");
		expect(seen).toEqual(session.eventsSince(0).events.map((event) => event.seq));
		expect(types(session)).toEqual(["approval_request", "approval_resolved"]);
	});

	it("refuses an answer that was not offered or is malformed, and keeps waiting", async () => {
		const session = make();
		void ask(session);
		for (const body of [{ id: "ap-1", decision: "cancel" }, { id: "ap-1", decision: "acceptForSession" }, { id: "ap-1" }, { id: "ap-1\n", decision: "accept" }, null]) {
			const result = await session.answerApproval(body);
			expect(result.ok ? undefined : result.error.error.code).toBe("bad_request");
		}
		const unknown = await session.answerApproval({ id: "nope", decision: "accept" });
		expect(unknown.ok ? undefined : unknown.error.error.code).toBe("not_found");
		expect(session.state().approvals).toHaveLength(1);
	});

	it("times out to null (the terminal prompt) and reports cancel", async () => {
		const session = make();
		const decision = ask(session);
		expect(timers.pending[0]!.ms).toBe(300_000);
		timers.fire();
		expect(await decision).toBeNull();
		expect(session.eventsSince(0).events.find((e) => e.type === "approval_resolved")).toMatchObject({ id: "ap-1", decision: "cancel" });
		const late = await session.answerApproval({ id: "ap-1", decision: "accept" });
		expect(late.ok).toBe(false);
	});

	it("after a timeout during a run the agent asks in its terminal: messages are refused until a Stop hook", async () => {
		const session = make();
		session.promptSubmitted();
		const decision = ask(session);
		timers.fire();
		expect(await decision).toBeNull();
		expect(session.state().pendingPrompt).toMatchObject({ kind: "confirm" });
		const refused = await session.sendMessage({ text: "hola" });
		expect(refused.ok ? undefined : refused.error.error.code).toBe("no_session");
		expect(terminal.calls).toEqual([]);
		session.stopped();
		expect(session.state().pendingPrompt).toBeNull();
		expect((await session.sendMessage({ text: "hola" })).ok).toBe(true);
	});

	it("a terminal fallback is cleared by the next UserPromptSubmit", async () => {
		const session = make();
		session.promptSubmitted();
		const decision = ask(session);
		timers.fire();
		expect(await decision).toBeNull();
		session.promptSubmitted();
		expect(session.state().pendingPrompt).toBeNull();
		expect((await session.sendMessage({ text: "hola" })).ok).toBe(true);
	});

	it("a timeout while the agent is idle leaves no dialog and does not block messages", async () => {
		const session = make();
		const decision = ask(session);
		timers.fire();
		expect(await decision).toBeNull();
		expect(session.state().pendingPrompt).toBeNull();
		expect((await session.sendMessage({ text: "hola" })).ok).toBe(true);
	});

	it("answering another approval does not clear a terminal fallback that is still open", async () => {
		const session = make();
		session.promptSubmitted();
		const gone = new AbortController();
		const first = ask(session, gone.signal);
		const second = ask(session);
		gone.abort();
		expect(await first).toBeNull();
		expect(await session.answerApproval({ id: "ap-2", decision: "accept" })).toMatchObject({ ok: true });
		expect(await second).toBe("accept");
		expect(session.state().pendingPrompt).toMatchObject({ kind: "confirm" });
		const refused = await session.sendMessage({ text: "hola" });
		expect(refused.ok).toBe(false);
		expect(terminal.calls).toEqual([]);
	});

	it("transcript items read after a fallback do not count as the agent moving on", async () => {
		const session = make();
		session.promptSubmitted();
		const decision = ask(session);
		timers.fire();
		expect(await decision).toBeNull();
		// Claude writes the tool_use (and its assistant line) before asking; a late poll reads them after the fallback.
		session.conversation([
			{ type: "assistant", id: "a1", text: "Running it", toolCalls: 1 },
			{ type: "tool_use", id: "t1", toolName: "Bash" },
			{ type: "tool_result", id: "u1", toolUseId: "t0", text: "ok", isError: false },
		], true);
		expect(session.state().pendingPrompt).toMatchObject({ kind: "confirm" });
		expect((await session.sendMessage({ text: "hola" })).ok).toBe(false);
		expect(terminal.calls).toEqual([]);
	});

	it("an idle Notification does not hide a terminal fallback", async () => {
		const session = make();
		session.promptSubmitted();
		const decision = ask(session);
		timers.fire();
		expect(await decision).toBeNull();
		session.notified("input", "Claude is waiting for your input");
		expect(session.state().pendingPrompt).toMatchObject({ kind: "confirm" });
		expect((await session.sendMessage({ text: "hola" })).ok).toBe(false);
	});

	it("a Notification-only confirm still clears when the transcript shows progress", () => {
		const session = make();
		session.promptSubmitted();
		session.notified("confirm", "Allow?");
		session.conversation([{ type: "tool_result", id: "u1", toolUseId: "t1", text: "ok", isError: false }], true);
		expect(session.state().pendingPrompt).toBeNull();
	});

	it("an Interrupt before the hook disconnects ends idle and accepting messages", async () => {
		const session = make();
		session.promptSubmitted();
		const gone = new AbortController();
		const decision = ask(session, gone.signal);
		session.conversation([{ type: "interrupt" }], true);
		gone.abort();
		expect(await decision).toBeNull();
		expect(session.state()).toMatchObject({ idle: true, pendingPrompt: null });
		expect((await session.sendMessage({ text: "hola" })).ok).toBe(true);
	});

	it("a terminal dialog left after a hook went away clears when the Interrupt hook reports the run stopped", async () => {
		const session = make();
		session.promptSubmitted();
		const gone = new AbortController();
		const decision = ask(session, gone.signal);
		gone.abort();
		expect(await decision).toBeNull();
		expect(session.state().pendingPrompt).toMatchObject({ kind: "confirm" });
		session.interrupted();
		expect(session.state()).toMatchObject({ pendingPrompt: null, idle: true, lastOutcome: { outcome: "aborted" } });
		expect((await session.sendMessage({ text: "hola" })).ok).toBe(true);
	});

	it("an Interrupt hook before the approval hook disconnects ends idle and accepting messages", async () => {
		const session = make();
		session.promptSubmitted();
		const gone = new AbortController();
		const decision = ask(session, gone.signal);
		session.interrupted();
		gone.abort();
		expect(await decision).toBeNull();
		expect(session.state()).toMatchObject({ idle: true, pendingPrompt: null });
		expect((await session.sendMessage({ text: "hola" })).ok).toBe(true);
	});

	it("a transcript interrupt read late (a previous turn's) settles the run but leaves the terminal fallback", async () => {
		const session = make();
		session.promptSubmitted();
		const decision = ask(session);
		timers.fire();
		expect(await decision).toBeNull();
		session.conversation([{ type: "interrupt" }], true);
		expect(session.state()).toMatchObject({ idle: true, pendingPrompt: { kind: "confirm" } });
		const refused = await session.sendMessage({ text: "hola" });
		expect(refused.ok ? undefined : refused.error.error.code).toBe("no_session");
		expect(terminal.calls).toEqual([]);
		session.promptSubmitted();
		expect((await session.sendMessage({ text: "hola" })).ok).toBe(true);
	});

	it("a timeout of the run's own approval still blocks messages until hook evidence", async () => {
		const session = make();
		session.promptSubmitted();
		session.conversation([{ type: "assistant", id: "a1", text: "Let me run it", toolCalls: 1 }], true);
		const decision = ask(session);
		timers.fire();
		expect(await decision).toBeNull();
		expect(session.state()).toMatchObject({ idle: false, pendingPrompt: { kind: "confirm" } });
		expect((await session.sendMessage({ text: "hola" })).ok).toBe(false);
		expect(terminal.calls).toEqual([]);
	});

	it("a turn-1 approval that disconnects after turn 2 started leaves turn 2 writable", async () => {
		const session = make();
		session.promptSubmitted();
		const gone = new AbortController();
		const decision = ask(session, gone.signal);
		session.conversation([{ type: "interrupt" }], true);
		session.promptSubmitted();
		gone.abort();
		expect(await decision).toBeNull();
		expect(session.state()).toMatchObject({ idle: false, pendingPrompt: null });
		expect((await session.sendMessage({ text: "hola" })).ok).toBe(true);
	});

	it("a turn-1 approval that times out after a new UserPromptSubmit in the same run does not block", async () => {
		const session = make();
		session.promptSubmitted();
		const decision = ask(session);
		// The interrupt line of turn 1 has not been read yet: the run never settled, but the agent took a new prompt.
		session.promptSubmitted();
		timers.fire();
		expect(await decision).toBeNull();
		expect(session.state()).toMatchObject({ idle: false, pendingPrompt: null });
		expect((await session.sendMessage({ text: "hola" })).ok).toBe(true);
	});

	it("a hook that goes away cancels its approval; a session that ends cancels them all and takes no more", async () => {
		const session = make();
		const gone = new AbortController();
		const first = ask(session, gone.signal);
		const second = ask(session);
		gone.abort();
		expect(await first).toBeNull();
		expect(boundApprovals(session.state().approvals).map((a) => a.id)).toEqual(["ap-2"]);
		session.close();
		expect(await second).toBeNull();
		expect(await ask(session)).toBeNull();
		expect(session.state().approvals).toEqual([]);
	});

	it("falls back to the terminal beyond the most pending approvals", async () => {
		const session = make();
		for (let i = 0; i < 8; i++) void ask(session);
		expect(await ask(session)).toBeNull();
		expect(session.state().approvals).toHaveLength(8);
	});

	it("a ninth approval while running asks in the terminal: messages stay refused after the others are answered", async () => {
		const session = make();
		session.promptSubmitted();
		const pending = Array.from({ length: 8 }, () => ask(session));
		expect(await ask(session)).toBeNull();
		for (let i = 1; i <= 8; i++) expect(await session.answerApproval({ id: `ap-${i}`, decision: "accept" })).toMatchObject({ ok: true });
		expect(await Promise.all(pending)).toEqual(Array(8).fill("accept"));
		expect(session.state()).toMatchObject({ approvals: [], pendingPrompt: { kind: "confirm" } });
		const refused = await session.sendMessage({ text: "hola" });
		expect(refused.ok ? undefined : refused.error.error.code).toBe("no_session");
		expect(terminal.calls).toEqual([]);
		session.stopped();
		expect((await session.sendMessage({ text: "hola" })).ok).toBe(true);
	});

	it("a duplicate approval id while running asks in the terminal too", async () => {
		const session = make({ newId: () => "same" });
		session.promptSubmitted();
		const first = ask(session);
		expect(await ask(session)).toBeNull();
		expect(await session.answerApproval({ id: "same", decision: "accept" })).toMatchObject({ ok: true });
		expect(await first).toBe("accept");
		expect(session.state().pendingPrompt).toMatchObject({ kind: "confirm" });
		expect((await session.sendMessage({ text: "hola" })).ok).toBe(false);
		expect(terminal.calls).toEqual([]);
	});

	it("a refused approval while idle or after close sets no fallback", async () => {
		const idle = make();
		const pending = Array.from({ length: 8 }, () => ask(idle));
		expect(await ask(idle)).toBeNull();
		for (let i = 1; i <= 8; i++) await idle.answerApproval({ id: `ap-${i}`, decision: "decline" });
		await Promise.all(pending);
		expect(idle.state().pendingPrompt).toBeNull();
		expect((await idle.sendMessage({ text: "hola" })).ok).toBe(true);
		const ended = make();
		ended.promptSubmitted();
		ended.close();
		expect(await ask(ended)).toBeNull();
		expect(ended.state().pendingPrompt).toBeNull();
	});
});
