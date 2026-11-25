// What every hook-driven agent (Claude Code, Codex) shares: the PermissionRequest answer, approval timeouts, session
// ids, and the hook entries `mars-ram install` owns in the agent's JSON hooks config. Both agents use the same
// {"hooks":{"<Event>":[{matcher?, hooks:[{type:"command", command, timeout, …}]}]}} shape. Pure: no files or processes.
import { APP_ID, type ApprovalDecision } from "@workspace/protocol";

/** Seconds the agent lets the PermissionRequest hook wait for the phone; the bridge gives up well before. */
export const PERMISSION_HOOK_TIMEOUT_SECONDS = 600;
/** How long an approval waits for the phone by default, below the PermissionRequest hook timeout. */
export const DEFAULT_APPROVAL_TIMEOUT_SECONDS = 300;
export const MAX_APPROVAL_TIMEOUT_SECONDS = PERMISSION_HOOK_TIMEOUT_SECONDS - 60;
export const MIN_APPROVAL_TIMEOUT_SECONDS = 10;

/** A session id as it may appear in a file name: both agents use UUIDs. */
export const validSessionId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9-]{1,100}$/.test(value);

/** The phone's answer to a permission request, as the bridge hands it to the hook process: nothing else. */
export type HookDecision = { behavior: "allow" | "deny"; message?: string };
/** Longest deny message the hook process accepts from the bridge. */
export const MAX_DECISION_MESSAGE = 200;

/** What one forwarded hook answers; only PermissionRequest ever carries a decision for the agent. */
export type HookAnswer = { decision?: HookDecision };

export function hookDecision(decision: ApprovalDecision): HookDecision {
	return decision === "accept" || decision === "acceptForSession" ? { behavior: "allow" } : { behavior: "deny", message: `Declined from the ${APP_ID} app.` };
}

/**
 * The decision in a bridge's answer, read strictly: `behavior` allow or deny and an optional short `message` string.
 * Any other key is dropped; anything else is no decision.
 */
export function readHookDecision(value: unknown): HookDecision | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const { behavior, message } = value as { behavior?: unknown; message?: unknown };
	if (behavior !== "allow" && behavior !== "deny") return undefined;
	if (message === undefined) return { behavior };
	if (typeof message !== "string" || message.length > MAX_DECISION_MESSAGE) return undefined;
	return { behavior, message };
}

/**
 * What the PermissionRequest hook prints, built here from the decision alone. Claude Code and Codex read the same
 * shape; Codex fails closed on updatedInput, updatedPermissions or interrupt, so they are never written.
 */
export function permissionOutput(decision: ApprovalDecision | HookDecision): unknown {
	const { behavior, message } = typeof decision === "string" ? hookDecision(decision) : decision;
	return {
		hookSpecificOutput: {
			hookEventName: "PermissionRequest",
			decision: message === undefined ? { behavior } : { behavior, message },
		},
	};
}

/** What a bridge knows about the agent's transcript file. */
export type TranscriptState = {
	/** A transcript path was given and is being read. */
	present: boolean;
	/** The transcript has produced at least one user or assistant message: its format is understood. */
	recognized(): boolean;
	/** Reads whatever was appended since the last poll. */
	poll(): void;
};

export const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

// ---- Owned entries in the agent's hooks config ----

/** One handler as written to the config. `args` is Claude Code's exec form; `commandWindows` is Codex's override. */
export type HookHandler = { type: "command"; command: string; args?: string[]; commandWindows?: string; timeout: number };
export type OwnedHook<E extends string = string> = { event: E; handler: HookHandler };
export type HookCommand = { node: string; main: string; platform: NodeJS.Platform };

/** Node flag that keeps the hook's stderr free of type-stripping warnings. */
export const NODE_FLAG = "--disable-warning=ExperimentalWarning";

export type HookConfigSpec<E extends string> = {
	/** The word after `hook` in the command line: `claude` or `codex`. */
	agent: string;
	events: readonly E[];
	/** The config file's name, for error messages. */
	file: string;
	handler(command: HookCommand, event: E): HookHandler;
};

