// Core of a hook-driven agent bridge (Claude Code now, Codex later): the agent tells us what happens through its
// hooks and its transcript, and we act on it only by typing into its own terminal pane. Numbered event log with
// replay, session state, bounded history, and the approval contract (protocol 1.9). No Node, HTTP or file access.
import {
	type AbortResponse,
	type AgentKind,
	type ApprovalAnswerResponse,
	type ApprovalDecision,
	type ApprovalKind,
	type ApprovalRequest,
	APPROVALS_MAX_ITEMS,
	type BridgeEvent,
	type BridgeEventInput,
	boundApproval,
	type Capabilities,
	decodeApprovalAnswer,
	decodeResponse,
	type ErrorCode,
	type ErrorResponse,
	type HistoryResponse,
	type PendingPrompt,
	PROTOCOL_VERSION,
	type ReplayHeader,
	SendMessageRequest,
	type SendMessageResponse,
	type StateResponse,
	TERMINAL_TEXT_MAX_LENGTH,
	TerminalInputRequest,
	type TerminalFocusResponse,
	type TerminalInputResponse,
	type TerminalScreenResponse,
} from "@workspace/protocol";
import type { Result, TerminalPort, TerminalResult } from "@workspace/protocol/bridge-host";
import { terminalDialogOpen } from "./terminal-dialog.ts";

export type HistoryItem = HistoryResponse["messages"][number];

/** One conversation item read from the agent's transcript, already reduced to what the app shows. */
export type ConversationItem =
	| { type: "user"; id: string; text: string; images: number }
	| { type: "assistant"; id: string; text: string; toolCalls: number; model?: string }
	| { type: "tool_use"; id: string; toolName: string }
	| { type: "tool_result"; id: string; toolUseId: string; text: string; isError: boolean }
	/** The user stopped the run (Escape in the terminal, or abort from the app). */
	| { type: "interrupt" };

export type Timers = { set(ms: number, run: () => void): () => void };

export type AgentSessionOptions = {
	agent: AgentKind;
	sessionId: string;
	instanceId: string;
	/** How many events are kept for replay. */
	capacity: number;
	/** How many conversation items /history keeps. */
	historyLimit: number;
	clock: () => number;
	timers: Timers;
	/** How long an approval waits for the app before the agent falls back to its own terminal prompt. */
	approvalTimeoutMs: number;
	/** A new unique approval id. */
	newId: () => string;
	terminal?: TerminalPort;
	/** The pause between typing a message and pressing Enter (default 500 ms). */
	submitDelayMs?: number;
	/** How old a terminal fallback must be before a clean screen may clear it (default 3 s). */
	fallbackSettleMs?: number;
	/** The provider the agent's models come from, for the state's `model`. */
	provider: string;
};

/** Tool output can be huge, so only its start is kept; user and assistant text is cut far later. */
const MAX_TOOL_TEXT = 500;
const MAX_MESSAGE_TEXT = 64 * 1024;
const APPROVAL_CHOICES: ApprovalDecision[] = ["accept", "decline"];

type Pending = { request: ApprovalRequest; finish(decision: ApprovalDecision | null, resolvedAs: ApprovalDecision): void };

export class AgentSession {
	readonly instanceId: string;
	private readonly options: AgentSessionOptions;
	private readonly terminal: TerminalPort | undefined;
	private readonly log: BridgeEvent[] = [];
	private readonly listeners = new Set<(event: BridgeEvent) => void>();
	private readonly items: HistoryItem[] = [];
	private readonly toolNames = new Map<string, string>();
	private readonly approvals = new Map<string, Pending>();
	/** Events recorded while another is being delivered wait here, so every subscriber sees them in seq order. */
	private readonly outbox: BridgeEvent[] = [];
	private delivering = false;
	private seq = 0;
	private lastActivityAt: number | null = null;
	private running = false;
	private promptsSeen = 0;
	private permissionGeneration = 0;
	private runId = 0;
	/** The Escape for one run, shared by concurrent aborts; cleared when it fails so a retry presses it again. */
	private stop: { run: number; result: Promise<Result<AbortResponse>> } | null = null;
	/**
	 * Messages, their Enter retry and Escape run one after another, so nothing is typed between a message's text
	 * and its Enter. A task that fails or throws does not hold back the ones after it.
	 */
	private sends: Promise<unknown> = Promise.resolve();
	private submission = 0;
	private cancelRetry = () => {};
	private cancelDelay = () => {};
	private prompt: PendingPrompt | null = null;
	/**
	 * An approval resolved with no app answer during a run, so the agent now asks in its own terminal. Phone messages
	 * stay out of that dialog until a hook shows the agent moved on (Stop, UserPromptSubmit, Interrupt, session end):
	 * transcript lines (an interrupt line included) and other approvals are no such evidence.
	 */
	private terminalFallback = false;
	/** When the terminal fallback was set, by the injected clock. */
	private fallbackAt = 0;
	private model: StateResponse["model"] = null;
	private lastOutcome: StateResponse["lastOutcome"];
	private closed = false;

