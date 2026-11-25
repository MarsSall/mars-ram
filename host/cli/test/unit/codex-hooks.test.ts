import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AgentSession } from "../../src/core/agent-session.ts";
import { permissionOutput, type TranscriptState } from "../../src/core/agent-hooks.ts";
import {
	CODEX_HOOK_EVENTS,
	codexHookHandler,
	codexHookHash,
	codexHookStatus,
	codexHookTrust,
	codexOwnedHooks,
	describeCodexPermission,
	handleCodexHook,
	HookHistory,
	hookStates,
	isCodexOwnedHandler,
	withCodexHooks,
	withoutCodexHooks,
} from "../../src/core/codex-hooks.ts";
import { isOwnedHandler as isClaudeOwned, ownedHooks } from "../../src/core/claude-hooks.ts";

function fakeTimers() {
	const pending: { ms: number; run: () => void; cancelled: boolean }[] = [];
	return {
		pending,
		timers: { set: (ms: number, run: () => void) => { const entry = { ms, run, cancelled: false }; pending.push(entry); return () => { entry.cancelled = true; }; } },
		fire() { for (const entry of pending.splice(0)) if (!entry.cancelled) entry.run(); },
	};
}
const session = (timers = fakeTimers().timers) => new AgentSession({
	agent: "codex", sessionId: "s", instanceId: "i", capacity: 100, historyLimit: 50, clock: () => 1,
	timers, approvalTimeoutMs: 60_000, newId: () => "ap-1", provider: "openai",
});
const transcript = (present: boolean, recognized = false): TranscriptState & { polls: number } => {
	const state = { present, polls: 0, recognized: () => recognized, poll: () => { state.polls++; } };
	return state;
};
const never = new AbortController().signal;
const linux = { node: "/usr/bin/node", main: "/home/a/.mars-ram/cli/src/main.ts", platform: "linux" as const };
const windows = { node: "C:\\Program Files\\nodejs\\node.exe", main: "C:\\Users\\Ana Paz\\.mars-ram\\cli\\src\\main.ts", platform: "win32" as const };
const handlers = (command: typeof linux | typeof windows) => codexOwnedHooks(command).map((hook) => hook.handler);

describe("Codex hook routing in the bridge", () => {
	it("maps prompt, stop, interrupt and end to state, and answers none of them", async () => {
		const clock = fakeTimers();
		const s = session(clock.timers);
		const history = new HookHistory(s, transcript(true, true), clock.timers);
		expect(await handleCodexHook(s, history, "SessionStart", { source: "resume" }, never, () => {})).toEqual({});
		expect(await handleCodexHook(s, history, "UserPromptSubmit", { prompt: "hola" }, never, () => {})).toEqual({});
		expect(s.state().idle).toBe(false);
		expect(await handleCodexHook(s, history, "Stop", { last_assistant_message: "chau" }, never, () => {})).toEqual({});
		expect(s.state()).toMatchObject({ idle: true, lastOutcome: { outcome: "completed" } });
		await handleCodexHook(s, history, "UserPromptSubmit", {}, never, () => {});
		expect(await handleCodexHook(s, history, "Interrupt", { turn_id: "t" }, never, () => {})).toEqual({});
		expect(s.state()).toMatchObject({ idle: true, lastOutcome: { outcome: "aborted" } });
		let ended = 0;
		expect(await handleCodexHook(s, history, "SessionEnd", { reason: "other" }, never, () => { ended++; })).toEqual({});
		expect(ended).toBe(1);
		// A recognized rollout carries the conversation: the hooks add no history of their own.
		clock.fire();
		expect(s.history().messages).toEqual([]);
		expect(s.eventsSince(0).events.find((e) => e.type === "session_start")).toMatchObject({ reason: "resume" });
	});

	it("without a rollout path, the prompt and the reply become the history at once", async () => {
		const s = session();
		const history = new HookHistory(s, transcript(false), fakeTimers().timers);
		await handleCodexHook(s, history, "UserPromptSubmit", { prompt: "¿zorros?" }, never, () => {});
		await handleCodexHook(s, history, "Stop", { last_assistant_message: "Tres." }, never, () => {});
		expect(s.history().messages.map((m) => [m.role, m.text])).toEqual([["user", "¿zorros?"], ["assistant", "Tres."]]);
		const types = s.eventsSince(0).events.map((e) => e.type);
		expect(types.indexOf("message_end")).toBeLessThan(types.indexOf("agent_settled"));
	});

	it("with a rollout it cannot read, the hooks' texts are added after the turn, only if the rollout still showed nothing", async () => {
		const clock = fakeTimers();
		const s = session(clock.timers);
		const rollout = transcript(true, false);
		const history = new HookHistory(s, rollout, clock.timers);
		await handleCodexHook(s, history, "UserPromptSubmit", { prompt: "uno" }, never, () => {});
		await handleCodexHook(s, history, "Stop", { last_assistant_message: "dos" }, never, () => {});
		expect(s.history().messages).toEqual([]);
		expect(clock.pending.map((p) => p.ms)).toEqual([2000]);
		clock.fire();
		expect(rollout.polls).toBe(1);
		expect(s.history().messages.map((m) => [m.role, m.text])).toEqual([["user", "uno"], ["assistant", "dos"]]);

		let recognized = false;
		const late = { present: true, recognized: () => recognized, poll: () => { recognized = true; } };
		const other = session(clock.timers);
		const lateHistory = new HookHistory(other, late, clock.timers);
		lateHistory.submitted("tres");
		lateHistory.ended("cuatro");
		clock.fire();
		expect(other.history().messages).toEqual([]);
	});

	it("bounds the texts it keeps from the hooks", () => {
		const s = session();
		const history = new HookHistory(s, transcript(false), fakeTimers().timers);
		history.submitted("x".repeat(200_000));
		expect(s.history().messages[0]!.text.length).toBeLessThanOrEqual(64 * 1024 + 1);
		history.submitted(42);
		history.ended({ not: "text" });
		expect(s.history().messages).toHaveLength(1);
	});
});

