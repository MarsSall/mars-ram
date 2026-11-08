// Core of the session bridge: numbered event log with replay, pending-prompt
// tracking, and the operations a client may perform on the live session.
import {
	type AbortResponse,
	ATTACHMENT_MAX_BYTES,
	withAttachedFiles,
	type BridgeEvent,
	type BridgeEventInput,
	decodeResponse,
	type ErrorCode,
	type ErrorResponse,
	type HistoryResponse,
	type ImageInput,
	type PendingPrompt,
	PROTOCOL_VERSION,
	type ReplayHeader,
	SendMessageRequest,
	type SendMessageResponse,
	type StateResponse,
	TERMINAL_TEXT_MAX_LENGTH,
	TerminalInputRequest,
	type TerminalInputResponse,
	type TerminalScreenResponse,
	type TerminalFocusResponse,
} from "@workspace/protocol";
import type { PiSessionPort, ResolvedUpload, TerminalPort, TerminalResult, UploadStorePort } from "./ports.ts";

const MAX_PROMPT_ARGS_BYTES = 16_384;
const MEGABYTE = 1024 * 1024;
/** Images are held in memory as base64 while a message is built; Pi shrinks them before the model anyway. */
const MAX_INLINE_IMAGE_BYTES = 50 * MEGABYTE;

export type BridgeSessionOptions = {
	pi: PiSessionPort;
	terminal?: TerminalPort;
	uploads?: UploadStorePort;
	instanceId: string;
	/** How many events are kept for replay. */
	capacity: number;
	clock: () => number;
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: ErrorResponse };

type RunningTool = { toolCallId: string; toolName: string; args: unknown };

export class BridgeSession {
	readonly instanceId: string;
	private readonly pi: PiSessionPort;
	private readonly terminal: TerminalPort | undefined;
	private readonly uploads: UploadStorePort | undefined;
	private readonly capacity: number;
	private readonly clock: () => number;
	private readonly log: BridgeEvent[] = [];
	private readonly listeners = new Set<(event: BridgeEvent) => void>();
	private readonly runningTools: RunningTool[] = [];
	private pendingPrompt: PendingPrompt | null = null;
	private seq = 0;
	private lastActivityAt: number | null = null;
	private activity: string | null = null;
	private lastOutcome: StateResponse["lastOutcome"];

	constructor(options: BridgeSessionOptions) {
		this.pi = options.pi;
		this.terminal = options.terminal;
		this.uploads = options.uploads;
		this.instanceId = options.instanceId;
		this.capacity = options.capacity;
		this.clock = options.clock;
	}

	envelope() {
		return { protocolVersion: PROTOCOL_VERSION, bridgeInstanceId: this.instanceId, sessionId: this.pi.sessionId() };
	}

	error(code: ErrorCode, message: string): ErrorResponse {
		return { ...this.envelope(), error: { code, message } };
	}

	record(input: BridgeEventInput): BridgeEvent {
		// Keep agent_settled as the final event of a run, including its clear.
		if (input.type === "agent_start" || input.type === "agent_settled") this.setActivity(null);
		const event = { ...input, seq: ++this.seq, at: this.clock() } as BridgeEvent;
		this.lastActivityAt = event.at;
		if (event.type === "agent_settled") {
			this.lastOutcome = event.outcome === undefined ? undefined : { outcome: event.outcome, seq: event.seq };
		}
		this.log.push(event);
		if (this.log.length > this.capacity) this.log.shift();
		for (const listener of this.listeners) listener(event);
		return event;
	}

	setActivity(activity: string | null): void {
		if (activity === this.activity) return;
		this.activity = activity;
		this.record({ type: "activity", activity });
	}

