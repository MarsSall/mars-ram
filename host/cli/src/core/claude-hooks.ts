// Claude Code hooks, both halves: what each hook event means for the session (bridge side), and which hook
// entries `mars-ram install` owns in Claude Code's settings.json (install side). Pure: no files, processes or HTTP.
import type { ApprovalKind } from "@workspace/protocol";
import type { AgentSession } from "./agent-session.ts";
import {
	DEFAULT_APPROVAL_TIMEOUT_SECONDS,
	type HookAnswer,
	hookDecision,
	type HookCommand,
	type HookConfigSpec,
	type HookHandler,
	isOwnedBy,
	MAX_APPROVAL_TIMEOUT_SECONDS,
	MIN_APPROVAL_TIMEOUT_SECONDS,
	NODE_FLAG,
	oneLine,
	type OwnedHook as AgentOwnedHook,
	ownedStatus,
	PERMISSION_HOOK_TIMEOUT_SECONDS,
	permissionOutput,
	validSessionId,
	withoutOwned,
	withOwned,
} from "./agent-hooks.ts";

export const CLAUDE_HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop", "Notification", "SessionEnd", "PermissionRequest"] as const;
export type ClaudeHookEvent = (typeof CLAUDE_HOOK_EVENTS)[number];
export const isClaudeHookEvent = (value: unknown): value is ClaudeHookEvent => CLAUDE_HOOK_EVENTS.includes(value as ClaudeHookEvent);

/**
 * Seconds Claude Code lets each hook run. Every hook but PermissionRequest answers at once (the bridge is local, or
 * absent); PermissionRequest waits for the phone, and the bridge gives up well before this limit.
 */
export const HOOK_TIMEOUT_SECONDS: Record<ClaudeHookEvent, number> = {
	SessionStart: 10,
	UserPromptSubmit: 5,
	Stop: 5,
	Notification: 5,
	SessionEnd: 5,
	PermissionRequest: PERMISSION_HOOK_TIMEOUT_SECONDS,
};
export { DEFAULT_APPROVAL_TIMEOUT_SECONDS, MAX_APPROVAL_TIMEOUT_SECONDS, MIN_APPROVAL_TIMEOUT_SECONDS, permissionOutput, validSessionId };

// ---- Bridge side ----

export type { HookAnswer };
type Payload = Record<string, unknown>;

/** What one forwarded hook does to the session. Only PermissionRequest waits, and only it may answer Claude Code. */
export async function handleClaudeHook(session: AgentSession, event: ClaudeHookEvent, payload: Payload, closed: AbortSignal, end: () => void): Promise<HookAnswer> {
	switch (event) {
		case "SessionStart":
			session.started(typeof payload.source === "string" && /^[a-z_-]{1,20}$/.test(payload.source) ? payload.source : "startup");
			return {};
		case "UserPromptSubmit":
			session.promptSubmitted();
			return {};
		case "Stop":
			session.stopped();
			return {};
		case "Notification": {
			const kind = payload.notification_type === "permission_prompt" ? "confirm" : payload.notification_type === "elicitation_dialog" ? "input" : undefined;
			if (kind) session.notified(kind, typeof payload.message === "string" ? oneLine(payload.message).slice(0, 200) : "");
			return {};
		}
		case "SessionEnd":
			end();
			return {};
		case "PermissionRequest": {
			const decision = await session.requestApproval(describePermission(payload), closed);
			return decision === null ? {} : { decision: hookDecision(decision) };
		}
	}
}

const MAX_DETAIL_SOURCE = 4000;
/** A detail cut here is marked, so the app says it is not the whole text (boundApproval marks its own cut). */
const cut = (source: string): { detailTruncated?: true } => (source.length > MAX_DETAIL_SOURCE ? { detailTruncated: true } : {});

