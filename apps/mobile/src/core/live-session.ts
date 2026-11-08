// Follows one session live: loads a consistent snapshot, applies the event stream from where
// it ends, and reconnects on its own after a drop (PRD R3, R4).
import { type BridgeEvent, type LastOutcome, decodeEvent, decodeResponse, ReplayHeader } from "@workspace/protocol";
import { bridgeClient, type BridgeEndpoint, type BridgeHttp } from "./bridge-client";
import { addQueued, applyEvent, type Conversation, fromSnapshot } from "./conversation";
import type { Attachment } from "./attachment-draft";
import { uploadAttachments, type AttachmentUploads, type UploadProgress } from "./attachment-uploads";

export type StreamHandlers = {
	/** The first message of every stream: where replay starts and whether events were lost. */
	onReplay(data: unknown): void;
	onEvent(data: unknown): void;
	/** The stream ended without the client closing it. */
	onClose(reason: string): void;
};

/** Port: the bridge's server-sent event stream. Returns a function that closes it. */
export interface EventStream {
	open(url: string, token: string, handlers: StreamHandlers): () => void;
}

export type Timers = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };

/** `gone`: the session is no longer open on the computer; `unreachable`: try again later. */
export type EndpointResult = BridgeEndpoint | "gone" | "unreachable";

export type LiveSessionDeps = {
	http: BridgeHttp;
	events: EventStream;
	timers: Timers;
	/** The session's tunnel; `fresh` asks for a new one instead of the one in use. */
	endpoint(fresh: boolean): Promise<EndpointResult>;
	uploads?: AttachmentUploads;
};

export type LivePhase = "connecting" | "live" | "reconnecting" | "ended";

export type LiveView = {
	phase: LivePhase;
	conversation: Conversation | null;
	/** Live updates were lost during a disconnection; the conversation was reloaded. */
	missedEvents: boolean;
	/** A stop was requested a while ago and Pi has not confirmed it. */
	stopSlow: boolean;
	/** Latest settle evidence, scoped to the current bridge instance; undefined means unknown. */
	lastOutcome?: LastOutcome | undefined;
};

export type ActionResult = { ok: true; imagesWithheld?: "none" | "model" | "blocked" } | { ok: false; message: string };

const RETRY_MS = [1_000, 2_000, 5_000, 10_000];
const STOP_SLOW_MS = 10_000;
const SNAPSHOT_TRIES = 3;

export class LiveSession {
	private view: LiveView = { phase: "connecting", conversation: null, missedEvents: false, stopSlow: false };
	private readonly listeners = new Set<(view: LiveView) => void>();
	private current: BridgeEndpoint | null = null;
	private protocolVersion = "";
	private closeStream: (() => void) | null = null;
	private stream = 0;
	private attempt = 0;
	private retryTimer: unknown = null;
	private stopTimer: unknown = null;
	/** Events that arrive while the snapshot is reloaded, applied after it. */
	private buffered: BridgeEvent[] | null = null;
	private queuedCount = 0;
	private disposed = false;

	constructor(private readonly deps: LiveSessionDeps) {}

	subscribe(listener: (view: LiveView) => void): () => void {
		this.listeners.add(listener);
		listener(this.view);
		return () => this.listeners.delete(listener);
	}

	start(): void {
		void this.connect(false);
	}

	async send(text: string, attachments: readonly Attachment[] = [], progress?: UploadProgress): Promise<ActionResult> {
		const trimmed = text.trim();
		if (!trimmed && attachments.length === 0) return { ok: false, message: "Write a message first." };
		if (!this.current || !this.view.conversation) return { ok: false, message: "The session is not connected." };
		const uploaded = attachments.length ? await uploadAttachments(this.deps.uploads, this.protocolVersion, attachments, progress) : null;
		if (uploaded && !uploaded.ok) return uploaded;
		const sent = await bridgeClient.send(this.deps.http, this.current, { text: trimmed, ...(uploaded?.ok ? { attachments: uploaded.names } : {}) })
			.catch(() => ({ ok: false as const, message: "The message could not be sent. Keep your draft and try again." }));
		if (!sent.ok) return { ok: false, message: sent.message };
		// Shown only now that the computer confirmed it; a direct send appears when the agent takes it.
		if (sent.value.status === "queued" && this.view.conversation) {
			this.update({ conversation: addQueued(this.view.conversation, `q${++this.queuedCount}`, trimmed, uploaded?.ok ? uploaded.names : []) });
		}
		return { ok: true, ...(attachments.length && sent.value.attachments ? { imagesWithheld: sent.value.attachments.imagesWithheld } : {}) };
	}

