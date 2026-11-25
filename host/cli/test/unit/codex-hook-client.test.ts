import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ControlRecord } from "../../src/adapters/agent-bridge.ts";
import type { CodexBridgeConfig } from "../../src/adapters/codex-bridge.ts";
import { decodeCodexBridgeConfig, encodeCodexBridgeConfig } from "../../src/adapters/codex-bridge.ts";
import { type CodexHookIO, findCodexPid, runCodexHook } from "../../src/adapters/codex-hook-client.ts";
import { bridgeCommand, hookCommand } from "../../src/hook-command.ts";


/** A live bridge's control record, as the bridge publishes it: inside its session lock's marker. */
function writeControl(agentsDir: string, prefix: string, session: string, control: { pid: number }): void {
	const lock = join(agentsDir, `${prefix}-${session}.lock`);
	mkdirSync(lock, { recursive: true });
	writeFileSync(join(lock, `${control.pid}-${"a".repeat(16)}`), JSON.stringify(control));
}

const SESSION = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const ROLLOUT = "/home/a/.codex/sessions/2026/11/20/rollout-2026-11-20T10-00-00-0199a1b2.jsonl";

function fakeIO(options: { stdin?: string; answer?: unknown; hostConfig?: unknown; pid?: number } = {}) {
	const calls = { spawned: [] as CodexBridgeConfig[], posts: [] as { event: string; body: Record<string, unknown>; timeoutMs: number; token: string }[], stdout: [] as string[] };
	const control: ControlRecord = { version: 1, pid: 4242, port: 50001, hookToken: "h".repeat(64), bridgeInstanceId: "inst" };
	const io: CodexHookIO = {
		stdin: async () => options.stdin ?? JSON.stringify({ session_id: SESSION, hook_event_name: "x", transcript_path: ROLLOUT, cwd: "/w", model: "gpt-x", source: "startup", prompt: "hola" }),
		stdout: async (text) => { calls.stdout.push(text); },
		paths: { registryDir: "", agentsDir: "" },
		alive: () => true,
		hostConfig: () => options.hostConfig,
		codexPid: async () => options.pid,
		spawnBridge: (config) => { calls.spawned.push(config); },
		post: async (_port, token, event, body, timeoutMs) => { calls.posts.push({ event, body: body as Record<string, unknown>, timeoutMs, token }); return options.answer ?? {}; },
		sleep: async () => {},
	};
	return { io, calls, control };
}

function withControl(io: CodexHookIO, control: ControlRecord | undefined): () => void {
	const dir = mkdtempSync(join(tmpdir(), "mr-codex-hook-"));
	io.paths = { registryDir: join(dir, "bridges"), agentsDir: join(dir, "agents") };
	mkdirSync(io.paths.agentsDir);
	if (control) writeControl(io.paths.agentsDir, "codex", SESSION, control);
	return () => rmSync(dir, { recursive: true, force: true });
}