describe("Codex approvals", () => {
	it("shell and apply_patch are commands with the command as detail; anything else is a permission", () => {
		expect(describeCodexPermission({ tool_name: "Bash", tool_input: { command: "rm -rf dist\nls", description: "Clean up" } })).toEqual({
			kind: "command", title: "Bash: rm -rf dist ls", detail: "rm -rf dist\nls\n\nClean up", source: { toolName: "Bash", args: {} },
		});
		expect(describeCodexPermission({ tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** End Patch" } })).toMatchObject({ kind: "command", detail: "*** Begin Patch\n*** End Patch" });
		expect(describeCodexPermission({ tool_name: "shell", tool_input: { command: "ls" } })).toMatchObject({ kind: "command", title: "shell: ls" });
		expect(describeCodexPermission({ tool_name: "mcp__fs__write", tool_input: { path: "/w/a", data: 1 } })).toMatchObject({ kind: "permission", title: "mcp__fs__write: /w/a" });
		expect(describeCodexPermission({ tool_name: "Bash", tool_input: { cmd: ["ls"] } })).toMatchObject({ kind: "permission", title: "Bash" });
		expect(describeCodexPermission({})).toMatchObject({ kind: "permission", title: "tool", detail: "{}" });
	});

	it("waits for the phone and answers allow or deny in Codex's PermissionRequest shape, never rewriting the request", async () => {
		const s = session();
		const history = new HookHistory(s, transcript(true, true), fakeTimers().timers);
		const allowed = handleCodexHook(s, history, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "npm test" } }, never, () => {});
		expect(s.state().approvals).toEqual([{ id: "ap-1", kind: "command", title: "Bash: npm test", detail: "npm test", choices: ["accept", "decline"] }]);
		await s.answerApproval({ id: "ap-1", decision: "accept" });
		expect(await allowed).toEqual({ decision: { behavior: "allow" } });
		const denied = handleCodexHook(s, history, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "rm -rf /" } }, never, () => {});
		await s.answerApproval({ id: "ap-1", decision: "decline" });
		expect(await denied).toEqual({ decision: { behavior: "deny", message: "Declined from the mars-ram app." } });
		for (const decision of ["accept", "decline"] as const) {
			const keys = Object.keys((permissionOutput(decision) as { hookSpecificOutput: { decision: object } }).hookSpecificOutput.decision);
			expect(keys.filter((key) => ["updatedInput", "updatedPermissions", "interrupt"].includes(key))).toEqual([]);
		}
	});

	it("marks an approval whose command is too long for the card as cut", () => {
		const s = session();
		const history = new HookHistory(s, transcript(true, true), fakeTimers().timers);
		void handleCodexHook(s, history, "PermissionRequest", { tool_name: "apply_patch", tool_input: { command: "p".repeat(6000) } }, never, () => {});
		expect((s.state().approvals as Record<string, unknown>[])[0]).toMatchObject({ kind: "command", detailTruncated: true });
		expect(s.eventsSince(0).events.find((e) => e.type === "approval_request")).toMatchObject({ detailTruncated: true });
		s.close();
	});

	it("the Interrupt hook ends a terminal approval fallback, so the phone can write again", async () => {
		const clock = fakeTimers();
		const s = session(clock.timers);
		const history = new HookHistory(s, transcript(true, true), clock.timers);
		await handleCodexHook(s, history, "UserPromptSubmit", { prompt: "hola" }, never, () => {});
		const timedOut = handleCodexHook(s, history, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "ls" } }, never, () => {});
		clock.fire();
		expect(await timedOut).toEqual({});
		expect(s.state().pendingPrompt).toMatchObject({ kind: "confirm" });
		expect(await handleCodexHook(s, history, "Interrupt", { turn_id: "t" }, never, () => {})).toEqual({});
		expect(s.state()).toMatchObject({ idle: true, pendingPrompt: null, lastOutcome: { outcome: "aborted" } });
	});

	it("with no answer in time, or when the hook goes away, gives no decision so Codex asks as usual", async () => {
		const clock = fakeTimers();
		const s = session(clock.timers);
		const history = new HookHistory(s, transcript(true, true), clock.timers);
		const timedOut = handleCodexHook(s, history, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "ls" } }, never, () => {});
		expect(clock.pending.map((p) => p.ms)).toEqual([60_000]);
		clock.fire();
		expect(await timedOut).toEqual({});
		const gone = new AbortController();
		const abandoned = handleCodexHook(s, history, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "ls" } }, gone.signal, () => {});
		gone.abort();
		expect(await abandoned).toEqual({});
		expect(s.state().approvals).toEqual([]);
		expect(s.eventsSince(0).events.filter((e) => e.type === "approval_resolved").map((e) => (e as { decision: string }).decision)).toEqual(["cancel", "cancel"]);
	});
});

