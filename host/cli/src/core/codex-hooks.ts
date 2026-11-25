// Codex hooks, both halves: what each hook event means for the session (bridge side), and which hook entries
// `mars-ram install` owns in Codex's hooks.json (install side), plus reading Codex's hook trust from config.toml.
// Pure: no files, processes or HTTP. Facts from https://learn.chatgpt.com/docs/hooks and Codex's source
// (codex-rs/hooks: engine/command_runner.rs, engine/discovery.rs, events/common.rs; codex-rs/config/src/hook_config.rs,
// fingerprint.rs; codex-rs/protocol/src/hooks.rs).
import { createHash } from "node:crypto";
import type { ApprovalKind } from "@workspace/protocol";
import type { AgentSession, ConversationItem, Timers } from "./agent-session.ts";
import {
	type HookAnswer,
	hookDecision,
	type HookCommand,
	type HookConfigSpec,
	type HookHandler,
	isOwnedBy,
	NODE_FLAG,
	oneLine,
	type OwnedHook,
	type TranscriptState,
	ownedPositions,
	ownedStatus,
	PERMISSION_HOOK_TIMEOUT_SECONDS,
	withoutOwned,
	withOwned,
} from "./agent-hooks.ts";

export const CODEX_HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "Stop", "Interrupt", "SessionEnd"] as const;
export type CodexHookEvent = (typeof CODEX_HOOK_EVENTS)[number];
export const isCodexHookEvent = (value: unknown): value is CodexHookEvent => CODEX_HOOK_EVENTS.includes(value as CodexHookEvent);

/**
 * Seconds Codex lets each hook run. Codex clamps SessionEnd and Interrupt to 1–3 s, so those hooks only post to
 * the local bridge with a short timeout. SessionStart may look up the Codex process on Windows (up to 3 s) and waits
 * for the new bridge (up to 8 s); past its timeout Codex kills the hook's process tree, the new bridge included.
 * PermissionRequest waits for the phone; the bridge gives up well before.
 */
export const CODEX_HOOK_TIMEOUT_SECONDS: Record<CodexHookEvent, number> = {
	SessionStart: 20,
	UserPromptSubmit: 5,
	PermissionRequest: PERMISSION_HOOK_TIMEOUT_SECONDS,
	Stop: 5,
	Interrupt: 3,
	SessionEnd: 3,
};

/** Longest prompt or reply text the hook forwards for the history fallback. */
export const MAX_HOOK_TEXT = 64 * 1024;

// ---- Bridge side ----

type Payload = Record<string, unknown>;

/**
 * History from the hooks alone: the UserPromptSubmit prompt and the Stop `last_assistant_message`. Used when Codex
 * gives no rollout path (they are recorded at once), or when the rollout's format is not understood (they are
 * recorded shortly after the turn, if the rollout still produced nothing by then). Never both for one turn.
 */
export class HookHistory {
	private prompt: string | undefined;
	private count = 0;
	private readonly session: AgentSession;
	private readonly transcript: TranscriptState;
	private readonly timers: Timers;
	private readonly delayMs: number;

	constructor(session: AgentSession, transcript: TranscriptState, timers: Timers, delayMs = 2000) {
		this.session = session;
		this.transcript = transcript;
		this.timers = timers;
		this.delayMs = delayMs;
	}

	submitted(prompt: unknown): void {
		const text = typeof prompt === "string" ? prompt.slice(0, MAX_HOOK_TEXT) : "";
		if (!this.transcript.present) {
			if (text.trim()) this.session.conversation([this.item("user", text)], true);
			return;
		}
		this.prompt = text;
	}

	/** The turn ended (`reply` is the last assistant message, absent when interrupted). */
	ended(reply: unknown): void {
		const text = typeof reply === "string" ? reply.slice(0, MAX_HOOK_TEXT) : "";
		const prompt = this.prompt;
		this.prompt = undefined;
		if (!this.transcript.present) {
			if (text.trim()) this.session.conversation([this.item("assistant", text)], true);
			return;
		}
		if (this.transcript.recognized() || (!prompt?.trim() && !text.trim())) return;
		this.timers.set(this.delayMs, () => {
			try { this.transcript.poll(); } catch { /* The tail never throws; be safe anyway. */ }
			if (this.transcript.recognized()) return;
			const items: ConversationItem[] = [];
			if (prompt?.trim()) items.push(this.item("user", prompt));
			if (text.trim()) items.push(this.item("assistant", text));
			this.session.conversation(items, true);
		});
	}