	async requestStop(): Promise<ActionResult> {
		if (!this.current) return { ok: false, message: "The session is not connected." };
		const result = await bridgeClient.abort(this.deps.http, this.current);
		if (!result.ok) return { ok: false, message: result.message };
		if (result.value.status === "requested" && this.view.conversation) {
			this.update({ conversation: { ...this.view.conversation, stopping: true } });
			this.deps.timers.clear(this.stopTimer);
			this.stopTimer = this.deps.timers.set(() => {
				if (this.view.conversation?.stopping) this.update({ stopSlow: true });
			}, STOP_SLOW_MS);
		}
		return { ok: true };
	}

	dispose(): void {
		this.disposed = true;
		this.closeStream?.();
		this.closeStream = null;
		this.deps.timers.clear(this.retryTimer);
		this.deps.timers.clear(this.stopTimer);
		this.listeners.clear();
	}

	private async connect(fresh: boolean): Promise<void> {
		const target = await this.deps.endpoint(fresh);
		if (this.disposed) return;
		if (target === "gone") return this.update({ phase: "ended" });
		if (target === "unreachable") return this.retry();
		this.current = target;
		if (!this.view.conversation && !(await this.loadSnapshot())) return this.retry();
		if (this.disposed) return;
		this.openStream();
	}

	/** Reads state, history, and state again, so no event falls between the snapshot and the stream. */
	private async loadSnapshot(): Promise<boolean> {
		const endpoint = this.current;
		if (!endpoint) return false;
		for (let attempt = 1; attempt <= SNAPSHOT_TRIES; attempt++) {
			const before = await bridgeClient.state(this.deps.http, endpoint);
			if (!before.ok) return false;
			const history = await bridgeClient.history(this.deps.http, endpoint);
			if (!history.ok) return false;
			const after = await bridgeClient.state(this.deps.http, endpoint);
			if (!after.ok) return false;
			if (before.value.lastSeq === after.value.lastSeq || attempt === SNAPSHOT_TRIES) {
				this.protocolVersion = after.value.protocolVersion;
				const loaded = fromSnapshot(after.value, history.value.messages);
				this.update({ conversation: { ...loaded, outgoing: this.view.conversation?.outgoing ?? [] }, lastOutcome: after.value.lastOutcome });
				return true;
			}
		}
		return false;
	}

	private openStream(): void {
		const endpoint = this.current!;
		const id = ++this.stream;
		const since = this.view.conversation?.lastSeq ?? 0;
		this.closeStream = this.deps.events.open(`${endpoint.baseUrl}/events?since=${since}`, endpoint.token, {
			onReplay: (data) => {
				if (id !== this.stream || this.disposed) return;
				const header = decodeResponse(ReplayHeader, data);
				this.attempt = 0;
				this.update({ phase: "live" });
				if (header.ok && header.value.gap) {
					this.update({ missedEvents: true });
					void this.reload();
				}
			},
			onEvent: (data) => {
				if (id !== this.stream || this.disposed) return;
				const decoded = decodeEvent(data);
				// Unknown events come from a newer bridge and are skipped.
				if (decoded.kind === "known") this.onEvent(decoded.event);
			},
			onClose: () => {
				if (id !== this.stream || this.disposed) return;
				this.closeStream?.();
				this.closeStream = null;
				this.update({ phase: "reconnecting" });
				this.retry();
			},
		});
	}

	private onEvent(event: BridgeEvent): void {
		if (this.buffered) {
			this.buffered.push(event);
			return;
		}
		// Pi opened another session in the same window: its history replaces this one.
		if (event.type === "session_start") {
			void this.reload();
			return;
		}
		this.apply([event]);
	}

	private apply(events: BridgeEvent[]): void {
		if (!this.view.conversation) return;
		let lastOutcome = this.view.lastOutcome;
		const conversation = events.reduce((current, event) => {
			if (event.seq > current.lastSeq && event.type === "agent_settled") {
				lastOutcome = event.outcome === undefined ? undefined : { outcome: event.outcome, seq: event.seq };
			}
			return applyEvent(current, event);
		}, this.view.conversation);
		const settled = !conversation.stopping;
		if (settled) this.deps.timers.clear(this.stopTimer);
		this.update({ conversation, lastOutcome, stopSlow: settled ? false : this.view.stopSlow });
	}

	private async reload(): Promise<void> {
		if (this.buffered) return;
		this.buffered = [];
		const loaded = await this.loadSnapshot();
		const pending = this.buffered;
		this.buffered = null;
		if (!this.disposed && loaded) this.apply(pending);
	}

	private retry(): void {
		if (this.disposed) return;
		this.update({ phase: this.view.conversation ? "reconnecting" : "connecting" });
		const delay = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)]!;
		this.attempt++;
		// The first retry reuses the tunnel; later ones ask for a new one, since it may be gone.
		const fresh = this.attempt > 1;
		this.retryTimer = this.deps.timers.set(() => void this.connect(fresh), delay);
	}

	private update(change: Partial<LiveView>): void {
		this.view = { ...this.view, ...change };
		for (const listener of this.listeners) listener(this.view);
	}
}
