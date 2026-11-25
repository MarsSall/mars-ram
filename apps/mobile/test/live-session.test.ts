import { beforeEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type StateResponse } from "@workspace/protocol";
import type { BridgeEndpoint, BridgeHttp, HttpResult } from "../src/core/bridge-client";
import { AGENT_ASKING_MESSAGE, type EndpointResult, type EventStream, LiveSession, type LiveView, type StreamHandlers } from "../src/core/live-session";

const envelope = { protocolVersion: PROTOCOL_VERSION, bridgeInstanceId: "b", sessionId: "s" };
const state = (extra: Partial<StateResponse> = {}): StateResponse => ({
	...envelope,
	idle: true,
	pendingMessages: false,
	pendingPrompt: null,
	model: { id: "m", provider: "p", acceptsImages: true },
	lastSeq: 10,
	oldestSeq: 1,
	lastActivityAt: 1000,
	...extra,
});
const msg = (entryId: string, role: string, text: string) => ({ entryId, role, text, images: 0, toolCalls: 0 });

class FakeHttp implements BridgeHttp {
	states: StateResponse[] = [];
	history = [msg("1", "user", "hello")];
	sendStatus: "submitted" | "queued" | "fail" = "submitted";
	/** A bridge refusal of /message: the host's error code and message. */
	sendRefusal: { code: string; message: string } | null = null;
	abortStatus: "requested" | "idle" = "requested";
	calls: string[] = [];
	pending: ((r: HttpResult) => void) | null = null;
	holdSend = false;
	approvalAnswer: HttpResult = { ok: true, status: 200, data: { ...envelope, status: "answered" } };

	async request(method: "GET" | "POST", url: string, _token: string, body?: unknown): Promise<HttpResult> {
		const path = new URL(url).pathname;
		this.calls.push(`${method} ${path}${body === undefined ? "" : ` ${JSON.stringify(body)}`}`);
		if (path === "/state") return { ok: true, status: 200, data: this.states.length > 1 ? this.states.shift() : this.states[0] };
		if (path === "/history") return { ok: true, status: 200, data: { ...envelope, messages: this.history } };
		if (path === "/abort") return { ok: true, status: 202, data: { ...envelope, status: this.abortStatus } };
		if (path === "/approval") return this.approvalAnswer;
		if (path === "/message") {
			const answer: HttpResult = this.sendRefusal ? { ok: true, status: 503, data: { ...envelope, error: this.sendRefusal } } :
				this.sendStatus === "fail" ? { ok: false, message: "Connection reset" } : { ok: true, status: 202, data: { ...envelope, status: this.sendStatus } };
			if (this.holdSend) return new Promise((resolve) => (this.pending = () => resolve(answer)));
			return answer;
		}
		return { ok: true, status: 404, data: null };
	}
}

class FakeStream implements EventStream {
	opened: string[] = [];
	handlers: StreamHandlers | null = null;
	closedByClient = 0;
	open(url: string, _token: string, handlers: StreamHandlers) {
		this.opened.push(url);
		this.handlers = handlers;
		return () => this.closedByClient++;
	}
	replay(gap = false, since = 10) {
		this.handlers!.onReplay({ ...envelope, since, oldestSeq: 1, gap });
	}
	event(e: Record<string, unknown>) {
		this.handlers!.onEvent({ at: (e.seq as number) * 100, ...e });
	}
}