	subscribe(listener: (event: BridgeEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	eventsSince(since: number): { header: ReplayHeader; events: BridgeEvent[] } {
		const oldestSeq = this.log[0]?.seq ?? null;
		// A gap means events after the cursor were dropped from the log.
		const gap = oldestSeq !== null && since + 1 < oldestSeq;
		return {
			header: { ...this.envelope(), since, oldestSeq, gap },
			events: this.log.filter((event) => event.seq > since),
		};
	}

	toolStarted(tool: RunningTool): void {
		this.runningTools.push(tool);
		this.record({ type: "tool_start", toolCallId: tool.toolCallId, toolName: tool.toolName });
	}

	toolEnded(tool: { toolCallId: string; toolName: string; isError: boolean }): void {
		const index = this.runningTools.findIndex((running) => running.toolCallId === tool.toolCallId);
		if (index !== -1) this.runningTools.splice(index, 1);
		this.record({ type: "tool_end", ...tool });
	}

	promptStarted(prompt: { kind: PendingPrompt["kind"]; title?: string }): void {
		// A dialog opened while a tool runs belongs to the most recent running tool.
		const tool = this.runningTools.at(-1);
		const pending: PendingPrompt = { kind: prompt.kind };
		if (prompt.title !== undefined) pending.title = prompt.title;
		if (tool) pending.source = { toolName: tool.toolName, args: boundedArgs(tool.args) };
		this.pendingPrompt = pending;
		this.record({ type: "prompt_start", prompt: pending });
	}

	promptEnded(prompt: { kind: PendingPrompt["kind"] }): void {
		this.pendingPrompt = null;
		this.record({ type: "prompt_end", kind: prompt.kind });
	}

	state(): StateResponse {
		return {
			...this.envelope(),
			terminal: this.terminal !== undefined,
			...(this.terminal?.paneId === undefined ? {} : { terminalPane: this.terminal.paneId }),
			activity: this.activity,
			...(this.lastOutcome === undefined ? {} : { lastOutcome: this.lastOutcome }),
			idle: this.pi.isIdle(),
			pendingMessages: this.pi.hasPendingMessages(),
			pendingPrompt: this.pendingPrompt,
			model: this.pi.model(),
			lastSeq: this.seq,
			oldestSeq: this.log[0]?.seq ?? null,
			lastActivityAt: this.lastActivityAt,
		};
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
		let text = input.kind === "text" ? input.text : "";
		if (input.kind === "text" && input.attachments) {
			const found = await this.resolveUploads(input.attachments);
			if (!found.ok) return found;
			text = withPaths(text, found.value);
			if (text.length > TERMINAL_TEXT_MAX_LENGTH) {
				return { ok: false, error: this.error("bad_request", "The text and the attachment paths are too long for one terminal input.") };
			}
		}
		return this.withTerminal(
			(terminal) => input.kind === "text" ? terminal.text(text, input.enter) : terminal.keys(input.keys),
			() => ({ ...this.envelope(), status: "sent" as const }),
		);
	}

	/** All uploads or none: a missing or oversized one fails the whole request, naming only the upload. */
	private async resolveUploads(names: string[]): Promise<Result<{ name: string; upload: ResolvedUpload }[]>> {
		const uploads = this.uploads;
		if (!uploads) return { ok: false, error: this.error("not_found", "This bridge cannot read attachments.") };
		const found: { name: string; upload: ResolvedUpload }[] = [];
		for (const name of names) {
			const upload = await uploads.resolve(name);
			if (!upload) return { ok: false, error: this.error("not_found", `An attachment is not on the computer: ${name}. Attach it again.`) };
			if (upload.size > ATTACHMENT_MAX_BYTES) {
				return { ok: false, error: this.error("too_large", `${name} is larger than ${ATTACHMENT_MAX_BYTES / MEGABYTE} MB.`) };
			}
			found.push({ name, upload });
		}
		return { ok: true, value: found };
	}

	private async withTerminal<T, U>(operation: (terminal: TerminalPort) => Promise<TerminalResult<T>>, response: (value: T) => U): Promise<Result<U>> {
		if (!this.terminal) return { ok: false, error: this.error("not_found", "This session does not run in a Herdr pane.") };
		try {
			const result = await operation(this.terminal);
			if (result.ok) return { ok: true, value: response(result.value) };
		} catch {
			// Never expose subprocess errors, which can contain submitted text or private paths.
		}
		return { ok: false, error: this.error("internal", "Herdr did not complete the terminal operation.") };
	}

	history(): HistoryResponse {
		return { ...this.envelope(), messages: this.pi.history() };
	}

	async sendMessage(request: unknown): Promise<Result<SendMessageResponse>> {
		const decoded = decodeResponse(SendMessageRequest, request);
		if (!decoded.ok) return { ok: false, error: this.error("bad_request", `Invalid message: ${decoded.errors.join("; ")}`) };
		let text = decoded.value.text?.trim() ? decoded.value.text : undefined;
		const images: ImageInput[] = [...(decoded.value.images ?? [])];
		const names = decoded.value.attachments;
		if (text === undefined && images.length === 0 && !names) {
			return { ok: false, error: this.error("bad_request", "A message needs text, an image, or an attachment.") };
		}
		let details: SendMessageResponse["attachments"];
		if (names) {
			const found = await this.resolveUploads(names);
			if (!found.ok) return found;
			const withheld = this.imagesWithheld();
			const pictures = found.value.filter(({ upload }) => upload.mimeType !== null);
			if (withheld === "none") {
				const total = pictures.reduce((sum, { upload }) => sum + upload.size, 0);
				if (total > MAX_INLINE_IMAGE_BYTES) {
					return {
						ok: false,
						error: this.error("too_large", `The images in one message add up to more than ${MAX_INLINE_IMAGE_BYTES / MEGABYTE} MB. Send fewer images at a time.`),
					};
				}
				for (const { name, upload } of pictures) {
					try {
						images.push({ data: await this.uploads!.readBase64(upload.path), mimeType: upload.mimeType! });
					} catch {
						// File system errors name private paths; report the upload only.
						return { ok: false, error: this.error("internal", `Could not read ${name} on the computer.`) };
					}
				}
			}
			text = withPaths(text ?? "", found.value);
			details = {
				files: found.value.length,
				imagesAttached: withheld === "none" ? pictures.length : 0,
				imagesWithheld: pictures.length === 0 ? "none" : withheld,
			};
		}
		const queued = !this.pi.isIdle();
		this.pi.send({ text, images }, queued);
		this.record({ type: "message_submitted", queued, images: images.length, ...(names ? { attachments: names.length } : {}) });
		return { ok: true, value: { ...this.envelope(), status: queued ? "queued" : "submitted", ...(details ? { attachments: details } : {}) } };
	}

	private imagesWithheld(): "none" | "model" | "blocked" {
		if (this.pi.imagesBlocked()) return "blocked";
		return this.pi.model()?.acceptsImages ? "none" : "model";
	}

	abort(): AbortResponse {
		if (this.pi.isIdle()) return { ...this.envelope(), status: "idle" };
		this.record({ type: "abort_requested", wasIdle: false });
		this.pi.abort();
		return { ...this.envelope(), status: "requested" };
	}
}

/** The text, then every attachment's absolute path on its own line, so the agent can open them. */
function withPaths(text: string, found: { upload: ResolvedUpload }[]): string {
	return withAttachedFiles(text, found.map(({ upload }) => upload.path));
}

function boundedArgs(args: unknown): unknown {
	const size = Buffer.byteLength(JSON.stringify(args ?? null));
	return size > MAX_PROMPT_ARGS_BYTES ? { omitted: `arguments larger than ${MAX_PROMPT_ARGS_BYTES} bytes` } : args;
}
