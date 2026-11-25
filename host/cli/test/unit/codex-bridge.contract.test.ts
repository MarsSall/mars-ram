// Contract-style: the real Codex bridge (HTTP/SSE server, registry, hook channel, rollout tail) in this process,
// against an invented rollout file and a fake Herdr, in a temporary home. The hook side is the real
// `mars-ram hook codex` client with its stdin replaced. Nothing touches the real ~/.codex or ~/.mars-ram.
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boundApprovals, decodeEvent, decodeRegistryEntry, decodeResponse, HistoryResponse, type RegistryEntry, sessionCapabilities, StateResponse } from "@workspace/protocol";
import { type FilePermissions, posixPermissions, type TerminalExecFile } from "@workspace/protocol/bridge-host";
import type { BridgePaths, RunningAgentBridge } from "../../src/adapters/agent-bridge.ts";
import { readCodexControl, runCodexBridge } from "../../src/adapters/codex-bridge.ts";
import { defaultCodexHookIO, runCodexHook } from "../../src/adapters/codex-hook-client.ts";
import { readControl as readClaudeControl } from "../../src/adapters/claude-bridge.ts";

const SESSION = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const permissions: FilePermissions = process.platform === "win32" ? { restrictDirectory: () => {}, restrictFile: () => {} } : posixPermissions;
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const item = (payload: unknown) => line({ timestamp: "2026-11-20T10:00:00Z", type: "response_item", payload });

let home: string;
let paths: BridgePaths;
let rollout: string;
let herdr: string[][];
let bridge: RunningAgentBridge;
let entry: RegistryEntry;