describe("mars-ram hook codex <event>", () => {
	it("without a bridge, every event but SessionStart ends at once with no output", async () => {
		for (const event of ["UserPromptSubmit", "PermissionRequest", "Stop", "Interrupt", "SessionEnd"]) {
			const { io, calls } = fakeIO();
			const clean = withControl(io, undefined);
			await runCodexHook(event, io);
			clean();
			expect(calls).toMatchObject({ spawned: [], posts: [], stdout: [] });
		}
	});

	it("SessionStart starts one bridge with the rollout, the Codex pid and the approval timeout", async () => {
		const { io, calls, control } = fakeIO({ hostConfig: { approvalTimeoutSeconds: 90 }, pid: 31337 });
		const clean = withControl(io, undefined);
		io.sleep = async () => { writeControl(io.paths.agentsDir, "codex", SESSION, control); };
		await runCodexHook("SessionStart", io);
		clean();
		expect(calls.spawned).toEqual([{ sessionId: SESSION, transcriptPath: ROLLOUT, cwd: "/w", source: "startup", approvalTimeoutMs: 90_000, codexPid: 31337 }]);
		expect(calls.posts).toEqual([]);
		expect(calls.stdout).toEqual([]);
	});

	it("SessionStart with a null or unreadable transcript_path still starts a bridge, without a rollout", async () => {
		for (const transcript of [null, "relative.jsonl", "/home/a/.codex/sessions/r.jsonl.zst", 7]) {
			const { io, calls } = fakeIO({ stdin: JSON.stringify({ session_id: SESSION, transcript_path: transcript, cwd: "/w", source: "resume" }) });
			const clean = withControl(io, undefined);
			await runCodexHook("SessionStart", io);
			clean();
			expect(calls.spawned).toEqual([{ sessionId: SESSION, cwd: "/w", source: "resume", approvalTimeoutMs: 300_000 }]);
		}
	});

	it("forwards turn events with the hook token, the prompt and reply bounded, and prints nothing", async () => {
		const { io, calls, control } = fakeIO({ answer: { output: { decision: "block" } }, stdin: JSON.stringify({ session_id: SESSION, prompt: "p".repeat(100_000), last_assistant_message: "r" }) });
		const clean = withControl(io, control);
		await runCodexHook("UserPromptSubmit", io);
		await runCodexHook("Stop", io);
		clean();
		expect(calls.posts.map((p) => [p.event, p.token, p.timeoutMs])).toEqual([["UserPromptSubmit", control.hookToken, 3000], ["Stop", control.hookToken, 3000]]);
		expect((calls.posts[0]!.body.prompt as string).length).toBe(64 * 1024);
		expect(calls.posts[0]!.body.last_assistant_message).toBe("r");
		expect(calls.stdout).toEqual([]);
	});

	it("SessionEnd and Interrupt give the bridge little time: Codex allows them 3 s in all", async () => {
		const { io, calls, control } = fakeIO();
		const clean = withControl(io, control);
		await runCodexHook("SessionEnd", io);
		await runCodexHook("Interrupt", io);
		clean();
		expect(calls.posts.map((p) => [p.event, p.timeoutMs])).toEqual([["SessionEnd", 1200], ["Interrupt", 1200]]);
	});

	it("PermissionRequest prints the bridge's decision, waiting past the approval timeout", async () => {
		const output = { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "Declined from the mars-ram app." } } };
		const { io, calls, control } = fakeIO({ answer: { bridgeInstanceId: "inst", decision: output.hookSpecificOutput.decision } });
		const clean = withControl(io, control);
		await runCodexHook("PermissionRequest", io);
		clean();
		expect(calls.posts[0]!.timeoutMs).toBe(315_000);
		expect(calls.stdout).toEqual([JSON.stringify(output)]);
	});

	it("PermissionRequest prints nothing when the bridge gives no decision, times out or is gone", async () => {
		for (const answer of [{}, undefined, "garbage", { output: "text" }, { bridgeInstanceId: "inst", output: { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } } }]) {
			const { io, calls, control } = fakeIO();
			io.post = async () => answer;
			const clean = withControl(io, control);
			await runCodexHook("PermissionRequest", io);
			clean();
			expect(calls.stdout).toEqual([]);
		}
	});

	it.each([
		["an unknown event", "PreToolUse", undefined],
		["Claude Code's Notification", "Notification", undefined],
		["invalid JSON", "Stop", "{oops"],
		["a session id that could name a path", "Stop", JSON.stringify({ session_id: "../../etc" })],
	])("ignores %s", async (_name, event, stdin) => {
		const { io, calls, control } = fakeIO(stdin === undefined ? {} : { stdin });
		const clean = withControl(io, control);
		await runCodexHook(event, io);
		clean();
		expect(calls).toMatchObject({ spawned: [], posts: [], stdout: [] });
	});

	it("the commands validate their arguments: hook always exits 0, bridge refuses a bad config", async () => {
		expect(await hookCommand(["codex"])).toBe(0);
		expect(await hookCommand(["codex", "Stop", "extra"])).toBe(0);
		expect(await bridgeCommand(["codex", "not-base64-json"])).toBe(2);
		expect(await bridgeCommand(["codex", encodeCodexBridgeConfig({ sessionId: "../x", cwd: "/", source: "startup", approvalTimeoutMs: 60_000 })])).toBe(2);
		expect(await bridgeCommand(["opencode", "e30"])).toBe(2);
	});

	it("the bridge config round-trips and refuses unsafe values", () => {
		const config: CodexBridgeConfig = { sessionId: SESSION, transcriptPath: ROLLOUT, cwd: "/w", source: "startup", approvalTimeoutMs: 60_000, codexPid: 99 };
		expect(decodeCodexBridgeConfig(encodeCodexBridgeConfig(config))).toEqual(config);
		const { transcriptPath: _, ...noRollout } = config;
		expect(decodeCodexBridgeConfig(encodeCodexBridgeConfig(noRollout))).toEqual(noRollout);
		for (const bad of [{ transcriptPath: "x.jsonl" }, { transcriptPath: "/a/b.txt" }, { approvalTimeoutMs: 1 }, { codexPid: 1 }, { source: "Bad Source" }]) {
			expect(decodeCodexBridgeConfig(encodeCodexBridgeConfig({ ...config, ...bad } as CodexBridgeConfig))).toBeUndefined();
		}
	});
});

describe("finding the Codex process", () => {
	const proc = (table: Record<number, [string, number]>) => (path: string) => {
		const [, pid, file] = /^\/proc\/(\d+)\/(comm|stat)$/.exec(path)!;
		const row = table[Number(pid)];
		if (!row) throw new Error("ENOENT");
		return file === "comm" ? `${row[0]}\n` : `${pid} (${row[0]}) S ${row[1]} 1 1`;
	};

	it("Linux: skips the login shell Codex runs the hook with, fish and nu included", async () => {
		expect(await findCodexPid(300, "linux", proc({ 300: ["fish", 200], 200: ["codex", 1] }))).toBe(200);
		expect(await findCodexPid(300, "linux", proc({ 300: ["nu", 200], 200: ["codex", 1] }))).toBe(200);
		expect(await findCodexPid(300, "linux", proc({}))).toBeUndefined();
	});

	it("Windows: the parent is cmd.exe, so Codex is its parent; unreadable means no watch", async () => {
		const table: Record<number, { name: string; parentPid: number }> = { 500: { name: "cmd.exe", parentPid: 400 }, 600: { name: "codex.exe", parentPid: 10 }, 700: { name: "CMD.EXE", parentPid: 4 } };
		const query = async (pid: number) => table[pid];
		expect(await findCodexPid(500, "win32", undefined, query)).toBe(400);
		expect(await findCodexPid(600, "win32", undefined, query)).toBe(600);
		expect(await findCodexPid(700, "win32", undefined, query)).toBeUndefined();
		expect(await findCodexPid(800, "win32", undefined, query)).toBeUndefined();
	});

	it("elsewhere, and for impossible parents, no pid: the shell in between cannot be skipped", async () => {
		expect(await findCodexPid(300, "darwin")).toBeUndefined();
		expect(await findCodexPid(1, "linux", proc({}))).toBeUndefined();
	});
});
