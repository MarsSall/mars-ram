// Protocol between the mobile app and the session bridge.
// Rules: every response carries the envelope; changes within a major version
// are additive, so decoders ignore unknown fields and unknown event types.
import { type Static, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";

export const PROTOCOL_VERSION = "1.8";

/** The one value that names the product; change it when the final name is chosen. */
export const APP_ID = "mars-ram";

/** Where running bridges publish themselves, relative to the host user's home directory. */
export const REGISTRY_DIRECTORY = `.${APP_ID}/bridges`;

/**
 * @deprecated Where apps before 1.7 copied attachments, relative to the host user's home directory (1.2–1.6).
 * Since 1.7 the host names the folder: `mars-ram uploads-dir --json` (see `decodeUploadsDir`).
 */
export const UPLOADS_DIRECTORY = `.${APP_ID}/uploads`;

/** The protocol minor from which the bridge reads attachments only from the host's private temp folder. */
export const UPLOADS_IN_TEMP_MINOR = 7;

/** The output of `mars-ram uploads-dir --json`: the absolute folder for attachments, or why the host refused it. */
export type UploadsDir = { ok: true; path: string } | { ok: false; error: "unsafe_folder" | "unavailable"; message: string };

/** Decodes the one JSON line of `mars-ram uploads-dir --json`; anything else (an older CLI's usage text) is null. */
export function decodeUploadsDir(output: string): UploadsDir | null {
	const line = output.replace(/\r?\n$/, "");
	if (/[\r\n]/.test(line)) return null;
	let value: unknown;
	try { value = JSON.parse(line); } catch { return null; }
	if (!value || typeof value !== "object" || (value as { v?: unknown }).v !== 1) return null;
	const { path, error, message } = value as { path?: unknown; error?: unknown; message?: unknown };
	if (typeof path === "string") return /^(?:\/|[A-Za-z]:\\)/.test(path) && !/[\x00-\x1f]/.test(path) ? { ok: true, path } : null;
	if ((error === "unsafe_folder" || error === "unavailable") && typeof message === "string") return { ok: false, error, message };
	return null;
}

/** The largest file the app uploads as an attachment. */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/** The most attachments one message or terminal input may reference. */
export const MAX_ATTACHMENTS = 10;

/** Shared text convention, not a wire-schema change. Keep these bytes stable for Pi history. */
export function withAttachedFiles(text: string, paths: readonly string[]): string {
	const list = ["Attached files:", ...paths].join("\n");
	return text ? `${text}\n\n${list}` : list;
}

/** Recognize only a complete terminal block of absolute paths to upload names. */
export function splitAttachedFiles(text: string): { text: string; files: string[] } {
	// Preserve the user's bytes; tolerate CRLF only in the appended history block.
	const blocks = [...text.matchAll(/(?:^|\r?\n\r?\n)Attached files:\r?\n/g)];
	const block = blocks.at(-1);
	if (!block) return { text, files: [] };
	const start = block.index;
	// Pi appends "[Image: original WxH, displayed at …]" after the text when it shrinks an image.
	const rest = text.slice(start + block[0].length).replace(/(?:\s*\[Image: [^\]\r\n]*\])+\s*$/, "");
	const paths = rest.split(/\r?\n/);
	const files = paths.map(path => path.split(/[\\/]/).at(-1) ?? "");
	if (!paths.every((path, i) => /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path) && !/[\r\n]/.test(path) && Value.Check(UploadName, files[i]))) return { text, files: [] };
	return { text: text.slice(0, start), files };
}

const SUPPORTED_MAJOR = 1;

export type Compatibility = { ok: true } | { ok: false; message: string };

export function checkCompatibility(version: string): Compatibility {
	const match = /^(\d+)\.(\d+)$/.exec(version);
	if (!match) return { ok: false, message: `The bridge reported an invalid protocol version "${version}".` };
	if (Number(match[1]) !== SUPPORTED_MAJOR) {
		return {
			ok: false,
			message: `The bridge speaks protocol ${version}, but this app supports protocol ${SUPPORTED_MAJOR}.x. Update the app or the bridge so both use the same major version.`,
		};
	}
	return { ok: true };
}

/** Whether a bridge of this version reads attachments; an older one would silently drop them. */
export function supportsAttachments(version: string): boolean {
	const match = /^(\d+)\.(\d+)$/.exec(version);
	return match !== null && Number(match[1]) === SUPPORTED_MAJOR && Number(match[2]) >= 2;
}

/** Whether a bridge of this version reads attachments from the folder `mars-ram uploads-dir` names. */
export function supportsTempUploads(version: string): boolean {
	const match = /^(\d+)\.(\d+)$/.exec(version);
	return match !== null && Number(match[1]) === SUPPORTED_MAJOR && Number(match[2]) >= UPLOADS_IN_TEMP_MINOR;
}

