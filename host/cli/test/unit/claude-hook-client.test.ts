import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ClaudeBridgeConfig, ControlRecord } from "../../src/adapters/claude-bridge.ts";
import { findClaudePid, type HookIO, runClaudeHook } from "../../src/adapters/claude-hook-client.ts";
import { hookCommand } from "../../src/hook-command.ts";


/** A live bridge's control record, as the bridge publishes it: inside its session lock's marker. */
function writeControl(agentsDir: string, prefix: string, session: string, control: { pid: number }): void {
	const lock = join(agentsDir, `${prefix}-${session}.lock`);
	mkdirSync(lock, { recursive: true });
	writeFileSync(join(lock, `${control.pid}-${"a".repeat(16)}`), JSON.stringify(control));
}

const SESSION = "5f0c2a8e-1111-4c3b-9d2e-000000000001";

function fakeIO(options: { stdin?: string; answer?: unknown; hostConfig?: unknown } = {}) {
	const calls = { spawned: [] as ClaudeBridgeConfig[], posts: [] as { event: string; body: unknown; timeoutMs: number; token: string }[], stdout: [] as string[], slept: 0 };
	const control: ControlRecord = { version: 1, pid: 4242, port: 50001, hookToken: "h".repeat(64), bridgeInstanceId: "inst" };
	const io: HookIO = {
		stdin: async () => options.stdin ?? JSON.stringify({ session_id: SESSION, hook_event_name: "x", transcript_path: "/home/a/.claude/projects/p/s.jsonl", cwd: "/w", source: "startup", prompt: "secret prompt" }),
		stdout: async (text) => { calls.stdout.push(text); },
		paths: { registryDir: "", agentsDir: "" },
		alive: () => true,
		hostConfig: () => options.hostConfig,
		claudePid: () => 777,
		spawnBridge: (config) => { calls.spawned.push(config); },
		post: async (_port, token, event, body, timeoutMs) => { calls.posts.push({ event, body, timeoutMs, token }); return options.answer ?? {}; },
		sleep: async () => { calls.slept++; },
	};
	return { io, calls, control };
}

/** runClaudeHook reads the control record from disk: a temporary agents folder, with or without one. */
function withControl(io: HookIO, control: ControlRecord | undefined): () => void {
	const dir = mkdtempSync(join(tmpdir(), "mr-hook-"));
	io.paths = { registryDir: join(dir, "bridges"), agentsDir: join(dir, "agents") };
	mkdirSync(io.paths.agentsDir);
	if (control) writeControl(io.paths.agentsDir, "claude", SESSION, control);
	return () => rmSync(dir, { recursive: true, force: true });
}