/**
 * A hook handler install wrote: exactly one of `owned`, the handlers the ownership record lists plus the ones install
 * generates now. Nothing is inferred from the command's text, so a user's own wrapper around the same invocation
 * (`wrapper … main.ts hook claude Stop`) is never taken for ours.
 */
export function isOwnedBy(handler: unknown, owned: readonly HookHandler[]): boolean {
	if (!handler || typeof handler !== "object" || Array.isArray(handler)) return false;
	const { type, command } = handler as { type?: unknown; command?: unknown };
	if (type !== "command" || typeof command !== "string") return false;
	return owned.some((entry) => sameHandler(entry, handler));
}

/** Every handler install would write for `command`: what counts as ours even without an ownership record. */
export function generatedHandlers<E extends string>(spec: HookConfigSpec<E>, command: HookCommand): HookHandler[] {
	return spec.events.map((event) => spec.handler(command, event));
}

/** The whole handler must match: one with our command but the user's own timeout or fields is the user's. */
export function sameHandler(a: HookHandler, b: unknown): boolean {
	return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
	return JSON.stringify(value ?? null);
}

type Config = Record<string, unknown>;
type Group = Record<string, unknown> & { hooks?: unknown };

/** A config the agent would not read as hooks is refused rather than rewritten. */
function hooksOf(spec: HookConfigSpec<string>, config: Config): Record<string, unknown> | undefined {
	const hooks = config.hooks;
	if (hooks === undefined) return undefined;
	if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) throw new Error(`${spec.file} has a "hooks" value that is not an object; fix it by hand, then run install again.`);
	for (const [event, groups] of Object.entries(hooks)) {
		if (!Array.isArray(groups)) throw new Error(`${spec.file} has hooks for ${event} that are not a list; fix it by hand, then run install again.`);
	}
	return hooks as Record<string, unknown>;
}

/** Removes the owned handlers of one event's groups; a group left without handlers by that removal is dropped. */
function stripGroups(groups: unknown[], owned: (handler: unknown) => boolean): { groups: unknown[]; firstOwned: number; removed: boolean } {
	const kept: unknown[] = [];
	let firstOwned = -1;
	let removed = false;
	for (const group of groups) {
		const handlers = group && typeof group === "object" && Array.isArray((group as Group).hooks) ? ((group as Group).hooks as unknown[]) : undefined;
		if (!handlers || !handlers.some(owned)) { kept.push(group); continue; }
		removed = true;
		const others = handlers.filter((handler) => !owned(handler));
		if (others.length) kept.push({ ...(group as Group), hooks: others });
		else if (firstOwned === -1) firstOwned = kept.length;
	}
	return { groups: kept, firstOwned, removed };
}

/**
 * A config with exactly the desired owned hooks: every other key, event, group and handler is kept as it was, in
 * order. An owned group is replaced where it was; a new one is appended. `changed` is false when nothing differs.
 */
export function withOwned(spec: HookConfigSpec<string>, config: Config, desired: OwnedHook[], recorded: readonly HookHandler[] = []): { settings: Config; changed: boolean } {
	const known = [...recorded, ...desired.map((hook) => hook.handler)];
	const owned = (handler: unknown) => isOwnedBy(handler, known);
	const hooks: Record<string, unknown> = { ...(hooksOf(spec, config) ?? {}) };
	for (const [event, groups] of Object.entries(hooks)) {
		if (desired.some((hook) => hook.event === event)) continue;
		const stripped = stripGroups(groups as unknown[], owned);
		if (!stripped.removed) continue;
		if (stripped.groups.length) hooks[event] = stripped.groups;
		else delete hooks[event];
	}
	for (const event of [...new Set(desired.map((hook) => hook.event))]) {
		const stripped = stripGroups(Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [], owned);
		const group = { ...(event === "PermissionRequest" ? { matcher: "*" } : {}), hooks: desired.filter((hook) => hook.event === event).map((hook) => hook.handler) };
		const groups = [...stripped.groups];
		groups.splice(stripped.firstOwned === -1 ? groups.length : stripped.firstOwned, 0, group);
		hooks[event] = groups;
	}
	const next = { ...config, hooks };
	return { settings: next, changed: JSON.stringify(next) !== JSON.stringify(config) };
}