// ---- Envelope and shared shapes ----

const Envelope = {
	protocolVersion: Type.String(),
	bridgeInstanceId: Type.String({ minLength: 1 }),
	sessionId: Type.String({ minLength: 1 }),
};

export const PromptKind = Type.Union([
	Type.Literal("select"),
	Type.Literal("confirm"),
	Type.Literal("input"),
	Type.Literal("editor"),
	Type.Literal("custom"),
]);

/** The tool call that opened a dialog, when the bridge saw one just before it. */
export const PromptSource = Type.Object({ toolName: Type.String(), args: Type.Unknown() });

export const PendingPrompt = Type.Object({
	kind: PromptKind,
	title: Type.Optional(Type.String()),
	source: Type.Optional(PromptSource),
});

/** Since 1.4: a short phase id, never tool arguments or display text. */
export const ACTIVITY_ID_PATTERN = "^[a-z][a-z-]{0,31}$";
export const Activity = Type.Union([
	Type.String({ pattern: ACTIVITY_ID_PATTERN, maxLength: 32, not: Type.String({ pattern: "[^a-z-]" }) }),
	Type.Null(),
]);

/** Since 1.6: absence means unknown, never inferred success. */
export const RunOutcome = Type.Union([Type.Literal("completed"), Type.Literal("failed"), Type.Literal("aborted")]);
export type RunOutcome = Static<typeof RunOutcome>;
export const LastOutcome = Type.Object({ outcome: RunOutcome, seq: Type.Integer({ minimum: 1 }) });
export type LastOutcome = Static<typeof LastOutcome>;

/** Since 1.8: the most subagents one session state lists, and the longest agent tag and label (in code points). */
export const SUBAGENTS_MAX_ITEMS = 8;
export const SUBAGENT_ID_MAX_LENGTH = 64;
export const SUBAGENT_AGENT_MAX_LENGTH = 24;
export const SUBAGENT_LABEL_MAX_LENGTH = 60;

export const SubagentStatus = Type.Union([Type.Literal("queued"), Type.Literal("running"), Type.Literal("waiting")]);
export type SubagentStatus = Static<typeof SubagentStatus>;

/** Since 1.8: one subagent of the session; `since` is when the bridge first saw it (milliseconds since 1970). */
export const SubagentItem = Type.Object({
	id: Type.String({ minLength: 1, maxLength: SUBAGENT_ID_MAX_LENGTH }),
	agent: Type.String({ minLength: 1, maxLength: SUBAGENT_AGENT_MAX_LENGTH }),
	label: Type.String({ maxLength: SUBAGENT_LABEL_MAX_LENGTH }),
	status: SubagentStatus,
	question: Type.Boolean(),
	since: Type.Integer({ minimum: 0 }),
});
export type SubagentItem = Static<typeof SubagentItem>;

/** Since 1.8: `available: false` means the session has no subagent source (no Gentle Agents); then `items` is empty. */
export const Subagents = Type.Object({
	available: Type.Boolean(),
	items: Type.Array(SubagentItem, { maxItems: SUBAGENTS_MAX_ITEMS }),
});
export type Subagents = Static<typeof Subagents>;

const NO_SUBAGENTS: Subagents = { available: false, items: [] };

const codePoints = (text: string, max: number) => Array.from(text).slice(0, max).join("");
/** One line of text: whitespace runs (newlines included) become one space, ends trimmed. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The one rule that turns anything into a valid `Subagents` value, shared by the bridge (before it
 * publishes) and the app (after it decodes the state). Never throws. Absent or malformed input, or
 * `available` other than `true`, is `{ available: false, items: [] }`. Items without a valid id
 * (1–64 characters), agent, known status, or `since` are dropped, as are repeated ids (first wins);
 * agent and label become one line and are cut to 24 and 60 code points; `question` is true only when
 * it is `true`. Items asking a question come first, then oldest `since`, then id; at most 8 are kept.
 */