describe("Codex hook entries in hooks.json", () => {
	it("POSIX: single-quoted paths, run through Codex's login shell, with Codex's timeouts", () => {
		expect(codexOwnedHooks(linux).map(({ event, handler }) => [event, handler])).toEqual(CODEX_HOOK_EVENTS.map((event) => [event, {
			type: "command",
			command: `'/usr/bin/node' --disable-warning=ExperimentalWarning '/home/a/.mars-ram/cli/src/main.ts' hook codex ${event}`,
			timeout: { SessionStart: 20, UserPromptSubmit: 5, PermissionRequest: 600, Stop: 5, Interrupt: 3, SessionEnd: 3 }[event],
		}]));
	});

	it("Windows: commandWindows (and command, for a Codex without it) is a cmd.exe line with double-quoted paths", () => {
		const handler = codexHookHandler(windows, "SessionEnd");
		const line = "\"C:\\Program Files\\nodejs\\node.exe\" --disable-warning=ExperimentalWarning \"C:\\Users\\Ana Paz\\.mars-ram\\cli\\src\\main.ts\" hook codex SessionEnd";
		expect(handler).toEqual({ type: "command", command: line, commandWindows: line, timeout: 3 });
		expect(isCodexOwnedHandler(handler, handlers(windows))).toBe(true);
		expect(isCodexOwnedHandler({ type: "command", command: "echo", commandWindows: line }, handlers(windows))).toBe(false);
	});

	it.each([
		["a POSIX path with a quote", { ...linux, main: "/home/o'neil/.mars-ram/cli/src/main.ts" }],
		["a POSIX path with a backslash", { ...linux, node: "/opt/a\\b/node" }],
		["a relative POSIX path", { ...linux, node: "node" }],
		["a newline", { ...linux, node: "/usr/bin/node\nrm" }],
		["a Windows path with %", { ...windows, main: "C:\\Users\\%USERNAME%\\.mars-ram\\cli\\src\\main.ts" }],
		["a Windows path with a quote", { ...windows, node: "C:\\a\"b\\node.exe" }],
		["a Windows path with !", { ...windows, node: "C:\\hey!\\node.exe" }],
		["a relative Windows path", { ...windows, node: "node.exe" }],
	])("refuses %s rather than writing a command a shell would change", (_name, command) => {
		expect(() => codexHookHandler(command, "Stop")).toThrow();
	});

	it("never claims another agent's handlers, nor Claude Code ours", () => {
		const claude = { type: "command", command: "'/usr/bin/node' --disable-warning=ExperimentalWarning '/home/a/.mars-ram/cli/src/main.ts' hook claude Stop", timeout: 5 };
		expect(isCodexOwnedHandler(claude, handlers(linux))).toBe(false);
		expect(isClaudeOwned(codexHookHandler(linux, "Stop"), ownedHooks(linux).map((hook) => hook.handler))).toBe(false);
		expect(isCodexOwnedHandler({ type: "command", command: "/elsewhere/main.ts hook codex Stop" }, handlers(linux))).toBe(false);
		expect(isCodexOwnedHandler({ type: "command", command: `wrap ${codexHookHandler(linux, "Stop").command}` }, handlers(linux))).toBe(false);
	});

	it("adds, updates and removes only the owned groups, keeping description, foreign hooks and their positions", () => {
		const foreignStop = { hooks: [{ type: "command", command: "notify-send done", timeout: 5 }] };
		const config = { description: "my hooks", hooks: { Stop: [foreignStop], PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "audit" }] }] } };
		const installed = withCodexHooks(config, codexOwnedHooks(linux));
		expect(installed.changed).toBe(true);
		const hooks = installed.settings.hooks as Record<string, unknown[]>;
		expect(Object.keys(installed.settings)).toEqual(["description", "hooks"]);
		expect(installed.settings.description).toBe("my hooks");
		expect(hooks.Stop![0]).toEqual(foreignStop);
		expect(hooks.Stop![1]).toEqual({ hooks: [codexHookHandler(linux, "Stop")] });
		expect(hooks.PermissionRequest).toEqual([{ matcher: "*", hooks: [codexHookHandler(linux, "PermissionRequest")] }]);
		expect(hooks.PreToolUse).toEqual(config.hooks.PreToolUse);
		expect(codexHookStatus(installed.settings, linux)).toEqual({ registered: [...CODEX_HOOK_EVENTS], current: true });
		expect(withCodexHooks(installed.settings, codexOwnedHooks(linux)).changed).toBe(false);

		const moved = withCodexHooks(installed.settings, codexOwnedHooks({ ...linux, node: "/new/node" }), handlers(linux));
		expect((moved.settings.hooks as Record<string, unknown[]>).Stop).toEqual([foreignStop, { hooks: [codexHookHandler({ ...linux, node: "/new/node" }, "Stop")] }]);
		expect(codexHookStatus(moved.settings, linux, handlers({ ...linux, node: "/new/node" }))).toMatchObject({ current: false });

		const removed = withoutCodexHooks(installed.settings, handlers(linux));
		expect(removed).toEqual({ settings: config, changed: true });
		expect(withoutCodexHooks(config, handlers(linux))).toEqual({ settings: config, changed: false });
		expect(withoutCodexHooks({ description: "d", hooks: { Stop: [{ hooks: [codexHookHandler(linux, "Stop")] }] } }, handlers(linux)).settings).toEqual({ description: "d" });
	});

	it("refuses hooks it could not read as Codex does", () => {
		expect(() => withCodexHooks({ hooks: [] }, codexOwnedHooks(linux))).toThrow(/hooks\.json/);
		expect(() => withCodexHooks({ hooks: { Stop: {} } }, codexOwnedHooks(linux))).toThrow(/not a list/);
		expect(codexHookStatus({ hooks: 3 }, linux)).toEqual({ registered: [], current: false });
	});
});