	constructor(options: AgentSessionOptions) {
		this.options = options;
		this.instanceId = options.instanceId;
		this.terminal = options.terminal;
	}

	/** Messages, steering and stop all go through the session's own pane; without one the session is read-only. */
	capabilities(): Capabilities {
		const pane = this.terminal !== undefined;
		return { message: pane, steer: pane, abort: pane, attachments: false, terminal: pane, approvals: true };
	}

	envelope() {
		return { protocolVersion: PROTOCOL_VERSION, bridgeInstanceId: this.instanceId, sessionId: this.options.sessionId };
	}

	error(code: ErrorCode, message: string): ErrorResponse {
		return { ...this.envelope(), error: { code, message } };
	}

	record(input: BridgeEventInput): BridgeEvent {
		const event = { ...input, seq: ++this.seq, at: this.options.clock() } as BridgeEvent;
		this.lastActivityAt = event.at;
		if (event.type === "agent_settled") this.lastOutcome = event.outcome === undefined ? undefined : { outcome: event.outcome, seq: event.seq };
		this.log.push(event);
		if (this.log.length > this.options.capacity) this.log.shift();
		this.outbox.push(event);
		if (this.delivering) return event;
		this.delivering = true;
		for (let next = this.outbox.shift(); next; next = this.outbox.shift()) {
			for (const listener of this.listeners) {
				try {
					listener(next);
				} catch {
					// One failing subscriber must not stop the others, nor what recorded the event.
				}
			}
		}
		this.delivering = false;
		return event;
	}

	subscribe(listener: (event: BridgeEvent) => void): () => void {
		const after = this.seq;
		const live = (event: BridgeEvent) => { if (event.seq > after) listener(event); };
		this.listeners.add(live);
		return () => this.listeners.delete(live);
	}

	eventsSince(since: number): { header: ReplayHeader; events: BridgeEvent[] } {
		const oldestSeq = this.log[0]?.seq ?? null;
		const gap = oldestSeq !== null && since + 1 < oldestSeq;
		return { header: { ...this.envelope(), since, oldestSeq, gap }, events: this.log.filter((event) => event.seq > since) };
	}

	// ---- What the agent's hooks report ----

	started(reason: string): void {
		this.record({ type: "session_start", reason });
	}

	/** The user (or the app, through the pane) submitted a prompt: the agent works until it stops. */
	promptSubmitted(): void {
		this.promptsSeen++;
		this.terminalFallback = false;
		this.setPrompt(null);
		if (this.running) return;
		this.running = true;
		this.runId++;
		this.record({ type: "agent_start" });
	}

	/** The agent finished answering. */
	stopped(): void {
		this.terminalFallback = false;
		this.setPrompt(null);
		this.settle(false);
	}

	/**
	 * The agent's own Interrupt hook (Codex): the user stopped the run, so no terminal permission dialog is open. Hook
	 * evidence, unlike a transcript interrupt line, which may belong to an earlier turn and be read late.
	 */
	interrupted(): void {
		this.terminalFallback = false;
		if (this.prompt?.kind === "confirm" && this.approvals.size === 0) this.setPrompt(null);
		this.settle(true);
	}

	/** The agent asks for the user: a permission dialog, or it has been waiting for input. */
	notified(kind: PendingPrompt["kind"], title: string): void {
		// The terminal permission dialog is still open: another kind of prompt must not hide it.
		if (this.terminalFallback && kind !== "confirm") return;
		this.setPrompt(title ? { kind, title } : { kind });
	}

	// ---- What the transcript shows ----

