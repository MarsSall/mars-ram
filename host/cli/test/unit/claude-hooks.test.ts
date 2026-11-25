import { describe, expect, it } from "vitest";
import { AgentSession } from "../../src/core/agent-session.ts";
import {
	CLAUDE_HOOK_EVENTS,
	describePermission,
	handleClaudeHook,
	hookHandler,
	isOwnedHandler,
	ownedHooks,
	ownedHookStatus,
	permissionOutput,
	withOwnedHooks,
	withoutOwnedHooks,
} from "../../src/core/claude-hooks.ts";

const session = () => new AgentSession({
	agent: "claude-code", sessionId: "s", instanceId: "i", capacity: 50, historyLimit: 50, clock: () => 1,
	timers: { set: () => () => {} }, approvalTimeoutMs: 1000, newId: () => "ap-1", provider: "anthropic",
});
const never = new AbortController().signal;
const handlers = (command: Parameters<typeof ownedHooks>[0]) => ownedHooks(command).map((hook) => hook.handler);

describe("hook routing in the bridge", () => {
	it("maps prompt, stop and notifications to state, and never answers them", async () => {
		const s = session();
		expect(await handleClaudeHook(s, "UserPromptSubmit", { prompt: "secret" }, never, () => {})).toEqual({});
		expect(s.state().idle).toBe(false);
		expect(await handleClaudeHook(s, "Notification", { notification_type: "permission_prompt", message: "Claude needs\nyour permission" }, never, () => {})).toEqual({});
		expect(s.state().pendingPrompt).toEqual({ kind: "confirm", title: "Claude needs your permission" });
		await handleClaudeHook(s, "Stop", {}, never, () => {});
		expect(s.state()).toMatchObject({ idle: true, pendingPrompt: null });
		// Claude's idle reminder only means the run ended; it is not a question for the user.
		const idleBefore = s.state().lastSeq;
		await handleClaudeHook(s, "Notification", { notification_type: "idle_prompt", message: "Claude is waiting for your input" }, never, () => {});
		expect(s.state()).toMatchObject({ pendingPrompt: null, lastSeq: idleBefore });
		await handleClaudeHook(s, "Notification", { notification_type: "elicitation_dialog", message: "Pick one" }, never, () => {});
		expect(s.state().pendingPrompt).toEqual({ kind: "input", title: "Pick one" });
		const before = s.state().lastSeq;
		await handleClaudeHook(s, "Notification", { notification_type: "auth_success", message: "x" }, never, () => {});
		expect(s.state().lastSeq).toBe(before);
	});

	it("SessionStart records the source and SessionEnd ends the bridge", async () => {
		const s = session();
		let ended = 0;
		await handleClaudeHook(s, "SessionStart", { source: "compact" }, never, () => {});
		await handleClaudeHook(s, "SessionStart", { source: "Evil\nsource" }, never, () => {});
		expect(s.eventsSince(0).events.map((e) => (e as { reason?: string }).reason)).toEqual(["compact", "startup"]);
		await handleClaudeHook(s, "SessionEnd", { reason: "exit" }, never, () => { ended++; });
		expect(ended).toBe(1);
	});

	it("PermissionRequest waits for the phone and prints Claude Code's decision", async () => {
		const s = session();
		const answer = handleClaudeHook(s, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "rm -rf build", description: "Clean" } }, never, () => {});
		expect(s.state().approvals).toEqual([{ id: "ap-1", kind: "command", title: "Bash: rm -rf build", detail: "rm -rf build\n\nClean", choices: ["accept", "decline"] }]);
		await s.answerApproval({ id: "ap-1", decision: "decline" });
		expect(await answer).toEqual({ decision: { behavior: "deny", message: "Declined from the mars-ram app." } });
	});

	it("PermissionRequest with a command too long for the card marks the approval as cut, in the state and the event", async () => {
		for (const command of ["x".repeat(2500), "y".repeat(5000)]) {
			const s = session();
			void handleClaudeHook(s, "PermissionRequest", { tool_name: "Bash", tool_input: { command } }, never, () => {});
			expect((s.state().approvals as Record<string, unknown>[])[0]).toMatchObject({ detail: command.slice(0, 2000), detailTruncated: true });
			expect(s.eventsSince(0).events.find((e) => e.type === "approval_request")).toMatchObject({ detailTruncated: true });
			s.close();
		}
		const s = session();
		void handleClaudeHook(s, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "ls" } }, never, () => {});
		expect((s.state().approvals as Record<string, unknown>[])[0]).not.toHaveProperty("detailTruncated");
		s.close();
	});

	it("PermissionRequest with no answer prints nothing, so Claude Code shows its own prompt", async () => {
		const s = session();
		const gone = new AbortController();
		const answer = handleClaudeHook(s, "PermissionRequest", { tool_name: "Write", tool_input: { file_path: "/w/a.txt", content: "x" } }, gone.signal, () => {});
		gone.abort();
		expect(await answer).toEqual({});
	});
});