/** The approval card for a permission request: Bash is a command, anything else a permission for a tool. */
export function describePermission(payload: Payload): { kind: ApprovalKind; title: string; detail: string; detailTruncated?: true; source: { toolName: string; args: unknown } } {
	const toolName = typeof payload.tool_name === "string" && payload.tool_name ? oneLine(payload.tool_name).slice(0, 80) : "tool";
	const input = payload.tool_input && typeof payload.tool_input === "object" && !Array.isArray(payload.tool_input) ? (payload.tool_input as Record<string, unknown>) : {};
	if (toolName === "Bash" && typeof input.command === "string") {
		const description = typeof input.description === "string" && input.description.trim() ? `\n\n${input.description.trim()}` : "";
		return { kind: "command", title: `Bash: ${oneLine(input.command)}`, detail: `${input.command.slice(0, MAX_DETAIL_SOURCE)}${description}`, ...cut(input.command), source: { toolName, args: {} } };
	}
	const summary = ["file_path", "notebook_path", "path", "url", "pattern", "query", "command", "prompt"].map((key) => input[key]).find((value): value is string => typeof value === "string" && !!value.trim());
	let json: string;
	try { json = JSON.stringify(input, null, 2); } catch { json = ""; }
	return { kind: "permission", title: summary ? `${toolName}: ${oneLine(summary)}` : toolName, detail: json.slice(0, MAX_DETAIL_SOURCE), ...cut(json), source: { toolName, args: {} } };
}

// ---- Install side ----

export type { HookCommand, HookHandler } from "./agent-hooks.ts";
export type OwnedHook = AgentOwnedHook<ClaudeHookEvent>;

/**
 * The hook entries install writes. Windows uses Claude Code's exec form (`command` is the real node.exe, `args` its
 * arguments, no shell), because a shell-form command there runs through Git Bash or PowerShell, which quote paths
 * differently. Elsewhere it is a POSIX shell command with every path single-quoted.
 */
export function ownedHooks(command: HookCommand): OwnedHook[] {
	return CLAUDE_HOOK_EVENTS.map((event) => ({ event, handler: hookHandler(command, event) }));
}

export function hookHandler({ node, main, platform }: HookCommand, event: ClaudeHookEvent): HookHandler {
	if (/[\r\n\0]/.test(node + main)) throw new Error("Invalid hook command path.");
	const timeout = HOOK_TIMEOUT_SECONDS[event];
	if (platform === "win32") return { type: "command", command: node, args: [NODE_FLAG, main, "hook", "claude", event], timeout };
	const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
	return { type: "command", command: `${quote(node)} ${NODE_FLAG} ${quote(main)} hook claude ${event}`, timeout };
}

export const CLAUDE_HOOK_SPEC: HookConfigSpec<ClaudeHookEvent> = { agent: "claude", events: CLAUDE_HOOK_EVENTS, file: "settings.json", handler: hookHandler };

/** A hook handler install wrote: exactly one of `known` (the recorded handlers and the ones install generates). */
export function isOwnedHandler(handler: unknown, known: readonly HookHandler[]): boolean {
	return isOwnedBy(handler, known);
}

/**
 * Settings with exactly the desired owned hooks: every other key, event, group and handler is kept as it was, in
 * order. An owned group is replaced where it was; a new one is appended. `changed` is false when nothing differs.
 */
export function withOwnedHooks(settings: Record<string, unknown>, desired: OwnedHook[], recorded: readonly HookHandler[] = []): { settings: Record<string, unknown>; changed: boolean } {
	return withOwned(CLAUDE_HOOK_SPEC, settings, desired, recorded);
}

/**
 * Settings without the owned hooks (`known`: the recorded and the generated handlers); an event (or the whole
 * "hooks" object) left empty by the removal is dropped.
 */
export function withoutOwnedHooks(settings: Record<string, unknown>, known: readonly HookHandler[]): { settings: Record<string, unknown>; changed: boolean } {
	return withoutOwned(CLAUDE_HOOK_SPEC, settings, known);
}

/** Which events have an owned handler, and whether every owned handler matches the current command exactly. */
export function ownedHookStatus(settings: Record<string, unknown>, command: HookCommand, recorded: readonly HookHandler[] = []): { registered: ClaudeHookEvent[]; current: boolean } {
	return ownedStatus(CLAUDE_HOOK_SPEC, settings, command, recorded);
}