	/** `live` items are new since the bridge started and also become events; older ones only fill the history. */
	conversation(items: ConversationItem[], live: boolean): void {
		for (const item of items) {
			if (item.type === "interrupt") {
				// The line may be an earlier turn's, read late: it settles the run but is no evidence that a terminal
				// permission dialog of this turn closed.
				if (live) {
					this.clearNotifiedConfirm();
					this.settle(true);
				}
				continue;
			}
			if (item.type === "tool_use") {
				this.toolNames.set(item.id, item.toolName);
				if (this.toolNames.size > 1000) this.toolNames.delete(this.toolNames.keys().next().value!);
				if (live) this.record({ type: "tool_start", toolCallId: item.id, toolName: item.toolName });
				continue;
			}
			if (item.type === "user") {
				const message = { role: "user", text: cut(item.text, MAX_MESSAGE_TEXT), images: item.images, toolCalls: 0 };
				this.remember({ entryId: item.id, ...message });
				if (live) {
					this.record({ type: "message_start", message, pendingMessages: false });
					this.record({ type: "message_end", message });
				}
				continue;
			}
			if (item.type === "assistant") {
				if (item.model) this.model = { id: item.model, provider: this.options.provider, acceptsImages: false };
				const message = { role: "assistant", text: cut(item.text, MAX_MESSAGE_TEXT), images: 0, toolCalls: item.toolCalls };
				this.remember({ entryId: item.id, ...message });
				// A permission answered in the terminal lets the agent go on: its dialog is no longer open.
				if (live) this.clearNotifiedConfirm();
				if (live && item.text.trim()) {
					this.record({ type: "message_start", message: { ...message, text: "" }, pendingMessages: false });
					this.record({ type: "message_end", message });
				}
				continue;
			}
			const text = item.text.length > MAX_TOOL_TEXT ? `${item.text.slice(0, MAX_TOOL_TEXT)}…` : item.text;
			this.remember({ entryId: `${item.id}:${item.toolUseId}`, role: "toolResult", text, images: 0, toolCalls: 0 });
			if (live) {
				this.clearNotifiedConfirm();
				this.record({ type: "tool_end", toolCallId: item.toolUseId, toolName: this.toolNames.get(item.toolUseId) ?? "tool", isError: item.isError });
			}
		}
	}

	// ---- Approvals (protocol 1.9) ----

	/**
	 * Shows the agent's permission request to the app and waits for its answer. Resolves to the decision, or to
	 * null when nobody answered in time, the hook went away (`closed`), the session ended, or too many are waiting:
	 * then the agent asks in its own terminal as usual. Each request resolves exactly once.
	 */
	requestApproval(input: { kind: ApprovalKind; title: string; detail: string; detailTruncated?: boolean; source?: { toolName: string; args: unknown } }, closed?: AbortSignal): Promise<ApprovalDecision | null> {
		if (this.closed) return Promise.resolve(null);
		// The run that asks: only while it is still the one working does a missing answer leave a dialog in its terminal.
		const turn = this.turn();
		const refuse = () => {
			this.fallBackToTerminal(turn, input.title);
			return Promise.resolve(null);
		};
		if (this.approvals.size >= APPROVALS_MAX_ITEMS || closed?.aborted) return refuse();
		// boundApproval marks a detail it cuts; one already cut by the hook's own source limit stays marked.
		const request = boundApproval({ id: this.options.newId(), kind: input.kind, title: input.title, detail: input.detail, ...(input.detailTruncated ? { detailTruncated: true } : {}), choices: APPROVAL_CHOICES });
		if (!request || this.approvals.has(request.id)) return refuse();
		this.permissionGeneration++;
		return new Promise((resolve) => {
			let cancelTimer = () => {};
			const onClosed = () => finish(null, "cancel");
			const finish = (decision: ApprovalDecision | null, resolvedAs: ApprovalDecision) => {
				if (this.approvals.get(request.id)?.request !== request) return;
				this.approvals.delete(request.id);
				cancelTimer();
				closed?.removeEventListener("abort", onClosed);
				resolve(decision);
				this.record({ type: "approval_resolved", id: request.id, decision: resolvedAs });
				// No answer from the app during the run that asked: the agent now asks in its own terminal, and its dialog
				// stays open until a hook shows it moved on. While idle, interrupted or in a later turn no such dialog is open.
				if (decision === null) this.fallBackToTerminal(turn, request.title);
				if (this.approvals.size === 0 && this.prompt?.kind === "confirm" && !this.terminalFallback) this.setPrompt(null);
			};
			this.approvals.set(request.id, { request, finish });
			// All set up before subscribers hear of it: one may answer at once, and finish must then undo everything.
			cancelTimer = this.options.timers.set(this.options.approvalTimeoutMs, () => finish(null, "cancel"));
			closed?.addEventListener("abort", onClosed, { once: true });
			this.record({ type: "approval_request", ...request });
			// Apps before 1.9 do not know approvals; a confirm dialog still shows that the session needs the user.
			if (this.approvals.get(request.id)?.request === request) this.setPrompt({ kind: "confirm", title: request.title, ...(input.source ? { source: input.source } : {}) });
		});
	}