const app = async (method: string, path: string, body?: unknown, token = entry.token) => {
	const res = await fetch(`http://127.0.0.1:${entry.port}${path}`, { method, headers: { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
	return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const hook = async (event: string, payload: Record<string, unknown>) => {
	const out: string[] = [];
	await runCodexHook(event, { ...defaultCodexHookIO(home), paths, codexPid: async () => undefined, stdin: async () => JSON.stringify({ session_id: SESSION, hook_event_name: event, cwd: "/work/zorro", model: "gpt-x", transcript_path: rollout, ...payload }), stdout: async (text) => { out.push(text); } });
	return out;
};
const until = async (check: () => Promise<boolean> | boolean) => {
	for (let i = 0; i < 300; i++) { if (await check()) return; await new Promise((r) => setTimeout(r, 10)); }
	throw new Error("timed out");
};
const registryEntry = (): RegistryEntry => {
	const names = readdirSync(paths.registryDir).filter((name) => name.endsWith(".json"));
	expect(names).toHaveLength(1);
	const decoded = decodeRegistryEntry(JSON.parse(readFileSync(join(paths.registryDir, names[0]!), "utf8")));
	if (!decoded.ok) throw new Error(decoded.errors.join("; "));
	return decoded.value;
};
const fakeHerdr = (): TerminalExecFile => (file, args, options, callback) => { expect(options.shell).toBe(false); herdr.push([file, ...args]); callback(null, "screen text", ""); };

beforeEach(async () => {
	home = realpathSync(mkdtempSync(join(tmpdir(), "mr-codex-bridge-")));
	paths = { registryDir: join(home, ".mars-ram/bridges"), agentsDir: join(home, ".mars-ram/agents") };
	rollout = join(home, ".codex/sessions/rollout-2026-11-20T10-00-00-x.jsonl");
	mkdirSync(join(home, ".codex/sessions"), { recursive: true });
	writeFileSync(rollout,
		line({ timestamp: "t", type: "session_meta", payload: { id: SESSION, cwd: "/work/zorro" } })
		+ line({ timestamp: "t", type: "turn_context", payload: { model: "gpt-invented-5" } })
		+ item({ type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context><cwd>/work/zorro</cwd></environment_context>" }] })
		+ item({ type: "message", role: "user", content: [{ type: "input_text", text: "Earlier question about zorros" }] })
		+ item({ type: "message", role: "assistant", content: [{ type: "output_text", text: "Earlier answer" }] }));
	herdr = [];
	bridge = (await runCodexBridge(
		{ sessionId: SESSION, transcriptPath: rollout, cwd: "/work/zorro", source: "startup", approvalTimeoutMs: 60_000 },
		{ paths, env: { HERDR_PANE_ID: "w7:p3", HERDR_BIN_PATH: "/fake/herdr" }, permissions, herdr: fakeHerdr(), pollMs: 20 },
	))!;
	entry = registryEntry();
});

afterEach(async () => {
	await bridge?.stop();
	rmSync(home, { recursive: true, force: true });
});

describe("Codex bridge contract", () => {
	it("publishes a private registry entry for agent codex with pane capabilities and approvals", () => {
		expect(entry).toMatchObject({ sessionId: SESSION, cwd: "/work/zorro", pid: process.pid, agent: "codex" });
		expect(sessionCapabilities(entry)).toEqual({ agent: "codex", capabilities: { message: true, steer: true, abort: true, attachments: false, terminal: true, approvals: true } });
		if (process.platform !== "win32") {
			expect(statSync(paths.registryDir).mode & 0o777).toBe(0o700);
			// Files are 0600; the session lock is a 0700 folder holding its owner's 0600 marker.
			const privateMode = (path: string) => (statSync(path).isDirectory() ? 0o700 : 0o600);
			for (const dir of [paths.registryDir, paths.agentsDir]) for (const name of readdirSync(dir)) {
				const path = join(dir, name);
				expect(statSync(path).mode & 0o777).toBe(privateMode(path));
				if (statSync(path).isDirectory()) for (const inner of readdirSync(path)) expect(statSync(join(path, inner)).mode & 0o777).toBe(privateMode(join(path, inner)));
			}
		}
		expect(readCodexControl(paths, SESSION)!.hookToken).not.toBe(entry.token);
		// Codex and Claude Code sessions never share a hook channel.
		expect(readClaudeControl(paths, SESSION)).toBeUndefined();
	});

	it("serves state and the rollout history in the protocol shapes", async () => {
		const state = await app("GET", "/state");
		expect(decodeResponse(StateResponse, state.body).ok).toBe(true);
		expect(state.body).toMatchObject({ idle: true, terminal: true, terminalPane: "w7:p3", agent: "codex", model: { id: "gpt-invented-5", provider: "openai" } });
		const history = await app("GET", "/history");
		expect(decodeResponse(HistoryResponse, history.body).ok).toBe(true);
		expect((history.body.messages as { role: string; text: string }[]).map((m) => [m.role, m.text])).toEqual([["user", "Earlier question about zorros"], ["assistant", "Earlier answer"]]);
	});

	it("keeps the app's routes and the hook channel apart, and refuses other sessions and Claude Code's events", async () => {
		const control = readCodexControl(paths, SESSION)!;
		expect((await app("GET", "/state", undefined, control.hookToken)).status).toBe(401);
		expect((await app("POST", "/hook/Stop", {}, entry.token)).status).toBe(401);
		expect((await app("POST", "/hook/Stop", { session_id: "other-session" }, control.hookToken)).status).toBe(400);
		expect((await app("POST", "/hook/Notification", {}, control.hookToken)).status).toBe(400);
		expect((await app("POST", "/hook/Interrupt", [], control.hookToken)).status).toBe(400);
	});

	it("streams hook state and live rollout lines as protocol events", async () => {
		const res = await fetch(`http://127.0.0.1:${entry.port}/events?since=0`, { headers: { authorization: `Bearer ${entry.token}` } });
		const reader = res.body!.getReader();
		let text = "";
		const events = () => text.split("\n\n").filter((chunk) => chunk.startsWith("id: ")).map((chunk) => JSON.parse(chunk.slice(chunk.indexOf("data: ") + 6)));
		const pump = (async () => { for (;;) { const { value, done } = await reader.read(); if (done) return; text += new TextDecoder().decode(value); } })();
		expect(await hook("UserPromptSubmit", { prompt: "Count the zorros", turn_id: "t1" })).toEqual([]);
		appendFileSync(rollout, line({ timestamp: "t", type: "event_msg", payload: { type: "user_message", message: "Count the zorros" } }));
		appendFileSync(rollout, item({ type: "message", role: "user", content: [{ type: "input_text", text: "Count the zorros" }] }));
		appendFileSync(rollout, item({ type: "function_call", name: "shell", arguments: "{}", call_id: "call_z" }));
		appendFileSync(rollout, item({ type: "function_call_output", call_id: "call_z", output: "3 matches" }));
		const answer = item({ type: "message", role: "assistant", content: [{ type: "output_text", text: "Three zorros." }] });
		appendFileSync(rollout, answer.slice(0, 20));
		await until(() => events().some((e) => e.type === "tool_end"));
		appendFileSync(rollout, answer.slice(20));
		await until(() => events().some((e) => e.type === "message_end" && e.message.role === "assistant"));
		expect(await hook("Stop", { last_assistant_message: "Three zorros." })).toEqual([]);
		await until(() => events().some((e) => e.type === "agent_settled"));
		await reader.cancel();
		await pump.catch(() => {});
		for (const event of events()) expect(decodeEvent(event).kind).toBe("known");
		expect(events().map((e) => e.type)).toEqual(["session_start", "agent_start", "message_start", "message_end", "tool_start", "tool_end", "message_start", "message_end", "agent_end", "agent_settled"]);
		expect(events().find((e) => e.type === "tool_start")).toMatchObject({ toolName: "shell", toolCallId: "call_z" });
		// The rollout is understood: the hook's texts are not added a second time.
		await new Promise((r) => setTimeout(r, 50));
		expect(((await app("GET", "/history")).body.messages as unknown[]).length).toBe(5);
	});

	it("types messages into the session's pane and stops with Escape; Interrupt settles as aborted", async () => {
		expect(await app("POST", "/message", { text: "run the\ntests" })).toMatchObject({ status: 202, body: { status: "submitted" } });
		await hook("UserPromptSubmit", {});
		expect(await app("POST", "/message", { text: "and lint" })).toMatchObject({ status: 202, body: { status: "queued" } });
		expect(await app("POST", "/message", { text: "x", attachments: ["a.png"] })).toMatchObject({ status: 400 });
		expect(await app("POST", "/abort")).toMatchObject({ status: 202, body: { status: "requested" } });
		expect(await app("GET", "/terminal")).toMatchObject({ status: 200, body: { screen: "screen text" } });
		expect(herdr).toEqual([
			// Each phone message reads the pane before its text and again before its Enter.
			["/fake/herdr", "pane", "read", "w7:p3", "--source", "visible", "--format", "ansi"],
			["/fake/herdr", "pane", "send-text", "w7:p3", "run the tests"],
			["/fake/herdr", "pane", "read", "w7:p3", "--source", "visible", "--format", "ansi"],
			["/fake/herdr", "pane", "send-keys", "w7:p3", "enter"],
			["/fake/herdr", "pane", "read", "w7:p3", "--source", "visible", "--format", "ansi"],
			["/fake/herdr", "pane", "send-text", "w7:p3", "and lint"],
			["/fake/herdr", "pane", "read", "w7:p3", "--source", "visible", "--format", "ansi"],
			["/fake/herdr", "pane", "send-keys", "w7:p3", "enter"],
			["/fake/herdr", "pane", "send-keys", "w7:p3", "esc"],
			["/fake/herdr", "pane", "read", "w7:p3", "--source", "visible", "--format", "ansi"],
		]);
		const started = Date.now();
		expect(await hook("Interrupt", { turn_id: "t1" })).toEqual([]);
		expect(Date.now() - started).toBeLessThan(1000);
		expect((await app("GET", "/state")).body).toMatchObject({ idle: true, lastOutcome: { outcome: "aborted" } });
	});

	it("answers a permission request from the phone exactly once and prints Codex's decision", async () => {
		const printed = hook("PermissionRequest", { tool_name: "Bash", tool_input: { command: "rm -rf dist", description: "Clean" }, turn_id: "t1", permission_mode: "default" });
		let id = "";
		await until(async () => { id = boundApprovals((await app("GET", "/state")).body.approvals)[0]?.id ?? ""; return !!id; });
		expect(id).toMatch(/^codex-[0-9a-f]{24}$/);
		expect(boundApprovals((await app("GET", "/state")).body.approvals)).toEqual([{ id, kind: "command", title: "Bash: rm -rf dist", detail: "rm -rf dist\n\nClean", choices: ["accept", "decline"] }]);
		expect(await app("POST", "/approval", { id, decision: "acceptForSession" })).toMatchObject({ status: 400 });
		expect(await app("POST", "/approval", { id, decision: "decline" })).toMatchObject({ status: 200, body: { status: "answered" } });
		expect(await app("POST", "/approval", { id, decision: "accept" })).toMatchObject({ status: 404 });
		expect((await printed).map((text) => JSON.parse(text))).toEqual([{ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "Declined from the mars-ram app." } } }]);
	});

	it("a hook process that goes away cancels its approval, leaving Codex's own prompt", async () => {
		const control = readCodexControl(paths, SESSION)!;
		const abort = new AbortController();
		const request = fetch(`http://127.0.0.1:${entry.port}/hook/PermissionRequest`, { method: "POST", signal: abort.signal, headers: { authorization: `Bearer ${control.hookToken}` }, body: JSON.stringify({ session_id: SESSION, tool_name: "mcp__fs__write", tool_input: { path: "/w/a" } }) }).catch(() => undefined);
		await until(async () => boundApprovals((await app("GET", "/state")).body.approvals).length === 1);
		expect(boundApprovals((await app("GET", "/state")).body.approvals)[0]).toMatchObject({ kind: "permission", title: "mcp__fs__write: /w/a" });
		abort.abort();
		await request;
		await until(async () => boundApprovals((await app("GET", "/state")).body.approvals).length === 0);
		expect(bridge.session.eventsSince(0).events.filter((e) => e.type === "approval_resolved")).toEqual([expect.objectContaining({ decision: "cancel" })]);
	});

	it("refuses a second bridge for the same session, and SessionEnd unpublishes everything quickly", async () => {
		expect(await runCodexBridge({ sessionId: SESSION, cwd: "/w", source: "resume", approvalTimeoutMs: 60_000 }, { paths, env: {}, permissions, pid: 424_242 })).toBeUndefined();
		const started = Date.now();
		expect(await hook("SessionEnd", { reason: "other" })).toEqual([]);
		expect(Date.now() - started).toBeLessThan(1000);
		await bridge.done;
		expect(readdirSync(paths.registryDir).filter((name) => name.endsWith(".json"))).toEqual([]);
		expect(readdirSync(paths.agentsDir)).toEqual([]);
		expect(readCodexControl(paths, SESSION)).toBeUndefined();
		expect(await hook("Stop", {})).toEqual([]);
	});

	it("without a rollout, builds the history from the hooks; outside Herdr it is read-only; it ends with Codex", async () => {
		await bridge.stop();
		let alive = true;
		const plain = (await runCodexBridge(
			{ sessionId: SESSION, cwd: "/w", source: "startup", approvalTimeoutMs: 60_000, codexPid: 99_999 },
			{ paths, env: {}, permissions, alive: (pid) => pid === 99_999 ? alive : true, pollMs: 20 },
		))!;
		entry = registryEntry();
		expect(sessionCapabilities(entry)).toEqual({ agent: "codex", capabilities: { message: false, steer: false, abort: false, attachments: false, terminal: false, approvals: true } });
		expect(await app("POST", "/message", { text: "hi" })).toMatchObject({ status: 404 });
		await hook("UserPromptSubmit", { transcript_path: null, prompt: "¿Cuántos zorros?" });
		await hook("Stop", { transcript_path: null, last_assistant_message: "Tres zorros." });
		const history = await app("GET", "/history");
		expect(decodeResponse(HistoryResponse, history.body).ok).toBe(true);
		expect((history.body.messages as { role: string; text: string }[]).map((m) => [m.role, m.text])).toEqual([["user", "¿Cuántos zorros?"], ["assistant", "Tres zorros."]]);
		alive = false;
		await plain.done;
		expect(existsSync(join(paths.agentsDir, `codex-${SESSION}.lock`))).toBe(false);
	}, 10_000);
});