describe("Codex hook trust from config.toml", () => {
	const path = "/home/a/.codex/hooks.json";
	const installed = withCodexHooks({ hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } }, codexOwnedHooks(linux)).settings;

	it("reads trusted, untrusted and disabled hooks by Codex's position keys", () => {
		const h = (event: Parameters<typeof codexHookHash>[0], matcher?: string) => codexHookHash(event, matcher, codexHookHandler(linux, event), "linux")!;
		const toml = [
			"model = \"gpt-5\"",
			"[hooks.state.\"/home/a/.codex/hooks.json:session_start:0:0\"]",
			`trusted_hash = "${h("SessionStart")}"`,
			"[hooks.state]",
			`"/home/a/.codex/hooks.json:user_prompt_submit:0:0" = { trusted_hash = "${h("UserPromptSubmit")}" }`,
			"'/home/a/.codex/hooks.json:permission_request:0:0' = { trusted_hash = 'sha256:ccc', enabled = false }",
			"[hooks]",
			`state."/home/a/.codex/hooks.json:stop:1:0".trusted_hash = "${h("Stop")}"`,
			"[projects.\"/work\"]",
			"trust_level = \"trusted\"",
		].join("\n");
		expect(codexHookTrust(installed, path, toml, "linux", handlers(linux))).toEqual({ known: true, events: {
			SessionStart: "trusted", UserPromptSubmit: "trusted", PermissionRequest: "disabled", Stop: "trusted", Interrupt: "untrusted", SessionEnd: "untrusted",
		} });
	});

	it("is unknown without config.toml or without owned hooks; an empty config.toml trusts nothing", () => {
		expect(codexHookTrust(installed, path, undefined, "linux", handlers(linux))).toEqual({ known: false });
		expect(codexHookTrust({}, path, "", "linux", handlers(linux))).toEqual({ known: false });
		const empty = codexHookTrust(installed, path, "", "linux", handlers(linux));
		expect(empty.known && Object.values(empty.events)).toEqual(Array(6).fill("untrusted"));
	});

	it("matches Windows keys with escaped backslashes and any letter case", () => {
		const winConfig = withCodexHooks({}, codexOwnedHooks(windows)).settings;
		const hash = codexHookHash("Stop", undefined, codexHookHandler(windows, "Stop"), "win32");
		const toml = `[hooks.state."c:\\\\users\\\\ana paz\\\\.codex\\\\hooks.json:stop:0:0"]\ntrusted_hash = "${hash}"\n`;
		const trust = codexHookTrust(winConfig, "C:\\Users\\Ana Paz\\.codex\\hooks.json", toml, "win32", handlers(windows));
		expect(trust.known && trust.events.Stop).toBe("trusted");
	});

	it("recomputes Codex's trusted_hash (codex-rs hook_hash + version_for_toml) and reports a stale one", () => {
		// Codex hashes {event_name, matcher (events that take one), hooks: [normalized handler]} as JSON with sorted keys.
		const sha = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
		const stopLine = `'/usr/bin/node' --disable-warning=ExperimentalWarning '/home/a/.mars-ram/cli/src/main.ts' hook codex Stop`;
		const stop = sha(`{"event_name":"stop","hooks":[{"async":false,"command":${JSON.stringify(stopLine)},"timeout":5,"type":"command"}]}`);
		const permissionLine = stopLine.replace(/Stop$/, "PermissionRequest");
		const permission = sha(`{"event_name":"permission_request","hooks":[{"async":false,"command":${JSON.stringify(permissionLine)},"timeout":600,"type":"command"}],"matcher":"*"}`);
		expect(codexHookHash("Stop", undefined, codexHookHandler(linux, "Stop"), "linux")).toBe(stop);
		expect(codexHookHash("PermissionRequest", "*", codexHookHandler(linux, "PermissionRequest"), "linux")).toBe(permission);
		// Codex's own golden value for version_for_toml (codex-rs/config/src/fingerprint_tests.rs) holds for this encoding.
		expect(sha(JSON.stringify({ nested: { a: true, z: "text" }, rows: [{ a: 1, z: 2 }, { a: 3, z: 4 }] }))).toBe("sha256:a5e4c8fbdbc75d185b0f2b5291bfb2de10e8c523d6c89248876fd78a97c83176");
		// A Windows hook is hashed with the command Codex runs there (commandWindows).
		const windowsLine = codexHookHandler(windows, "Interrupt").commandWindows!;
		expect(codexHookHash("Interrupt", undefined, codexHookHandler(windows, "Interrupt"), "win32")).toBe(sha(`{"event_name":"interrupt","hooks":[{"async":false,"command":${JSON.stringify(windowsLine)},"timeout":3,"type":"command"}]}`));
		// A handler with fields this does not model gives no hash (trust is then taken as recorded).
		expect(codexHookHash("Stop", undefined, { ...codexHookHandler(linux, "Stop"), statusMessage: "x" }, "linux")).toBeUndefined();

		const config = withCodexHooks({}, codexOwnedHooks(linux)).settings;
		const key = (event: string) => `[hooks.state."${path}:${event}:0:0"]\ntrusted_hash = `;
		const toml = [
			`${key("stop")}"${stop}"`,
			`${key("permission_request")}"${permission}"`,
			`${key("session_start")}"sha256:0000"`,
			`${key("user_prompt_submit")}"sha256:0000"`,
		].join("\n");
		expect(codexHookTrust(config, path, toml, "linux", handlers(linux))).toEqual({ known: true, events: {
			Stop: "trusted", PermissionRequest: "trusted", SessionStart: "stale", UserPromptSubmit: "stale", Interrupt: "untrusted", SessionEnd: "untrusted",
		} });
	});

	it("ignores lines it does not understand", () => {
		expect(hookStates("[[array]]\nx = 1\n[hooks.state.\"k\"]\nenabled = true\n# c\n[broken\ntrusted_hash = \"no\"")).toEqual(new Map([["k", { enabled: true }]]));
	});
});