export function boundSubagents(raw: unknown): Subagents {
	if (!raw || typeof raw !== "object") return NO_SUBAGENTS;
	const { available, items } = raw as { available?: unknown; items?: unknown };
	if (available !== true) return NO_SUBAGENTS;
	if (!Array.isArray(items)) return { available: true, items: [] };
	const seen = new Set<string>();
	const kept: SubagentItem[] = [];
	for (const item of items) {
		if (!item || typeof item !== "object") continue;
		const { id, agent, label, status, question, since } = item as Record<string, unknown>;
		if (typeof id !== "string" || id.length === 0 || Array.from(id).length > SUBAGENT_ID_MAX_LENGTH || seen.has(id)) continue;
		if (status !== "queued" && status !== "running" && status !== "waiting") continue;
		if (typeof since !== "number" || !Number.isFinite(since) || since < 0) continue;
		const tag = typeof agent === "string" ? codePoints(oneLine(agent), SUBAGENT_AGENT_MAX_LENGTH) : "";
		if (!tag) continue;
		seen.add(id);
		kept.push({
			id,
			agent: tag,
			label: typeof label === "string" ? codePoints(oneLine(label), SUBAGENT_LABEL_MAX_LENGTH) : "",
			status,
			question: question === true,
			since: Math.floor(since),
		});
	}
	kept.sort((a, b) => Number(b.question) - Number(a.question) || a.since - b.since || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return { available: true, items: kept.slice(0, SUBAGENTS_MAX_ITEMS) };
}

export const ImageInput = Type.Object({ data: Type.String({ minLength: 1 }), mimeType: Type.String({ minLength: 1 }) });

/**
 * A file in the uploads folder, by name only: letters, digits, `.`, `_`, and `-`, starting and ending
 * with a letter or digit, so it can never name a path outside the folder. Unfinished `.part` uploads
 * and Windows device names are refused in any letter case, since Windows ignores case.
 */
export const UploadName = Type.String({
	minLength: 1,
	maxLength: 200,
	pattern: "^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$",
	not: Type.String({
		pattern: "\\.[pP][aA][rR][tT]$|^(?:[cC][oO][nN]|[pP][rR][nN]|[aA][uU][xX]|[nN][uU][lL]|[cC][oO][mM][0-9]|[lL][pP][tT][0-9])(?:\\..*)?$",
	}),
});

const Attachments = Type.Array(UploadName, { minItems: 1, maxItems: MAX_ATTACHMENTS });

export const MessageSummary = Type.Object({
	role: Type.String(),
	text: Type.String(),
	images: Type.Integer({ minimum: 0 }),
	toolCalls: Type.Integer({ minimum: 0 }),
	stopReason: Type.Optional(Type.String()),
});

// ---- Requests ----

export const SendMessageRequest = Type.Object({
	text: Type.Optional(Type.String()),
	images: Type.Optional(Type.Array(ImageInput)),
	/** Since 1.2: uploads to reference; the bridge attaches the images and appends every file's path. */
	attachments: Type.Optional(Attachments),
});

// ---- Responses ----

export const StateResponse = Type.Object({
	...Envelope,
	idle: Type.Boolean(),
	pendingMessages: Type.Boolean(),
	pendingPrompt: Type.Union([PendingPrompt, Type.Null()]),
	model: Type.Union([
		Type.Object({ id: Type.String(), provider: Type.String(), acceptsImages: Type.Boolean() }),
		Type.Null(),
	]),
	lastSeq: Type.Integer({ minimum: 0 }),
	oldestSeq: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
	/** When the newest event happened (milliseconds since 1970), or null before any event. */
	lastActivityAt: Type.Union([Type.Number(), Type.Null()]),
	/** Since 1.1: true when the session runs in a terminal pane the app can drive. Absent means false. */
	terminal: Type.Optional(Type.Boolean()),
	/** Captured inherited Herdr pane; absent on older bridges or outside Herdr. */
	terminalPane: Type.Optional(Type.String({ minLength: 1, maxLength: 129, pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}(:[a-zA-Z0-9][a-zA-Z0-9_-]{0,63})?$" })),
	/** Since 1.4: latest activity phase; absence is equivalent to null. */
	activity: Type.Optional(Activity),
	/** Since 1.6: latest settle's known outcome and its instance-local event seq; absent if unknown. */
	lastOutcome: Type.Optional(LastOutcome),
	/**
	 * Since 1.8: the session's subagents, shaped as `Subagents`. Deliberately not validated here, so a
	 * malformed value never makes the whole state undecodable: read it only through `boundSubagents`,
	 * which turns anything invalid into `{ available: false, items: [] }`. Absent on older bridges.
	 */
	subagents: Type.Optional(Type.Unknown()),
});

export const HistoryResponse = Type.Object({
	...Envelope,
	messages: Type.Array(Type.Object({ entryId: Type.String(), ...MessageSummary.properties })),
});

/** `queued` means the agent was busy and the message waits as steering. */
export const SendMessageResponse = Type.Object({
	...Envelope,
	status: Type.Union([Type.Literal("submitted"), Type.Literal("queued")]),
	/**
	 * Since 1.2, when the request had attachments. `imagesWithheld` says why images went only as paths:
	 * `model` when the session's model does not accept images, `blocked` when Pi's settings block them.
	 */
	attachments: Type.Optional(
		Type.Object({
			files: Type.Integer({ minimum: 0 }),
			imagesAttached: Type.Integer({ minimum: 0 }),
			imagesWithheld: Type.Union([Type.Literal("none"), Type.Literal("model"), Type.Literal("blocked")]),
		}),
	),
});

/** `requested` is not a confirmed stop; `agent_settled` with `aborted: true` confirms it. */
export const AbortResponse = Type.Object({
	...Envelope,
	status: Type.Union([Type.Literal("requested"), Type.Literal("idle")]),
});

export const ErrorCode = Type.Union([
	Type.Literal("unauthorized"),
	Type.Literal("bad_request"),
	Type.Literal("not_found"),
	Type.Literal("no_session"),
	Type.Literal("too_large"),
	Type.Literal("internal"),
]);

export const ErrorResponse = Type.Object({
	...Envelope,
	error: Type.Object({ code: ErrorCode, message: Type.String() }),
});

// ---- Terminal (since 1.1) ----

/** The longest text one terminal input may type. */
export const TERMINAL_TEXT_MAX_LENGTH = 16_384;

/** Keys the app may press: the toolbar, the D-pad, and Ctrl with one letter. Nothing else reaches the pane. */
export const TerminalKey = Type.Union([
	Type.Literal("enter"),
	Type.Literal("backspace"),
	Type.Literal("esc"),
	Type.Literal("tab"),
	Type.Literal("up"),
	Type.Literal("down"),
	Type.Literal("left"),
	Type.Literal("right"),
	Type.String({ pattern: "^ctrl\\+[a-z]$" }),
]);

/** What the session's terminal pane shows now, with ANSI colors. */
export const TerminalScreenResponse = Type.Object({
	...Envelope,
	screen: Type.String(),
});

/**
 * Text is typed as one paste, then Enter if asked; keys are pressed in order. Since 1.2 text may carry
 * attachments, whose paths the bridge appends to the text; with attachments the text may be empty.
 */
export const TerminalInputRequest = Type.Union([
	Type.Object({
		kind: Type.Literal("text"),
		text: Type.String({ minLength: 1, maxLength: TERMINAL_TEXT_MAX_LENGTH }),
		enter: Type.Boolean(),
		attachments: Type.Optional(Attachments),
	}),
	Type.Object({
		kind: Type.Literal("text"),
		text: Type.String({ maxLength: TERMINAL_TEXT_MAX_LENGTH }),
		enter: Type.Boolean(),
		attachments: Attachments,
	}),
	Type.Object({
		kind: Type.Literal("keys"),
		keys: Type.Array(TerminalKey, { minItems: 1, maxItems: 32 }),
	}),
]);

/** `sent` means the pane received the input, not that a program acted on it. */
export const TerminalInputResponse = Type.Object({
	...Envelope,
	status: Type.Literal("sent"),
});

/** Since 1.3: POST /terminal/focus has no body or target; it focuses the session's own workspace/tab. */
export const TerminalFocusResponse = Type.Object({
	...Envelope,
	status: Type.Literal("focused"),
});
export type TerminalFocusResponse = Static<typeof TerminalFocusResponse>;

// ---- Events ----

const EventBase = { seq: Type.Integer({ minimum: 1 }), at: Type.Number() };

const event = <T extends string, P extends Record<string, TSchema>>(type: T, props: P) =>
	Type.Object({ ...EventBase, type: Type.Literal(type), ...props });

export const EVENT_SCHEMAS = {
	activity: event("activity", { activity: Activity }),
	session_start: event("session_start", { reason: Type.String() }),
	agent_start: event("agent_start", {}),
	agent_end: event("agent_end", { pendingMessages: Type.Boolean() }),
	agent_settled: event("agent_settled", { aborted: Type.Boolean(), pendingMessages: Type.Boolean(), outcome: Type.Optional(RunOutcome) }),
	turn_start: event("turn_start", { turnIndex: Type.Integer({ minimum: 0 }) }),
	message_start: event("message_start", { message: MessageSummary, pendingMessages: Type.Boolean() }),
	message_end: event("message_end", { message: MessageSummary }),
	text_delta: event("text_delta", { delta: Type.String() }),
	tool_start: event("tool_start", { toolCallId: Type.String(), toolName: Type.String() }),
	tool_end: event("tool_end", { toolCallId: Type.String(), toolName: Type.String(), isError: Type.Boolean() }),
	prompt_start: event("prompt_start", { prompt: PendingPrompt }),
	prompt_end: event("prompt_end", { kind: PromptKind }),
	message_submitted: event("message_submitted", {
		queued: Type.Boolean(),
		images: Type.Integer({ minimum: 0 }),
		/** Since 1.2: how many uploads the message referenced. */
		attachments: Type.Optional(Type.Integer({ minimum: 0 })),
	}),
	abort_requested: event("abort_requested", { wasIdle: Type.Boolean() }),
} as const;

type EventSchemas = typeof EVENT_SCHEMAS;
export type BridgeEvent = { [K in keyof EventSchemas]: Static<EventSchemas[K]> }[keyof EventSchemas];
export type BridgeEventType = BridgeEvent["type"];
/** An event without the numbering the event log assigns. */
export type BridgeEventInput = BridgeEvent extends infer E ? (E extends BridgeEvent ? Omit<E, "seq" | "at"> : never) : never;

/** First message of every event stream: where replay starts and whether events were lost. */
export const ReplayHeader = Type.Object({
	...Envelope,
	since: Type.Integer({ minimum: 0 }),
	oldestSeq: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
	gap: Type.Boolean(),
});

// ---- Registry ----

/** What the bridge publishes so a client reached over SSH can find it. */
export const RegistryEntry = Type.Object({
	...Envelope,
	port: Type.Integer({ minimum: 1, maximum: 65535 }),
	token: Type.String({ minLength: 32 }),
	pid: Type.Integer({ minimum: 1 }),
	cwd: Type.String(),
	startedAt: Type.Number(),
});

export type StateResponse = Static<typeof StateResponse>;
export type HistoryResponse = Static<typeof HistoryResponse>;
export type SendMessageRequest = Static<typeof SendMessageRequest>;
export type SendMessageResponse = Static<typeof SendMessageResponse>;
export type AbortResponse = Static<typeof AbortResponse>;
export type ErrorResponse = Static<typeof ErrorResponse>;
export type ErrorCode = Static<typeof ErrorCode>;
export type ReplayHeader = Static<typeof ReplayHeader>;
export type RegistryEntry = Static<typeof RegistryEntry>;
export type PendingPrompt = Static<typeof PendingPrompt>;
export type MessageSummary = Static<typeof MessageSummary>;
export type ImageInput = Static<typeof ImageInput>;
export type UploadName = Static<typeof UploadName>;
export type TerminalKey = Static<typeof TerminalKey>;
export type TerminalScreenResponse = Static<typeof TerminalScreenResponse>;
export type TerminalInputRequest = Static<typeof TerminalInputRequest>;
export type TerminalInputResponse = Static<typeof TerminalInputResponse>;

// ---- Decoders ----

export type Decoded<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export function decodeResponse<S extends TSchema>(schema: S, data: unknown): Decoded<Static<S>> {
	if (Value.Check(schema, data)) return { ok: true, value: data as Static<S> };
	return { ok: false, errors: [...Value.Errors(schema, data)].map((e) => `${e.instancePath || "/"} ${e.message}`) };
}

export const decodeRegistryEntry = (data: unknown) => decodeResponse(RegistryEntry, data);

export type DecodedEvent =
	| { kind: "known"; event: BridgeEvent }
	| { kind: "unknown"; seq: number; type: string }
	| { kind: "invalid" };

export function decodeEvent(data: unknown): DecodedEvent {
	const base = data as { seq?: unknown; at?: unknown; type?: unknown } | null;
	if (!base || typeof base.seq !== "number" || typeof base.at !== "number" || typeof base.type !== "string") return { kind: "invalid" };
	const schema = (EVENT_SCHEMAS as Record<string, TSchema>)[base.type];
	if (!schema) return { kind: "unknown", seq: base.seq, type: base.type };
	return Value.Check(schema, data) ? { kind: "known", event: data as BridgeEvent } : { kind: "invalid" };
}

// ---- Pairing ----
// The computer shows a QR with a pairing offer; the phone answers with its public key.
// Version 1 is a Tailscale offer; version 2 names its network and has no MagicDNS name, so apps that know
// only version 1 ask to be updated instead of asking for MagicDNS.
// Version 3 is the same two offers in a compact binary form, for a smaller QR (see encodeCompactPairingUri).

export const PAIRING_VERSION = 1;
export const ZEROTIER_PAIRING_VERSION = 2;
export const COMPACT_PAIRING_VERSION = 3;
const PAIRING_PREFIX = `${APP_ID}://pair?p=`;

export type PairingNetwork = "tailscale" | "zerotier";

/** What the computer's QR carries over Tailscale. hostKey lets the phone trust the right host without comparing by hand. */
export const PairingOffer = Type.Object({
	v: Type.Literal(PAIRING_VERSION),
	name: Type.String({ minLength: 1, maxLength: 128 }),
	address: Type.String({ minLength: 1, maxLength: 253 }),
	dnsName: Type.Optional(Type.String({ maxLength: 253 })),
	sshPort: Type.Integer({ minimum: 1, maximum: 65535 }),
	user: Type.String({ minLength: 1, maxLength: 128 }),
	hostKey: Type.String({ pattern: "^SHA256:[A-Za-z0-9+/]{43}$" }),
	pairPort: Type.Integer({ minimum: 1, maximum: 65535 }),
	code: Type.String({ pattern: "^[A-Za-z0-9_-]{16,64}$" }),
	expiresAt: Type.Number(),
});

/** An IPv4 literal in dotted-decimal form, without leading zeros. */
const IPV4_PATTERN = "^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$";

/** What the computer's QR carries over ZeroTier: the phone reaches it at its ZeroTier IPv4 address only. */
export const ZeroTierPairingOffer = Type.Object(
	{
		v: Type.Literal(ZEROTIER_PAIRING_VERSION),
		network: Type.Literal("zerotier"),
		name: PairingOffer.properties.name,
		address: Type.String({ pattern: IPV4_PATTERN }),
		sshPort: PairingOffer.properties.sshPort,
		user: PairingOffer.properties.user,
		hostKey: PairingOffer.properties.hostKey,
		pairPort: PairingOffer.properties.pairPort,
		code: PairingOffer.properties.code,
		expiresAt: PairingOffer.properties.expiresAt,
	},
	{ additionalProperties: false },
);

/**
 * One public key on one line, without authorized_keys options, of a type the app may use.
 * Options such as command="…" could otherwise reach the host's authorized_keys.
 */
const PUBLIC_KEY_PATTERN = "^(ecdsa-sha2-nistp(256|384|521)|ssh-ed25519) [A-Za-z0-9+/]+={0,3}( [\\x20-\\x7E]{1,128})?$";

export const PairingRequest = Type.Object({
	code: Type.String({ pattern: "^[A-Za-z0-9_-]{16,64}$" }),
	publicKey: Type.String({ pattern: PUBLIC_KEY_PATTERN, maxLength: 1024 }),
	// No C0 or C1 control characters: the name is shown in the computer's terminal.
	deviceName: Type.String({ pattern: "^[^\\x00-\\x1F\\x7F-\\x9F]{1,64}$" }),
});

export const PairingErrorCode = Type.Union([
	Type.Literal("bad_code"),
	Type.Literal("expired"),
	Type.Literal("closed"),
	Type.Literal("rejected"),
	Type.Literal("bad_request"),
	Type.Literal("internal"),
]);

export const PairingResponse = Type.Union([
	Type.Object({ ok: Type.Literal(true), user: Type.String(), hostKey: Type.String() }),
	Type.Object({ ok: Type.Literal(false), error: PairingErrorCode, message: Type.String() }),
]);

export type PairingOffer = Static<typeof PairingOffer>;
export type ZeroTierPairingOffer = Static<typeof ZeroTierPairingOffer>;
export type NetworkPairingOffer = PairingOffer | ZeroTierPairingOffer;
export type PairingRequest = Static<typeof PairingRequest>;
export type PairingErrorCode = Static<typeof PairingErrorCode>;
export type PairingResponse = Static<typeof PairingResponse>;

export const decodePairingRequest = (data: unknown) => decodeResponse(PairingRequest, data);

export function encodePairingUri(offer: NetworkPairingOffer): string {
	return PAIRING_PREFIX + toBase64Url(new TextEncoder().encode(JSON.stringify(offer)));
}

export type PairingUriResult = { ok: true; value: PairingOffer } | { ok: false; message: string };

export type NetworkPairingUriResult =
	| { ok: true; network: "tailscale"; value: PairingOffer }
	| { ok: true; network: "zerotier"; value: ZeroTierPairingOffer }
	| { ok: false; message: string };

const NEWER_APP = { ok: false as const, message: "This pairing code needs a newer version of the app." };
const DAMAGED = { ok: false as const, message: "This pairing code is damaged. Show a new one on the computer." };

/** Reads a Tailscale or a ZeroTier offer, as version 1, 2 or 3; any other version asks for a newer app. */
export function decodeNetworkPairingUri(uri: string): NetworkPairingUriResult {
	const compact = readCompactPayload(uri);
	if (compact) return compact;
	const payload = readPairingPayload(uri);
	if (!payload.ok) return payload;
	const { data } = payload;
	if (hasVersionOtherThan(data, PAIRING_VERSION, ZEROTIER_PAIRING_VERSION)) return NEWER_APP;
	if (Value.Check(PairingOffer, data)) return { ok: true, network: "tailscale", value: data };
	if (Value.Check(ZeroTierPairingOffer, data)) return { ok: true, network: "zerotier", value: data };
	return DAMAGED;
}

/** Reads only Tailscale offers, for an app that cannot pair over ZeroTier yet: any other version asks for a newer app. */
export function decodePairingUri(uri: string): PairingUriResult {
	const payload = readPairingPayload(uri);
	if (!payload.ok) return payload;
	const { data } = payload;
	if (hasVersionOtherThan(data, PAIRING_VERSION)) return NEWER_APP;
	return Value.Check(PairingOffer, data) ? { ok: true, value: data } : DAMAGED;
}

function readPairingPayload(uri: string): { ok: true; data: unknown } | { ok: false; message: string } {
	if (!uri.startsWith(PAIRING_PREFIX) || uri.length === PAIRING_PREFIX.length) {
		return { ok: false, message: "This QR is not a pairing code for this app." };
	}
	try {
		return { ok: true, data: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fromBase64Url(uri.slice(PAIRING_PREFIX.length)))) };
	} catch {
		return DAMAGED;
	}
}

function hasVersionOtherThan(data: unknown, ...versions: number[]): boolean {
	return typeof data === "object" && data !== null && "v" in data && !versions.includes(data.v as number);
}

// ---- Compact pairing offer (version 3) ----
// The same link, `mars-ram://pair?p=<base64url>`, so the phone's camera still opens the app (the scheme stays
// lower case) and the link route is unchanged; the payload is bytes instead of JSON. All integers are big-endian:
//   0      version (3)
//   1      flags: 1 ZeroTier, 2 MagicDNS name follows, 4 the name's «.ts.net» is left out,
//          8 the name's first label, the computer's name in ASCII lower case, and its dot are left out
//   2-5    IPv4 address
//   6-7    SSH port, 8-9 pair port
//   10-15  expiry, milliseconds since 1970
//   16-47  host key SHA256 fingerprint, 48-63 one-time code
//   then   name, user and, with flag 2, the rest of the MagicDNS name, each as one length byte and UTF-8
// Nothing may follow. A JSON payload starts with «{», so a first byte below 0x20 that is not JSON whitespace
// marks a compact version; versions after 3 ask for a newer app.

const ZEROTIER_FLAG = 1;
const DNS_FLAG = 2;
const TS_NET_FLAG = 4;
const NAME_LABEL_FLAG = 8;
const TS_NET = ".ts.net";
const FINGERPRINT_PREFIX = "SHA256:";
const CODE_BYTES = 16;
const FIXED_BYTES = 64;

/**
 * The offer as a version 3 link, or null when version 3 cannot carry it exactly (a code that is not 16 bytes in
 * canonical base64url, a Tailscale address that is not IPv4, a text over 255 bytes): then show encodePairingUri's.
 */
export function encodeCompactPairingUri(offer: NetworkPairingOffer): string | null {
	const zerotier = "network" in offer && offer.network === "zerotier";
	if (!(zerotier ? Value.Check(ZeroTierPairingOffer, offer) : Value.Check(PairingOffer, offer))) return null;
	if (!new RegExp(IPV4_PATTERN).test(offer.address) || !Number.isSafeInteger(offer.expiresAt) || offer.expiresAt < 0 || offer.expiresAt >= 2 ** 48) return null;
	let hostKey: Uint8Array;
	let code: Uint8Array;
	try {
		hostKey = fromBase64Url(offer.hostKey.slice(FINGERPRINT_PREFIX.length).replace(/\+/g, "-").replace(/\//g, "_"));
		code = fromBase64Url(offer.code);
	} catch {
		return null;
	}
	if (code.length !== CODE_BYTES) return null;

	let flags = zerotier ? ZEROTIER_FLAG : 0;
	let dnsRest = zerotier ? undefined : (offer as PairingOffer).dnsName;
	if (dnsRest !== undefined) {
		flags |= DNS_FLAG;
		if (dnsRest.endsWith(TS_NET) && dnsRest.length > TS_NET.length) {
			flags |= TS_NET_FLAG;
			dnsRest = dnsRest.slice(0, -TS_NET.length);
		}
		const label = nameLabel(offer.name);
		if (label && dnsRest.startsWith(label) && dnsRest.length > label.length) {
			flags |= NAME_LABEL_FLAG;
			dnsRest = dnsRest.slice(label.length);
		}
	}
	const bytes: number[] = [COMPACT_PAIRING_VERSION, flags, ...offer.address.split(".").map(Number)];
	for (const port of [offer.sshPort, offer.pairPort]) bytes.push(port >> 8, port & 0xff);
	for (let shift = 40; shift >= 0; shift -= 8) bytes.push(Math.floor(offer.expiresAt / 2 ** shift) % 256);
	bytes.push(...hostKey, ...code);
	for (const value of dnsRest === undefined ? [offer.name, offer.user] : [offer.name, offer.user, dnsRest]) {
		const utf8 = new TextEncoder().encode(value);
		if (utf8.length > 255) return null;
		bytes.push(utf8.length, ...utf8);
	}
	const uri = PAIRING_PREFIX + toBase64Url(Uint8Array.from(bytes));
	// Exactly or not at all: the phone must read back this very offer.
	const back = decodeNetworkPairingUri(uri);
	return back.ok && sameOffer(back.value, offer) ? uri : null;
}

/** The first MagicDNS label Tailscale makes from an ASCII computer name, with its dot; none for other names. */
function nameLabel(name: string): string | null {
	return /^[\x20-\x7e]+$/.test(name) ? `${name.toLowerCase()}.` : null;
}

function sameOffer(a: NetworkPairingOffer, b: NetworkPairingOffer): boolean {
	const fields = ["v", "network", "name", "address", "dnsName", "sshPort", "user", "hostKey", "pairPort", "code", "expiresAt"] as const;
	return fields.every((field) => (a as Record<string, unknown>)[field] === (b as Record<string, unknown>)[field]);
}

/** null when the URI does not hold a compact payload; then it is read as JSON, as before version 3. */
function readCompactPayload(uri: string): NetworkPairingUriResult | null {
	if (!uri.startsWith(PAIRING_PREFIX)) return null;
	const text = uri.slice(PAIRING_PREFIX.length);
	let bytes: Uint8Array;
	try {
		bytes = fromBase64Url(text);
	} catch {
		return null;
	}
	const version = bytes[0];
	if (version === undefined || version < COMPACT_PAIRING_VERSION || version >= 0x20 || version === 0x09 || version === 0x0a || version === 0x0d) return null;
	if (version !== COMPACT_PAIRING_VERSION) return NEWER_APP;
	// One payload, one spelling: unused bits in the last character must be zero.
	if (toBase64Url(bytes) !== text) return DAMAGED;
	try {
		return readCompactOffer(bytes);
	} catch {
		return DAMAGED;
	}
}

function readCompactOffer(bytes: Uint8Array): NetworkPairingUriResult {
	if (bytes.length < FIXED_BYTES) return DAMAGED;
	const flags = bytes[1]!;
	const zerotier = (flags & ZEROTIER_FLAG) !== 0;
	const hasDns = (flags & DNS_FLAG) !== 0;
	const rebuilds = (flags & (TS_NET_FLAG | NAME_LABEL_FLAG)) !== 0;
	if (flags & ~(ZEROTIER_FLAG | DNS_FLAG | TS_NET_FLAG | NAME_LABEL_FLAG) || (zerotier && hasDns) || (rebuilds && !hasDns)) return DAMAGED;
	const uint = (at: number, length: number) => bytes.subarray(at, at + length).reduce((sum, byte) => sum * 256 + byte, 0);
	const utf8 = new TextDecoder("utf-8", { fatal: true });
	let at = FIXED_BYTES;
	const nextText = (): string => {
		const length = bytes[at];
		if (length === undefined || at + 1 + length > bytes.length) throw new Error("Truncated");
		const value = utf8.decode(bytes.subarray(at + 1, at + 1 + length));
		at += 1 + length;
		return value;
	};
	const name = nextText();
	const user = nextText();
	let dnsName = hasDns ? nextText() : undefined;
	if (at !== bytes.length) return DAMAGED;
	if (dnsName !== undefined && rebuilds) {
		if (dnsName === "") return DAMAGED;
		if (flags & NAME_LABEL_FLAG) {
			const label = nameLabel(name);
			if (!label) return DAMAGED;
			dnsName = label + dnsName;
		}
		if (flags & TS_NET_FLAG) dnsName += TS_NET;
	}
	const common = {
		name,
		address: Array.from(bytes.subarray(2, 6)).join("."),
		sshPort: uint(6, 2),
		user,
		hostKey: FINGERPRINT_PREFIX + toBase64Url(bytes.subarray(16, 48)).replace(/-/g, "+").replace(/_/g, "/"),
		pairPort: uint(8, 2),
		code: toBase64Url(bytes.subarray(48, 64)),
		expiresAt: uint(10, 6),
	};
	if (zerotier) {
		const value = { v: ZEROTIER_PAIRING_VERSION, network: "zerotier", ...common };
		return Value.Check(ZeroTierPairingOffer, value) ? { ok: true, network: "zerotier", value } : DAMAGED;
	}
	const value = { v: PAIRING_VERSION, ...common, ...(dnsName === undefined ? {} : { dnsName }) };
	return Value.Check(PairingOffer, value) ? { ok: true, network: "tailscale", value } : DAMAGED;
}

// Base64url without padding, written out so it behaves the same in Node and React Native.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function toBase64Url(bytes: Uint8Array): string {
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const chunk = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
		const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
		for (let j = 0; j < chars; j++) out += ALPHABET[(chunk >> (18 - 6 * j)) & 63];
	}
	return out;
}

function fromBase64Url(text: string): Uint8Array {
	if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new Error("Invalid base64url");
	const bytes: number[] = [];
	let buffer = 0;
	let bits = 0;
	for (const char of text) {
		buffer = (buffer << 6) | ALPHABET.indexOf(char);
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			bytes.push((buffer >> bits) & 0xff);
		}
	}
	return Uint8Array.from(bytes);
}