describe("mars-ram hook claude <event>", () => {
	it("without a bridge, every event but SessionStart ends at once with no output", async () => {
		for (const event of ["UserPromptSubmit", "Stop", "Notification", "SessionEnd", "PermissionRequest"]) {
			const { io, calls } = fakeIO();
			const clean = withControl(io, undefined);
			await runClaudeHook(event, io);
			clean();
			expect(calls).toMatchObject({ spawned: [], posts: [], stdout: [] });
		}
	});

	it("SessionStart starts one bridge with the session's transcript, the Claude Code pid and the approval timeout", async () => {
		const { io, calls, control } = fakeIO({ hostConfig: { approvalTimeoutSeconds: 120 } });
		const clean = withControl(io, undefined);
		io.sleep = async () => { writeControl(io.paths.agentsDir, "claude", SESSION, control); };
		await runClaudeHook("SessionStart", io);
		clean();
		expect(calls.spawned).toEqual([{ sessionId: SESSION, transcriptPath: "/home/a/.claude/projects/p/s.jsonl", cwd: "/w", source: "startup", approvalTimeoutMs: 120_000, claudePid: 777 }]);
		expect(calls.posts).toEqual([]);
		expect(calls.stdout).toEqual([]);
	});

	it("SessionStart with a live bridge forwards instead of starting another", async () => {
		const { io, calls, control } = fakeIO();
		const clean = withControl(io, control);
		await runClaudeHook("SessionStart", io);
		clean();
		expect(calls.spawned).toEqual([]);
		expect(calls.posts.map((p) => p.event)).toEqual(["SessionStart"]);
	});

	it("forwards ordinary events quickly with the hook token, without the prompt, and prints nothing even if answered", async () => {
		const { io, calls, control } = fakeIO({ answer: { output: { decision: "block" } } });
		const clean = withControl(io, control);
		await runClaudeHook("UserPromptSubmit", io);
		clean();
		expect(calls.posts).toEqual([{ event: "UserPromptSubmit", token: control.hookToken, timeoutMs: 3000, body: expect.not.objectContaining({ prompt: expect.anything() }) }]);
		expect(calls.stdout).toEqual([]);
	});

	it("PermissionRequest prints the bridge's decision, waiting past the approval timeout", async () => {
		const output = { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } };
		const { io, calls, control } = fakeIO({ answer: { bridgeInstanceId: "inst", decision: { behavior: "allow" } } });
		const clean = withControl(io, control);
		await runClaudeHook("PermissionRequest", io);
		clean();
		expect(calls.posts[0]!.timeoutMs).toBe(315_000);
		expect(calls.stdout).toEqual([JSON.stringify(output)]);
	});

	it("PermissionRequest prints nothing when the bridge gives no decision or does not answer", async () => {
		for (const answer of [{}, undefined, "garbage"]) {
			const { io, calls, control } = fakeIO();
			io.post = async () => answer;
			const clean = withControl(io, control);
			await runClaudeHook("PermissionRequest", io);
			clean();
			expect(calls.stdout).toEqual([]);
		}
	});

	it.each([
		["an unknown event", "PreToolUse", undefined],
		["invalid JSON", "Stop", "{oops"],
		["a session id that could name a path", "Stop", JSON.stringify({ session_id: "../../etc" })],
		["SessionStart with a relative transcript", "SessionStart", JSON.stringify({ session_id: SESSION, transcript_path: "x.jsonl" })],
	])("ignores %s", async (_name, event, stdin) => {
		const { io, calls } = fakeIO(stdin === undefined ? {} : { stdin });
		const clean = withControl(io, undefined);
		await runClaudeHook(event, io);
		clean();
		expect(calls).toMatchObject({ spawned: [], posts: [], stdout: [] });
	});

	it("the command always exits 0, even for wrong arguments", async () => {
		expect(await hookCommand([])).toBe(0);
		expect(await hookCommand(["codex", "Stop"])).toBe(0);
		expect(await hookCommand(["claude", "Stop", "extra"])).toBe(0);
	});
});

describe("finding the Claude Code process", () => {
	const proc = (table: Record<number, [string, number]>) => (path: string) => {
		const [, pid, file] = /^\/proc\/(\d+)\/(comm|stat)$/.exec(path)!;
		const row = table[Number(pid)];
		if (!row) throw new Error("ENOENT");
		return file === "comm" ? `${row[0]}\n` : `${pid} (${row[0]}) S ${row[1]} 1 1`;
	};

	it("skips a shell between Claude Code and the hook on Linux", () => {
		expect(findClaudePid(300, "linux", proc({ 300: ["sh", 200], 200: ["claude", 1] }))).toBe(200);
		expect(findClaudePid(200, "linux", proc({ 200: ["claude", 1] }))).toBe(200);
	});

	it("gives up on a process it cannot read, a shell chain, or init", () => {
		expect(findClaudePid(300, "linux", proc({}))).toBeUndefined();
		expect(findClaudePid(300, "linux", proc({ 300: ["sh", 1] }))).toBeUndefined();
		expect(findClaudePid(5, "linux", proc({ 5: ["bash", 4], 4: ["sh", 3], 3: ["zsh", 2] }))).toBeUndefined();
		expect(findClaudePid(1, "linux", proc({}))).toBeUndefined();
	});

	it("uses the direct parent where hooks run in exec form", () => {
		expect(findClaudePid(912, "win32")).toBe(912);
	});
});