class FakeTimers {
	queue: { fn: () => void; ms: number; id: number }[] = [];
	private next = 0;
	set = (fn: () => void, ms: number) => {
		const id = ++this.next;
		this.queue.push({ fn, ms, id });
		return id;
	};
	clear = (id: unknown) => {
		this.queue = this.queue.filter((t) => t.id !== id);
	};
	async fire(ms?: number) {
		const timer = this.queue.find((t) => ms === undefined || t.ms === ms);
		if (!timer) throw new Error(`no timer${ms === undefined ? "" : ` of ${ms} ms`}`);
		this.clear(timer.id);
		timer.fn();
		await flush();
	}
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const endpoint: BridgeEndpoint = { baseUrl: "http://127.0.0.1:50001", token: "t" };

let http: FakeHttp;
let stream: FakeStream;
let timers: FakeTimers;
let endpoints: EndpointResult[];
let asked: boolean[];
let session: LiveSession;
let view: LiveView;

beforeEach(() => {
	http = new FakeHttp();
	http.states = [state()];
	stream = new FakeStream();
	timers = new FakeTimers();
	endpoints = [];
	asked = [];
	session = new LiveSession({
		http,
		events: stream,
		timers,
		endpoint: async (fresh) => {
			asked.push(fresh);
			return endpoints.shift() ?? endpoint;
		},
	});
	session.subscribe((v) => (view = v));
});

async function startLive() {
	session.start();
	await flush();
	stream.replay();
	await flush();
}

describe("LiveSession", () => {
	it("carries outcome snapshots and only newer settle events, with legacy absence remaining unknown", async () => {
		http.states = [state({ lastOutcome: { outcome: "failed", seq: 9 } })];
		await startLive();
		expect(view.lastOutcome).toEqual({ outcome: "failed", seq: 9 });
		stream.event({ seq: 11, type: "agent_settled", aborted: false, pendingMessages: false, outcome: "completed" });
		expect(view.lastOutcome).toEqual({ outcome: "completed", seq: 11 });
		stream.event({ seq: 10, type: "agent_settled", aborted: false, pendingMessages: false, outcome: "failed" });
		expect(view.lastOutcome).toEqual({ outcome: "completed", seq: 11 });
		stream.event({ seq: 12, type: "agent_settled", aborted: false, pendingMessages: false });
		expect(view.lastOutcome).toBeUndefined();
	});
	it("accepts a 1.5 snapshot and settle without an outcome", async () => {
		http.states = [state({ protocolVersion: "1.5" })];
		await startLive();
		expect(view.lastOutcome).toBeUndefined();
		stream.event({ seq: 11, type: "agent_settled", aborted: true, pendingMessages: false });
		expect(view.lastOutcome).toBeUndefined();
	});
	it("replaces outcome evidence from a gap snapshot, including unknown", async () => {
		await startLive();
		stream.event({ seq: 11, type: "agent_settled", aborted: false, pendingMessages: false, outcome: "failed" });
		http.states = [state({ lastSeq: 20, lastOutcome: { outcome: "completed", seq: 19 } })];
		stream.replay(true);
		await flush();
		expect(view.lastOutcome).toEqual({ outcome: "completed", seq: 19 });
		http.states = [state({ lastSeq: 30 })];
		stream.replay(true);
		await flush();
		expect(view.lastOutcome).toBeUndefined();
	});
	it("loads the conversation, then follows it live from where the snapshot ends", async () => {
		await startLive();
		expect(stream.opened).toEqual(["http://127.0.0.1:50001/events?since=10"]);
		expect(view.phase).toBe("live");
		expect(view.conversation!.items).toEqual([expect.objectContaining({ kind: "user", text: "hello" })]);
		stream.event({ seq: 11, type: "agent_start" });
		expect(view.conversation!.running).toBe(true);
	});

	it("reads the snapshot again when the session changed while it was being read", async () => {
		http.states = [state({ lastSeq: 10 }), state({ lastSeq: 12 }), state({ lastSeq: 12 }), state({ lastSeq: 12 })];
		await startLive();
		expect(http.calls.filter((c) => c === "GET /history")).toHaveLength(2);
		expect(stream.opened).toEqual(["http://127.0.0.1:50001/events?since=12"]);
	});

	it("reconnects after the stream drops, from the last event it saw, through a fresh tunnel when needed", async () => {
		await startLive();
		stream.event({ seq: 11, type: "agent_start" });
		stream.handlers!.onClose("Connection lost");
		expect(view.phase).toBe("reconnecting");
		expect(view.conversation!.running).toBe(true);

		endpoints.push("unreachable");
		await timers.fire(1000);
		expect(view.phase).toBe("reconnecting");
		await timers.fire(2000);
		expect(asked).toEqual([false, false, true]);
		expect(stream.opened.at(-1)).toBe("http://127.0.0.1:50001/events?since=11");
		stream.replay(false, 11);
		expect(view.phase).toBe("live");
	});

	it("warns that live updates were missed and reloads, keeping events that arrive meanwhile", async () => {
		await startLive();
		http.states = [state({ lastSeq: 30 })];
		http.history = [msg("1", "user", "hello"), msg("2", "assistant", "missed reply")];
		stream.replay(true);
		stream.event({ seq: 31, type: "agent_start" });
		await flush();
		expect(view.missedEvents).toBe(true);
		expect(view.conversation!.items.at(-1)).toMatchObject({ text: "missed reply" });
		expect(view.conversation!.running).toBe(true);
	});

	it("reloads when Pi starts another session in the same window", async () => {
		await startLive();
		http.states = [state({ lastSeq: 20 })];
		http.history = [];
		stream.event({ seq: 20, type: "session_start", reason: "new" });
		await flush();
		expect(view.conversation!.items).toEqual([]);
	});

	it("keeps saying connecting while the first load fails", async () => {
		endpoints.push("unreachable");
		session.start();
		await flush();
		expect(view.phase).toBe("connecting");
		await timers.fire(1000);
		stream.replay();
		expect(view.phase).toBe("live");
	});

	it("ends when the session is no longer open on the computer", async () => {
		endpoints.push("gone");
		session.start();
		await flush();
		expect(view.phase).toBe("ended");
		expect(stream.opened).toEqual([]);
	});

	it("shows a message sent while the agent is busy as queued, and never before the computer confirms it", async () => {
		await startLive();
		http.sendStatus = "queued";
		http.holdSend = true;
		const sending = session.send("  also check the tax ");
		await flush();
		expect(view.conversation!.outgoing).toEqual([]);
		http.pending!({ ok: true, status: 202, data: null });
		expect(await sending).toEqual({ ok: true });
		expect(view.conversation!.outgoing).toEqual([expect.objectContaining({ text: "also check the tax", state: "queued" })]);
		expect(http.calls).toContain('POST /message {"text":"also check the tax"}');
	});

	it("tells the user when a message could not be delivered", async () => {
		await startLive();
		http.sendStatus = "fail";
		expect(await session.send("hi")).toEqual({ ok: false, message: "Connection reset" });
		expect(view.conversation!.outgoing).toEqual([]);
		expect(await session.send("   ")).toMatchObject({ ok: false });
	});

	it("says the agent is asking in its terminal when the bridge refuses the message for that (build 15 L5)", async () => {
		await startLive();
		const interrupted = "Interrupted: the session ended or now asks for the user, so the message was not sent.";
		http.sendRefusal = { code: "no_session", message: interrupted };
		expect(await session.send("hola")).toEqual({ ok: false, message: AGENT_ASKING_MESSAGE });
		expect(view.conversation!.outgoing).toEqual([]);
		// A truly ended session keeps the host's own words (and so today's wording).
		http.sendRefusal = { code: "no_session", message: "Session ended." };
		expect(await session.send("hola")).toEqual({ ok: false, message: "Session ended." });
		// The same code with another reason, or another code with that text, is not this case.
		http.sendRefusal = { code: "internal", message: interrupted };
		expect(await session.send("hola")).toEqual({ ok: false, message: interrupted });
		http.sendRefusal = null;
		http.sendStatus = "fail";
		expect(await session.send("hola")).toEqual({ ok: false, message: "Connection reset" });
	});

	it("keeps the ended-session wording when the session has ended, even for the interrupted refusal", async () => {
		await startLive();
		stream.handlers!.onClose("lost");
		endpoints.push("gone");
		await timers.fire(1000);
		expect(view.phase).toBe("ended");
		const interrupted = "Interrupted: the session ended or now asks for the user, so the message was not sent.";
		http.sendRefusal = { code: "no_session", message: interrupted };
		expect(await session.send("hola")).toEqual({ ok: false, message: interrupted });
	});

	it("shows a stop as requested until Pi confirms it, and says so when Pi does not react", async () => {
		await startLive();
		stream.event({ seq: 11, type: "agent_start" });
		expect(await session.requestStop()).toEqual({ ok: true });
		expect(view.conversation!.stopping).toBe(true);
		await timers.fire(10_000);
		expect(view.stopSlow).toBe(true);
		stream.event({ seq: 12, type: "agent_settled", aborted: true, pendingMessages: false });
		expect(view.conversation!.stopping).toBe(false);
		expect(view.stopSlow).toBe(false);
	});

	it("stops following when the screen closes", async () => {
		await startLive();
		stream.handlers!.onClose("lost");
		session.dispose();
		expect(timers.queue).toEqual([]);
		expect(stream.closedByClient).toBe(1);
	});
});

describe("approvals (claude-codex T3b)", () => {
	const claude = { agent: "claude-code", capabilities: { message: true, steer: false, abort: true, attachments: false, terminal: true, approvals: true } };
	const ask = { id: "a1", kind: "command", title: "Run tests", detail: "pnpm test", choices: ["accept", "decline"] };

	it("posts the answer to /approval and drops the card on success, before approval_resolved", async () => {
		http.states = [state({ ...claude, approvals: [ask] } as Partial<StateResponse>)];
		await startLive();
		expect(view.conversation!.approvals.map((a) => a.id)).toEqual(["a1"]);
		expect(await session.answerApproval("a1", "accept")).toEqual({ ok: true });
		expect(http.calls).toContain('POST /approval {"id":"a1","decision":"accept"}');
		expect(view.conversation!.approvals).toEqual([]);
		// The confirmation that follows changes nothing.
		stream.event({ seq: 11, type: "approval_resolved", id: "a1", decision: "accept" });
		expect(view.conversation!.approvals).toEqual([]);
	});

	it("keeps the card and reports a failure; drops it when the bridge says it is no longer pending", async () => {
		http.states = [state({ ...claude, approvals: [ask] } as Partial<StateResponse>)];
		await startLive();
		http.approvalAnswer = { ok: false, message: "Connection reset" };
		expect(await session.answerApproval("a1", "decline")).toEqual({ ok: false, message: "Connection reset" });
		expect(view.conversation!.approvals).toHaveLength(1);
		http.approvalAnswer = { ok: true, status: 404, data: { ...envelope, error: { code: "not_found", message: "No such approval." } } };
		expect((await session.answerApproval("a1", "decline")).ok).toBe(false);
		expect(view.conversation!.approvals).toEqual([]);
	});

	it("never posts a choice that was not offered, or to a bridge without approvals", async () => {
		http.states = [state({ ...claude, approvals: [ask] } as Partial<StateResponse>)];
		await startLive();
		expect((await session.answerApproval("a1", "acceptForSession")).ok).toBe(false);
		expect((await session.answerApproval("zz", "accept")).ok).toBe(false);
		expect(http.calls.some((c) => c.startsWith("POST /approval"))).toBe(false);
	});

	it("follows approval events live and leaves a legacy Pi session without approvals (S5)", async () => {
		await startLive();
		expect(view.conversation).toMatchObject({ agent: "pi", approvals: [] });
		expect((await session.answerApproval("a1", "accept")).ok).toBe(false);
		expect(http.calls.some((c) => c.startsWith("POST /approval"))).toBe(false);
		stream.event({ seq: 11, type: "approval_request", ...ask });
		expect(view.conversation!.approvals.map((a) => a.id)).toEqual(["a1"]);
		stream.event({ seq: 12, type: "approval_resolved", id: "a1", decision: "decline" });
		expect(view.conversation!.approvals).toEqual([]);
	});
});