	private item(role: "user" | "assistant", text: string): ConversationItem {
		const id = `hook-${++this.count}-${role}`;
		return role === "user" ? { type: "user", id, text, images: 0 } : { type: "assistant", id, text, toolCalls: 0 };
	}
}

/** What one forwarded hook does to the session. Only PermissionRequest waits, and only it may answer Codex. */
export async function handleCodexHook(session: AgentSession, history: HookHistory, event: CodexHookEvent, payload: Payload, closed: AbortSignal, end: () => void): Promise<HookAnswer> {
	switch (event) {
		case "SessionStart":
			session.started(typeof payload.source === "string" && /^[a-z_-]{1,20}$/.test(payload.source) ? payload.source : "startup");
			return {};
		case "UserPromptSubmit":
			history.submitted(payload.prompt);
			session.promptSubmitted();
			return {};
		case "Stop":
			history.ended(payload.last_assistant_message);
			session.stopped();
			return {};
		case "Interrupt":
			// Codex asks this hook to finish within 1–3 s: everything here is synchronous.
			history.ended(undefined);
			// Hook evidence that the turn stopped: unlike a transcript line read late, it also ends a terminal approval fallback.
			session.interrupted();
			return {};
		case "SessionEnd":
			end();
			return {};
		case "PermissionRequest": {
			const decision = await session.requestApproval(describeCodexPermission(payload), closed);
			return decision === null ? {} : { decision: hookDecision(decision) };
		}
	}
}

const MAX_DETAIL_SOURCE = 4000;
/** A detail cut here is marked, so the app says it is not the whole text (boundApproval marks its own cut). */
const cut = (source: string): { detailTruncated?: true } => (source.length > MAX_DETAIL_SOURCE ? { detailTruncated: true } : {});
/** Codex's shell tool (reported as Bash), its other shell spellings, and apply_patch: their input is a command. */
const COMMAND_TOOLS = /^(?:bash|shell|shell_command|exec_command|local_shell|unified_exec|apply_patch)$/i;

/** The approval card for a Codex permission request: shell and apply_patch are commands, anything else a permission. */
export function describeCodexPermission(payload: Payload): { kind: ApprovalKind; title: string; detail: string; detailTruncated?: true; source: { toolName: string; args: unknown } } {
	const toolName = typeof payload.tool_name === "string" && payload.tool_name ? oneLine(payload.tool_name).slice(0, 80) : "tool";
	const input = payload.tool_input && typeof payload.tool_input === "object" && !Array.isArray(payload.tool_input) ? (payload.tool_input as Record<string, unknown>) : {};
	const command = [input.command, input.patch, input.input].find((value): value is string => typeof value === "string" && !!value.trim());
	if (COMMAND_TOOLS.test(toolName) && command !== undefined) {
		const description = typeof input.description === "string" && input.description.trim() ? `\n\n${input.description.trim()}` : "";
		return { kind: "command", title: `${toolName}: ${oneLine(command)}`, detail: `${command.slice(0, MAX_DETAIL_SOURCE)}${description}`, ...cut(command), source: { toolName, args: {} } };
	}
	const summary = ["file_path", "path", "url", "query", "command", "description"].map((key) => input[key]).find((value): value is string => typeof value === "string" && !!value.trim());
	let json: string;
	try { json = JSON.stringify(input, null, 2); } catch { json = ""; }
	return { kind: "permission", title: summary ? `${toolName}: ${oneLine(summary)}` : toolName, detail: json.slice(0, MAX_DETAIL_SOURCE), ...cut(json), source: { toolName, args: {} } };
}

// ---- Install side ----