/**
 * A config without the owned hooks (`known`: the recorded and the generated handlers); an event (or the whole
 * "hooks" object) left empty by the removal is dropped.
 */
export function withoutOwned(spec: HookConfigSpec<string>, config: Config, known: readonly HookHandler[]): { settings: Config; changed: boolean } {
	const current = hooksOf(spec, config);
	if (!current) return { settings: config, changed: false };
	const owned = (handler: unknown) => isOwnedBy(handler, known);
	const hooks: Record<string, unknown> = { ...current };
	let changed = false;
	for (const [event, groups] of Object.entries(current)) {
		const stripped = stripGroups(groups as unknown[], owned);
		if (!stripped.removed) continue;
		changed = true;
		if (stripped.groups.length) hooks[event] = stripped.groups;
		else delete hooks[event];
	}
	if (!changed) return { settings: config, changed: false };
	const next: Config = { ...config, hooks };
	if (Object.keys(hooks).length === 0) delete next.hooks;
	return { settings: next, changed: true };
}

/** Where each owned handler sits: event, group index and handler index (Codex keys its hook trust by position). */
export function ownedPositions<E extends string>(spec: HookConfigSpec<E>, config: Config, known: readonly HookHandler[]): { event: E; group: number; handler: number; value: HookHandler }[] {
	let hooks: Record<string, unknown> | undefined;
	try { hooks = hooksOf(spec, config); } catch { return []; }
	const found: { event: E; group: number; handler: number; value: HookHandler }[] = [];
	for (const event of spec.events) {
		const groups = Array.isArray(hooks?.[event]) ? (hooks![event] as unknown[]) : [];
		groups.forEach((group, groupIndex) => {
			const handlers = group && typeof group === "object" && Array.isArray((group as Group).hooks) ? ((group as Group).hooks as unknown[]) : [];
			handlers.forEach((handler, handlerIndex) => {
				if (isOwnedBy(handler, known)) found.push({ event, group: groupIndex, handler: handlerIndex, value: handler as HookHandler });
			});
		});
	}
	return found;
}

/**
 * Which events have an owned handler (one the ownership record lists, or the one install generates for `command`),
 * and whether every owned handler matches the current command exactly.
 */
export function ownedStatus<E extends string>(spec: HookConfigSpec<E>, config: Config, command: HookCommand, recorded: readonly HookHandler[] = []): { registered: E[]; current: boolean } {
	const positions = ownedPositions(spec, config, [...recorded, ...generatedHandlers(spec, command)]);
	const registered = spec.events.filter((event) => positions.some((position) => position.event === event));
	let current = true;
	for (const event of registered) {
		const expected = spec.handler(command, event);
		if (!positions.filter((position) => position.event === event).every(({ value }) => sameHandler(expected, value) && value.timeout === expected.timeout)) current = false;
	}
	return { registered, current: current && registered.length === spec.events.length };
}

/**
 * Whether writing `value` back (JSON.stringify) keeps everything `raw` said, apart from whitespace and how a string
 * is escaped. False when parsing lost something: an integer beyond 2^53 or a number written with more digits than a
 * double holds, a number spelled differently (`1.0`, `1e3`), a duplicate key, or keys JSON.parse reorders. `raw` must
 * be the text `value` was parsed from.
 */
export function jsonRoundTripKeeps(raw: string, value: unknown): boolean {
	const tokens: string[] = [];
	const literal = /-?\d[\d.eE+-]*|true|false|null/y;
	let at = 0;
	while (at < raw.length) {
		const char = raw[at]!;
		if (char === " " || char === "\t" || char === "\n" || char === "\r") { at++; continue; }
		if (char === "\"") {
			let end = at + 1;
			while (raw[end] !== "\"") end += raw[end] === "\\" ? 2 : 1;
			tokens.push(JSON.stringify(JSON.parse(raw.slice(at, end + 1))));
			at = end + 1;
			continue;
		}
		literal.lastIndex = at;
		const match = literal.exec(raw);
		if (match) { tokens.push(match[0]); at += match[0].length; continue; }
		tokens.push(char);
		at++;
	}
	return tokens.join("") === JSON.stringify(value);
}