	async answerApproval(body: unknown): Promise<Result<ApprovalAnswerResponse>> {
		if (this.closed) return { ok: false, error: this.error("no_session", "Session ended.") };
		const decoded = decodeApprovalAnswer(body);
		if (!decoded.ok) return { ok: false, error: this.error("bad_request", "Invalid approval answer.") };
		const pending = this.approvals.get(decoded.value.id);
		if (!pending) return { ok: false, error: this.error("not_found", "This approval is no longer pending.") };
		if (!pending.request.choices.includes(decoded.value.decision)) return { ok: false, error: this.error("bad_request", "That answer was not offered.") };
		pending.finish(decoded.value.decision, decoded.value.decision);
		return { ok: true, value: { ...this.envelope(), status: "answered" } };
	}

	/** The session ended: every waiting approval falls back to the terminal, and no new one is accepted. */
	close(): void {
		this.closed = true;
		this.terminalFallback = false;
		this.cancelDelay();
		this.cancelRetry();
		for (const pending of [...this.approvals.values()]) pending.finish(null, "cancel");
	}

	// ---- What the app reads ----

	state(): StateResponse {
		return {
			...this.envelope(),
			agent: this.options.agent,
			capabilities: this.capabilities(),
			terminal: this.terminal !== undefined,
			...(this.terminal?.paneId === undefined ? {} : { terminalPane: this.terminal.paneId }),
			activity: null,
			...(this.lastOutcome === undefined ? {} : { lastOutcome: this.lastOutcome }),
			idle: !this.running,
			pendingMessages: false,
			pendingPrompt: this.prompt,
			model: this.model,
			lastSeq: this.seq,
			oldestSeq: this.log[0]?.seq ?? null,
			lastActivityAt: this.lastActivityAt,
			approvals: [...this.approvals.values()].map((pending) => pending.request),
		};
	}

	history(): HistoryResponse {
		return { ...this.envelope(), messages: [...this.items] };
	}

	// ---- What the app does, all through the session's own pane ----

	async sendMessage(body: unknown): Promise<Result<SendMessageResponse>> {
		const decoded = decodeResponse(SendMessageRequest, body);
		if (!decoded.ok) return { ok: false, error: this.error("bad_request", `Invalid message: ${decoded.errors.join("; ")}`) };
		if (decoded.value.attachments || decoded.value.images?.length) {
			return { ok: false, error: this.error("bad_request", "This session does not take images or attachments.") };
		}
		const text = terminalLine(decoded.value.text ?? "");
		if (!text) return { ok: false, error: this.error("bad_request", "A message needs text.") };
		if (text.length > TERMINAL_TEXT_MAX_LENGTH) return { ok: false, error: this.error("too_large", "The message is too long for one terminal input.") };
		// Bind the message to its permission context before it waits behind other input.
		const generation = this.permissionGeneration;
		if (this.submissionBlocked(generation) && !this.fallbackSettled(generation)) return this.interruptedSubmission();
		return this.inTurn(() => this.submit(text, generation));
	}

	private inTurn<T>(task: () => Promise<T>): Promise<T> {
		const result = this.sends.then(task);
		this.sends = result.catch(() => undefined);
		return result;
	}

	private submissionBlocked(generation: number): boolean {
		return this.closed || this.terminalFallback || this.prompt?.kind === "confirm" || this.approvals.size > 0 || generation !== this.permissionGeneration;
	}

	/**
	 * Only the terminal fallback stands between this message and the pane, and it is old enough that the agent has
	 * drawn its dialog: a screen without one then shows the dialog is gone (Claude Code has no Interrupt hook, so after
	 * Escape nothing else would ever clear it). A younger fallback is trusted as is: the hook that set it has just
	 * returned, and the agent draws its dialog only after that, so a screen read in between would show none yet.
	 */
	private fallbackSettled(generation: number): boolean {
		return !this.closed && this.terminalFallback && this.approvals.size === 0 && generation === this.permissionGeneration
			&& this.options.clock() - this.fallbackAt >= (this.options.fallbackSettleMs ?? FALLBACK_SETTLE_MS);
	}