/**
 * The command line each hook runs. Codex runs a hook command through a shell: `$SHELL -lc <command>` on Linux and
 * macOS (a login shell, which may be fish), and `%COMSPEC% /C "<command>"` (cmd.exe) on Windows, where the
 * `commandWindows` override replaces `command`. The shell on Windows is not documented; this follows Codex's source
 * (codex-rs/hooks/src/engine/command_runner.rs, default shell). A hook shell configured to be PowerShell would not
 * run this form.
 *
 * POSIX: both paths single-quoted. Paths with a quote or a backslash are refused, because fish reads `\` and `'`
 * inside single quotes differently from sh, bash and zsh.
 * Windows: both paths double-quoted for cmd.exe, which Codex calls with the whole line in one more pair of quotes
 * (cmd strips exactly that outer pair). Paths with `"`, `%` or `!` are refused: cmd expands `%…%` (and `!…!` with
 * delayed expansion) even inside quotes. `command` holds the same Windows line so a Codex that predates
 * `commandWindows` still runs it.
 */
export function codexHookHandler({ node, main, platform }: HookCommand, event: CodexHookEvent): HookHandler {
	const timeout = CODEX_HOOK_TIMEOUT_SECONDS[event];
	if (platform === "win32") {
		for (const path of [node, main]) {
			if (!/^(?:[A-Za-z]:\\|\\\\)/.test(path) || /["%!\x00-\x1F\x7F]/.test(path) || path.endsWith("\\")) throw new Error(`Codex hooks cannot run from ${JSON.stringify(path)}: the path must be absolute and free of ", % and ! (cmd.exe would change them).`);
		}
		const line = `"${node}" ${NODE_FLAG} "${main}" hook codex ${event}`;
		return { type: "command", command: line, commandWindows: line, timeout };
	}
	for (const path of [node, main]) {
		if (!path.startsWith("/") || /['\\\x00-\x1F\x7F]/.test(path)) throw new Error(`Codex hooks cannot run from ${JSON.stringify(path)}: the path must be absolute and free of quotes, backslashes and control characters.`);
	}
	return { type: "command", command: `'${node}' ${NODE_FLAG} '${main}' hook codex ${event}`, timeout };
}

export const CODEX_HOOK_SPEC: HookConfigSpec<CodexHookEvent> = { agent: "codex", events: CODEX_HOOK_EVENTS, file: "hooks.json", handler: codexHookHandler };

export function codexOwnedHooks(command: HookCommand): OwnedHook<CodexHookEvent>[] {
	return CODEX_HOOK_EVENTS.map((event) => ({ event, handler: codexHookHandler(command, event) }));
}

export const isCodexOwnedHandler = (handler: unknown, known: readonly HookHandler[]) => isOwnedBy(handler, known);

/** hooks.json with exactly the desired owned hooks; the top-level `description` and every foreign hook are kept. */
export const withCodexHooks = (config: Record<string, unknown>, desired: OwnedHook<CodexHookEvent>[], recorded: readonly HookHandler[] = []) => withOwned(CODEX_HOOK_SPEC, config, desired, recorded);
export const withoutCodexHooks = (config: Record<string, unknown>, known: readonly HookHandler[]) => withoutOwned(CODEX_HOOK_SPEC, config, known);
export const codexHookStatus = (config: Record<string, unknown>, command: HookCommand, recorded: readonly HookHandler[] = []) => ownedStatus(CODEX_HOOK_SPEC, config, command, recorded);
/** The events with an owned handler (one of `known`), whatever command it runs. */
export const codexRegistered = (config: Record<string, unknown>, known: readonly HookHandler[]): CodexHookEvent[] => {
	const positions = ownedPositions(CODEX_HOOK_SPEC, config, known);
	return CODEX_HOOK_EVENTS.filter((event) => positions.some((position) => position.event === event));
};

// ---- Trust (read only) ----

/**
 * Codex's own event keys in its hook state (`hook_event_key_label`): the trust of a user hook is stored in
 * config.toml as `[hooks.state."<hooks.json path>:<event key>:<group index>:<handler index>"]` with `trusted_hash`
 * (and `enabled = false` when turned off).
 */
const EVENT_KEYS: Record<CodexHookEvent, string> = {
	SessionStart: "session_start",
	UserPromptSubmit: "user_prompt_submit",
	PermissionRequest: "permission_request",
	Stop: "stop",
	Interrupt: "interrupt",
	SessionEnd: "session_end",
};

/** Events whose group matcher Codex keeps (`matcher_pattern_for_event`); for the others it is dropped. */
const MATCHER_EVENTS: ReadonlySet<CodexHookEvent> = new Set(["SessionStart", "PermissionRequest", "SessionEnd"]);
/** Handler fields this hash models; a handler with any other field gets no hash rather than a wrong one. */
const HASHED_FIELDS = new Set(["type", "command", "commandWindows", "timeout", "async"]);

/**
 * The hash Codex compares with a hook's `trusted_hash` (codex-rs/hooks/src/engine/discovery.rs `hook_hash`, and
 * codex-rs/config/src/fingerprint.rs `version_for_toml`): SHA-256 of the JSON, keys sorted and no spaces, of
 * `{ event_name, matcher?, hooks: [handler] }`, where the handler is normalized as Codex does it: the command it runs
 * on this platform (commandWindows on Windows), commandWindows dropped, the timeout made explicit (SessionEnd and
 * Interrupt: default 1, at most 3; others: default 600), and `async`. Undefined when the handler has a field this does
 * not model, or a value Codex would refuse.
 */
export function codexHookHash(event: CodexHookEvent, matcher: unknown, handler: unknown, platform: NodeJS.Platform): string | undefined {
	if (!handler || typeof handler !== "object" || Array.isArray(handler)) return undefined;
	const fields = handler as Record<string, unknown>;
	if (Object.keys(fields).some((key) => !HASHED_FIELDS.has(key))) return undefined;
	const { type, command, commandWindows, timeout, async: runsAsync = false } = fields;
	if (type !== "command" || typeof command !== "string" || typeof runsAsync !== "boolean") return undefined;
	if (commandWindows !== undefined && commandWindows !== null && typeof commandWindows !== "string") return undefined;
	if (matcher !== undefined && matcher !== null && typeof matcher !== "string") return undefined;
	if (timeout !== undefined && timeout !== null && !(Number.isSafeInteger(timeout) && (timeout as number) >= 0)) return undefined;
	const short = event === "SessionEnd" || event === "Interrupt";
	const given = typeof timeout === "number" ? timeout : undefined;
	const seconds = short ? Math.min(Math.max(given ?? 1, 1), 3) : Math.max(given ?? 600, 1);
	const runs = platform === "win32" && typeof commandWindows === "string" ? commandWindows : command;
	// Keys in sorted order, as serde_json's sort_all_objects leaves them.
	const identity = {
		event_name: EVENT_KEYS[event],
		hooks: [{ async: runsAsync, command: runs, timeout: seconds, type: "command" }],
		...(MATCHER_EVENTS.has(event) && typeof matcher === "string" ? { matcher } : {}),
	};
	return `sha256:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}

/** `stale`: Codex recorded trust for this hook, but for another version of it, so Codex skips it until re-trusted. */
export type HookTrust = "trusted" | "stale" | "untrusted" | "disabled";
export type CodexTrust = { known: true; events: Record<string, HookTrust> } | { known: false };

/**
 * The trust Codex recorded for each owned hook, from config.toml's text. `known: false` when config.toml is absent
 * or unreadable, or when no owned hook is registered; a hook whose state is missing is untrusted (Codex skips it),
 * and one whose `trusted_hash` differs from the hash Codex computes for it now is stale.
 */
export function codexHookTrust(hooksConfig: Record<string, unknown>, hooksPath: string, configToml: string | undefined, platform: NodeJS.Platform, owned: readonly HookHandler[]): CodexTrust {
	const positions = ownedPositions(CODEX_HOOK_SPEC, hooksConfig, owned);
	if (!positions.length || configToml === undefined) return { known: false };
	const states = hookStates(configToml);
	if (!states) return { known: false };
	const normalize = (key: string) => (platform === "win32" ? key.replaceAll("/", "\\").toLowerCase() : key);
	const byKey = new Map([...states].map(([key, state]) => [normalize(key), state]));
	const hooks = hooksConfig.hooks as Record<string, unknown[]>;
	const events: Record<string, HookTrust> = {};
	for (const position of positions) {
		const state = byKey.get(normalize(`${hooksPath}:${EVENT_KEYS[position.event]}:${position.group}:${position.handler}`));
		const group = hooks[position.event]![position.group] as { matcher?: unknown };
		const hash = state?.trustedHash ? codexHookHash(position.event, group.matcher, position.value, platform) : undefined;
		const trust: HookTrust = state?.enabled === false ? "disabled" : !state?.trustedHash ? "untrusted" : hash !== undefined && hash !== state.trustedHash ? "stale" : "trusted";
		// Several owned handlers for one event: the worst one counts.
		const order: HookTrust[] = ["trusted", "stale", "untrusted", "disabled"];
		if (!events[position.event] || order.indexOf(trust) > order.indexOf(events[position.event]!)) events[position.event] = trust;
	}
	return { known: true, events };
}

type HookState = { trustedHash?: string; enabled?: boolean };

/**
 * The `hooks.state` entries of a config.toml, read tolerantly: `[hooks.state."<key>"]` tables, and inline tables
 * under `[hooks.state]` or `[hooks]` (`state."<key>" = { … }`). Undefined when the text does not look like TOML.
 */
export function hookStates(toml: string): Map<string, HookState> | undefined {
	const states = new Map<string, HookState>();
	let table: string[] | undefined = [];
	const assign = (key: string, values: string) => {
		const state = states.get(key) ?? {};
		const hash = /(?:^|[\s,{])trusted_hash\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/.exec(values);
		if (hash) state.trustedHash = unquote(hash[1]!);
		const enabled = /(?:^|[\s,{])enabled\s*=\s*(true|false)\b/.exec(values);
		if (enabled) state.enabled = enabled[1] === "true";
		states.set(key, state);
	};
	for (const raw of toml.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		if (line.startsWith("[")) {
			const header = /^\[\s*([^\[\]]+?)\s*\]\s*(?:#.*)?$/.exec(line);
			table = header ? dottedKey(header[1]!) : undefined;
			continue;
		}
		if (!table) continue;
		const pair = /^((?:"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)(?:\s*\.\s*(?:"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+))*)\s*=\s*(.*)$/.exec(line);
		if (!pair) continue;
		const key = dottedKey(pair[1]!);
		if (!key) continue;
		const path = [...table, ...key];
		if (path.length === 4 && path[0] === "hooks" && path[1] === "state" && /^(?:trusted_hash|enabled)$/.test(path[3]!)) assign(path[2]!, `${path[3]} = ${pair[2]}`);
		else if (path.length === 3 && path[0] === "hooks" && path[1] === "state" && pair[2]!.trim().startsWith("{")) assign(path[2]!, pair[2]!);
	}
	return states;
}

/** `a."b c".d` → ["a", "b c", "d"]; undefined for something else. */
function dottedKey(text: string): string[] | undefined {
	const parts: string[] = [];
	const part = /\s*("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)\s*(\.|$)/y;
	let at = 0;
	while (at < text.length) {
		part.lastIndex = at;
		const match = part.exec(text);
		if (!match) return undefined;
		parts.push(unquote(match[1]!));
		at = part.lastIndex;
		if (match[2] === "") break;
	}
	return parts.length ? parts : undefined;
}

function unquote(text: string): string {
	if (text.startsWith("'")) return text.slice(1, -1);
	if (!text.startsWith("\"")) return text;
	return text.slice(1, -1).replace(/\\(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|.)/g, (_, escape: string) => {
		if (escape.length > 1) return String.fromCodePoint(Number.parseInt(escape.slice(1), 16));
		return ({ b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", "\"": "\"", "\\": "\\" } as Record<string, string>)[escape] ?? escape;
	});
}