describe("permission cards", () => {
	it("Bash is a command; other tools are a permission named after their target", () => {
		expect(describePermission({ tool_name: "Bash", tool_input: { command: "npm test\n--watch" } })).toMatchObject({ kind: "command", title: "Bash: npm test --watch", detail: "npm test\n--watch" });
		expect(describePermission({ tool_name: "Edit", tool_input: { file_path: "/w/x.ts", old_string: "a", new_string: "b" } })).toMatchObject({ kind: "permission", title: "Edit: /w/x.ts", detail: expect.stringContaining('"old_string": "a"') });
		expect(describePermission({ tool_name: "mcp__zorro__fetch", tool_input: { url: "https://example.invalid" } })).toMatchObject({ title: "mcp__zorro__fetch: https://example.invalid" });
		expect(describePermission({})).toMatchObject({ kind: "permission", title: "tool", detail: "{}" });
	});

	it("bounds huge tool input before the protocol bound", () => {
		expect(describePermission({ tool_name: "Write", tool_input: { file_path: "/a", content: "z".repeat(100_000) } }).detail.length).toBeLessThanOrEqual(4000);
	});

	it("accept allows, every other decision denies", () => {
		expect(permissionOutput("accept")).toEqual({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
		expect(permissionOutput("decline")).toMatchObject({ hookSpecificOutput: { decision: { behavior: "deny" } } });
	});
});

const linux = { node: "/usr/bin/node", main: "/home/al'ex/.mars-ram/cli/src/main.ts", platform: "linux" as const };
const windows = { node: "C:\\Program Files\\nodejs\\node.exe", main: "C:\\Users\\Alex Q\\.mars-ram\\cli\\src\\main.ts", platform: "win32" as const };

describe("hook entries install owns", () => {
	it("POSIX: a shell command with every path single-quoted", () => {
		expect(hookHandler(linux, "Stop")).toEqual({ type: "command", command: "'/usr/bin/node' --disable-warning=ExperimentalWarning '/home/al'\\''ex/.mars-ram/cli/src/main.ts' hook claude Stop", timeout: 5 });
		expect(hookHandler(linux, "PermissionRequest").timeout).toBe(600);
	});

	it("Windows: exec form with the real node.exe and arguments, no shell quoting", () => {
		expect(hookHandler(windows, "SessionStart")).toEqual({
			type: "command", command: "C:\\Program Files\\nodejs\\node.exe",
			args: ["--disable-warning=ExperimentalWarning", "C:\\Users\\Alex Q\\.mars-ram\\cli\\src\\main.ts", "hook", "claude", "SessionStart"], timeout: 10,
		});
	});

	it("refuses paths with line breaks", () => {
		expect(() => hookHandler({ ...linux, main: "/a\n/b" }, "Stop")).toThrow();
	});

	it("recognises exactly the handlers it knows (recorded or generated), in both forms, and nothing else", () => {
		const known = [...handlers(linux), ...handlers(windows)];
		expect(isOwnedHandler(hookHandler(linux, "Stop"), known)).toBe(true);
		expect(isOwnedHandler(hookHandler(windows, "Notification"), known)).toBe(true);
		expect(isOwnedHandler(hookHandler(linux, "Stop"), [])).toBe(false);
		for (const foreign of [
			{ type: "command", command: "afplay /System/Library/Sounds/Glass.aiff" },
			{ type: "command", command: "node /home/x/other/cli/src/main.ts hook claude Stop" },
			{ type: "command", command: "/home/x/.mars-ram/cli/src/main.ts hook claude Stop; rm -rf ~" },
			{ type: "command", command: `wrap ${hookHandler(linux, "Stop").command}` },
			{ type: "command", command: "node.exe", args: ["C:\\x\\main.ts", "hook", "claude", "Stop"] },
			{ ...hookHandler(windows, "Stop"), args: ["--wrapped", ...hookHandler(windows, "Stop").args!] },
			{ type: "prompt", prompt: "x" },
			null,
		]) expect(isOwnedHandler(foreign, known)).toBe(false);
		const recorded = { type: "command" as const, command: "old-node /old/main.ts hook claude Stop", timeout: 5 };
		expect(isOwnedHandler({ ...recorded }, [recorded])).toBe(true);
		expect(isOwnedHandler({ type: "command", command: recorded.command }, [recorded])).toBe(false);
		expect(isOwnedHandler({ ...recorded, timeout: 9 }, [recorded])).toBe(false);
	});
});

describe("settings.json merge and removal", () => {
	const foreign = {
		model: "opus",
		permissions: { allow: ["Bash(npm test)"] },
		hooks: {
			Stop: [{ hooks: [{ type: "command", command: "notify-send done" }] }],
			PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "~/guard.sh", timeout: 30 }] }],
		},
		statusLine: { type: "command", command: "~/status.sh" },
	};

	it("adds one owned group per event and keeps every foreign setting and hook, in order", () => {
		const { settings, changed } = withOwnedHooks(structuredClone(foreign), ownedHooks(linux));
		expect(changed).toBe(true);
		expect(Object.keys(settings)).toEqual(["model", "permissions", "hooks", "statusLine"]);
		const hooks = settings.hooks as Record<string, { matcher?: string; hooks: unknown[] }[]>;
		expect(Object.keys(hooks)).toEqual(["Stop", "PreToolUse", ...CLAUDE_HOOK_EVENTS.filter((e) => e !== "Stop")]);
		expect(hooks.Stop).toEqual([foreign.hooks.Stop[0], { hooks: [hookHandler(linux, "Stop")] }]);
		expect(hooks.PreToolUse).toEqual(foreign.hooks.PreToolUse);
		expect(hooks.PermissionRequest).toEqual([{ matcher: "*", hooks: [hookHandler(linux, "PermissionRequest")] }]);
		expect(withoutOwnedHooks(settings, handlers(linux))).toEqual({ settings: foreign, changed: true });
	});

	it("is idempotent, and a re-install with a new node path replaces the owned group in place", () => {
		const once = withOwnedHooks(structuredClone(foreign), ownedHooks(linux)).settings;
		expect(withOwnedHooks(structuredClone(once), ownedHooks(linux)).changed).toBe(false);
		(once.hooks as Record<string, unknown[]>).Stop!.push({ hooks: [{ type: "command", command: "later-foreign" }] });
		const moved = withOwnedHooks(structuredClone(once), ownedHooks({ ...linux, node: "/opt/node" }), handlers(linux)).settings;
		const stop = (moved.hooks as Record<string, { hooks: { command: string }[] }[]>).Stop!;
		expect(stop.map((group) => group.hooks[0]!.command)).toEqual(["notify-send done", expect.stringContaining("'/opt/node'"), "later-foreign"]);
		expect(ownedHookStatus(moved, { ...linux, node: "/opt/node" })).toEqual({ registered: [...CLAUDE_HOOK_EVENTS], current: true });
		expect(ownedHookStatus(moved, linux, handlers({ ...linux, node: "/opt/node" })).current).toBe(false);
		// Without the record, an older node path's handler is not ours: it is kept, next to the new one.
		const unrecorded = withOwnedHooks(structuredClone(once), ownedHooks({ ...linux, node: "/opt/node" })).settings;
		expect((unrecorded.hooks as Record<string, unknown[]>).Stop).toHaveLength(4);
	});

	it("keeps foreign handlers that share a group with an owned one", () => {
		const shared = { hooks: { Stop: [{ hooks: [{ type: "command", command: "beep" }, hookHandler(linux, "Stop")] }] } };
		expect(withoutOwnedHooks(shared, handlers(linux)).settings).toEqual({ hooks: { Stop: [{ hooks: [{ type: "command", command: "beep" }] }] } });
	});

	it("removal without owned hooks changes nothing; an empty hooks object left by removal is dropped", () => {
		expect(withoutOwnedHooks(structuredClone(foreign), handlers(linux))).toEqual({ settings: foreign, changed: false });
		expect(withoutOwnedHooks({}, handlers(linux))).toEqual({ settings: {}, changed: false });
		const only = withOwnedHooks({ theme: "dark" }, ownedHooks(windows)).settings;
		expect(withoutOwnedHooks(only, [])).toEqual({ settings: only, changed: false });
		expect(withoutOwnedHooks(only, handlers(windows))).toEqual({ settings: { theme: "dark" }, changed: true });
		expect(ownedHookStatus({ theme: "dark" }, windows)).toEqual({ registered: [], current: false });
	});

	it("refuses hooks it cannot read instead of rewriting them", () => {
		expect(() => withOwnedHooks({ hooks: [] }, ownedHooks(linux))).toThrow(/not an object/);
		expect(() => withOwnedHooks({ hooks: { Stop: "x" } }, ownedHooks(linux))).toThrow(/not a list/);
		expect(() => withoutOwnedHooks({ hooks: 3 }, handlers(linux))).toThrow();
	});
});