	private interruptedSubmission(): Result<SendMessageResponse> {
		return { ok: false, error: this.error("no_session", "Interrupted: the session ended or now asks for the user, so the message was not sent.") };
	}

	/** Whether the pane's own screen shows an agent dialog; a screen that cannot be read counts as one. */
	private async dialogOnScreen(terminal: TerminalPort): Promise<boolean> {
		try {
			const screen = await terminal.screen();
			return !screen.ok || terminalDialogOpen(screen.value);
		} catch {
			return true;
		}
	}

	/**
	 * The screen is the direct evidence of a dialog; the events (approvals, hooks, transcript) arrive late or out of
	 * order. So both must agree, before the text and again right before its Enter: a dialog on screen, or a screen that
	 * cannot be read, stops the message, and so does any event-based guard.
	 */
	private async submit(text: string, generation: number): Promise<Result<SendMessageResponse>> {
		if (this.submissionBlocked(generation) && !this.fallbackSettled(generation)) return this.interruptedSubmission();
		const queued = this.running;
		// Text first, Enter as its own key a moment later: Claude Code (and Codex) read text and Enter arriving together
		// as one paste and leave it in the input box unsent.
		const sent = await this.withTerminal(async (terminal) => {
			if (await this.dialogOnScreen(terminal)) return { ok: true, value: false };
			// Checked again after the read: a fallback set meanwhile is a new one, and must not be cleared.
			if (this.fallbackSettled(generation)) {
				this.terminalFallback = false;
				this.clearNotifiedConfirm();
			}
			if (this.submissionBlocked(generation)) return { ok: true, value: false };
			const typed = await terminal.text(text, false);
			if (!typed.ok) return typed;
			if (this.closed) return { ok: true, value: false };
			await new Promise<void>((resolve) => {
				const timer = setTimeout(() => { this.cancelDelay = () => {}; resolve(); }, this.options.submitDelayMs ?? SUBMIT_DELAY_MS);
				this.cancelDelay = () => { clearTimeout(timer); this.cancelDelay = () => {}; resolve(); };
			});
			// Enter now would answer whatever took over the input: a dialog that opened meanwhile, or nothing at all.
			if (this.submissionBlocked(generation)) return { ok: true, value: false };
			if (await this.dialogOnScreen(terminal) || this.submissionBlocked(generation)) return { ok: true, value: false };
			const pressed = await terminal.keys(["enter"]);
			return pressed.ok ? { ok: true, value: true } : pressed;
		}, (pressed) => pressed);
		if (!sent.ok) return sent;
		if (!sent.value) return this.interruptedSubmission();
		this.record({ type: "message_submitted", queued, images: 0 });
		return { ok: true, value: { ...this.envelope(), status: queued ? "queued" : "submitted" } };
	}

	async abort(): Promise<Result<AbortResponse>> {
		if (this.closed) return { ok: false, error: this.error("no_session", "Session ended.") };
		if (!this.running) return { ok: true, value: { ...this.envelope(), status: "idle" } };
		// Escape stops the agent's run; repeated presses while a stop is pending would also clear its input.
		const run = this.runId;
		if (this.stop?.run === run) return this.stop.result;
		// In turn, after any message being typed: Escape between its text and Enter would cut it. The run may end meanwhile.
		let pressed = false;
		const result = this.inTurn(async (): Promise<Result<AbortResponse>> => {
			if (this.closed) return { ok: false, error: this.error("no_session", "Session ended.") };
			if (!this.running || this.runId !== run) return { ok: true, value: { ...this.envelope(), status: "idle" } };
			const sent = await this.withTerminal((terminal) => terminal.keys(["esc"]), () => ({ ...this.envelope(), status: "requested" as const }));
			pressed = sent.ok;
			if (!sent.ok && this.stop?.result === result) this.stop = null;
			return sent;
		});
		this.stop = { run, result };
		const sent = await result;
		if (pressed && this.running && this.runId === run) this.record({ type: "abort_requested", wasIdle: false });
		return sent;
	}

	async terminalFocus(): Promise<Result<TerminalFocusResponse>> {
		return this.withTerminal((terminal) => terminal.focus(), () => ({ ...this.envelope(), status: "focused" as const }));
	}

	async terminalScreen(): Promise<Result<TerminalScreenResponse>> {
		return this.withTerminal((terminal) => terminal.screen(), (screen) => ({ ...this.envelope(), screen }));
	}

	async terminalInput(body: unknown): Promise<Result<TerminalInputResponse>> {
		const decoded = decodeResponse(TerminalInputRequest, body);
		if (!decoded.ok) return { ok: false, error: this.error("bad_request", "Invalid terminal input.") };
		const input = decoded.value;
		if (input.kind === "text" && input.attachments) return { ok: false, error: this.error("not_found", "This bridge cannot read attachments.") };
		// Raw input changes the input box: it waits behind a message being typed, and no Enter retry may follow it.
		this.submission++;
		this.cancelRetry();
		return this.inTurn(() => this.withTerminal(
			(terminal) => (input.kind === "text" ? terminal.text(input.text, input.enter) : terminal.keys(input.keys)),
			() => ({ ...this.envelope(), status: "sent" as const }),
		));
	}

	private async withTerminal<T, U>(operation: (terminal: TerminalPort) => Promise<TerminalResult<T>>, response: (value: T) => U): Promise<Result<U>> {
		if (this.closed) return { ok: false, error: this.error("no_session", "Session ended.") };
		if (!this.terminal) return { ok: false, error: this.error("not_found", "This session does not run in a Herdr pane.") };
		try {
			const result = await operation(this.terminal);
			if (result.ok) return { ok: true, value: response(result.value) };
		} catch {
			// Never expose subprocess errors, which can contain submitted text or private paths.
		}
		return { ok: false, error: this.error("internal", "Herdr did not complete the terminal operation.") };
	}

	/** The run and prompt an approval belongs to; a new UserPromptSubmit starts a new turn even within one run. */
	private turn(): { run: number; prompts: number } {
		return { run: this.runId, prompts: this.promptsSeen };
	}

	/**
	 * The agent got no decision for a request of `turn`, so it asks in its own terminal: hold phone messages out of that
	 * dialog until hook evidence, but only while that same turn is still the active run and the session is open.
	 */
	private fallBackToTerminal(turn: { run: number; prompts: number }, title: string): void {
		if (this.closed || !this.running || this.runId !== turn.run || this.promptsSeen !== turn.prompts) return;
		// Every fallback is a dialog the agent is about to draw: it restarts the settle window and invalidates sends in flight.
		this.terminalFallback = true;
		this.fallbackAt = this.options.clock();
		this.permissionGeneration++;
		if (this.prompt?.kind !== "confirm") this.setPrompt({ kind: "confirm", title });
	}

	private settle(aborted: boolean): void {
		if (!this.running) return;
		this.running = false;
		this.record({ type: "agent_end", pendingMessages: false });
		this.record({ type: "agent_settled", aborted, pendingMessages: false, outcome: aborted ? "aborted" : "completed" });
	}

	/** A permission answered in the terminal lets the agent go on, unless a terminal fallback awaits hook evidence. */
	private clearNotifiedConfirm(): void {
		if (this.prompt?.kind === "confirm" && this.approvals.size === 0 && !this.terminalFallback) this.setPrompt(null);
	}

	private setPrompt(prompt: PendingPrompt | null): void {
		if (prompt === null && this.prompt === null) return;
		const previous = this.prompt;
		this.prompt = prompt;
		if (prompt?.kind === "confirm") this.permissionGeneration++;
		if (prompt) this.record({ type: "prompt_start", prompt });
		else if (previous) this.record({ type: "prompt_end", kind: previous.kind });
	}

	private remember(item: HistoryItem): void {
		this.items.push(item);
		if (this.items.length > this.options.historyLimit) this.items.splice(0, this.items.length - this.options.historyLimit);
	}
}

/**
 * Text typed as one terminal line and Enter: a newline would submit early in a terminal without bracketed paste,
 * so line breaks and tabs become spaces, and other control characters (escape sequences included) are dropped.
 */
/** The pause between typing a message and pressing Enter, so the agent sees a key press, not part of a paste. */
const SUBMIT_DELAY_MS = 500;
/** How long after a terminal fallback the agent's dialog is surely drawn, so a clean screen means it is gone. */
const FALLBACK_SETTLE_MS = 3_000;

export function terminalLine(text: string): string {
	return text.replace(/[\r\n\t]+/g, " ").replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
}

function cut(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}
