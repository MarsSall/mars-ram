// Contract-style: the real Claude Code bridge (HTTP/SSE server, registry, hook channel, transcript tail) in this
// process, against an invented transcript file and a fake Herdr, in a temporary home. The hook side is the real
// `mars-ram hook claude` client with its stdin replaced. Nothing touches the real ~/.claude or ~/.mars-ram.
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boundApprovals, decodeEvent, decodeRegistryEntry, decodeResponse, HistoryResponse, type RegistryEntry, sessionCapabilities, StateResponse } from "@workspace/protocol";
import { type FilePermissions, posixPermissions, type TerminalExecFile } from "@workspace/protocol/bridge-host";
import { type BridgePaths, readControl, type RunningClaudeBridge, runClaudeBridge } from "../../src/adapters/claude-bridge.ts";
import { defaultHookIO, runClaudeHook } from "../../src/adapters/claude-hook-client.ts";

const SESSION = "0b7e9a52-2222-4d1c-8f3a-000000000002";
const permissions: FilePermissions = process.platform === "win32" ? { restrictDirectory: () => {}, restrictFile: () => {} } : posixPermissions;
const line = (value: unknown) => `${JSON.stringify(value)}\n`;

let home: string;
let paths: BridgePaths;
let transcript: string;
let herdr: string[][];
let bridge: RunningClaudeBridge;
let entry: RegistryEntry;

const app = async (method: string, path: string, body?: unknown, token = entry.token) => {
	const res = await fetch(`http://127.0.0.1:${entry.port}${path}`, { method, headers: { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
	return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const hook = async (event: string, payload: Record<string, unknown>) => {
	const out: string[] = [];
	await runClaudeHook(event, { ...defaultHookIO(home), paths, stdin: async () => JSON.stringify({ session_id: SESSION, hook_event_name: event, ...payload }), stdout: async (text) => { out.push(text); } });
	return out;
};
const until = async (check: () => Promise<boolean> | boolean) => {
	for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise((r) => setTimeout(r, 10)); }
	throw new Error("timed out");
};

beforeEach(async () => {
	home = realpathSync(mkdtempSync(join(tmpdir(), "mr-claude-bridge-")));
	paths = { registryDir: join(home, ".mars-ram/bridges"), agentsDir: join(home, ".mars-ram/agents") };
	transcript = join(home, "transcript.jsonl");
	writeFileSync(transcript, line({ type: "user", uuid: "u-old", message: { role: "user", content: "Earlier question about zorros" } }) + line({ type: "assistant", uuid: "a-old", message: { model: "claude-invented-2", content: [{ type: "text", text: "Earlier answer" }] } }));
	herdr = [];
	const run: TerminalExecFile = (file, args, options, callback) => { expect(options.shell).toBe(false); herdr.push([file, ...args]); callback(null, "screen text", ""); };
	const started = await runClaudeBridge(
		{ sessionId: SESSION, transcriptPath: transcript, cwd: "/work/zorro", source: "startup", approvalTimeoutMs: 60_000 },
		{ paths, env: { HERDR_PANE_ID: "w7:p3", HERDR_BIN_PATH: "/fake/herdr" }, permissions, herdr: run, pollMs: 20 },
	);
	bridge = started!;
	const names = readdirSync(paths.registryDir).filter((name) => name.endsWith(".json"));
	expect(names).toHaveLength(1);
	const decoded = decodeRegistryEntry(JSON.parse(readFileSync(join(paths.registryDir, names[0]!), "utf8")));
	if (!decoded.ok) throw new Error(decoded.errors.join("; "));
	entry = decoded.value;
});

afterEach(async () => {
	await bridge?.stop();
	rmSync(home, { recursive: true, force: true });
});

describe("Claude Code bridge contract", () => {
	it("publishes a private registry entry for agent claude-code with pane capabilities", () => {
		expect(entry).toMatchObject({ sessionId: SESSION, cwd: "/work/zorro", pid: process.pid, agent: "claude-code" });
		expect(sessionCapabilities(entry)).toEqual({ agent: "claude-code", capabilities: { message: true, steer: true, abort: true, attachments: false, terminal: true, approvals: true } });
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
		const control = readControl(paths, SESSION)!;
		expect(control.hookToken).not.toBe(entry.token);
	});

	it("serves state and the transcript history in the protocol shapes", async () => {
		const state = await app("GET", "/state");
		expect(decodeResponse(StateResponse, state.body).ok).toBe(true);
		expect(state.body).toMatchObject({ idle: true, terminal: true, terminalPane: "w7:p3", agent: "claude-code", model: { id: "claude-invented-2" } });
		const history = await app("GET", "/history");
		expect(decodeResponse(HistoryResponse, history.body).ok).toBe(true);
		expect((history.body.messages as { role: string; text: string }[]).map((m) => [m.role, m.text])).toEqual([["user", "Earlier question about zorros"], ["assistant", "Earlier answer"]]);
	});

	it("keeps the app's routes and the hook channel apart, each behind its own token", async () => {
		const control = readControl(paths, SESSION)!;
		expect((await app("GET", "/state", undefined, control.hookToken)).status).toBe(401);
		expect((await app("POST", "/hook/Stop", {}, entry.token)).status).toBe(401);
		expect((await app("POST", "/hook/Stop", { session_id: "other-session" }, control.hookToken)).status).toBe(400);
		expect((await app("POST", "/hook/PreToolUse", {}, control.hookToken)).status).toBe(400);
		expect((await app("GET", "/state", undefined, "x".repeat(64))).status).toBe(401);
	});

	it("streams hook state and live transcript lines as protocol events", async () => {
		const res = await fetch(`http://127.0.0.1:${entry.port}/events?since=0`, { headers: { authorization: `Bearer ${entry.token}` } });
		const reader = res.body!.getReader();
		let text = "";
		const events = () => text.split("\n\n").filter((chunk) => chunk.startsWith("id: ")).map((chunk) => JSON.parse(chunk.slice(chunk.indexOf("data: ") + 6)));
		const pump = (async () => { for (;;) { const { value, done } = await reader.read(); if (done) return; text += new TextDecoder().decode(value); } })();
		expect(await hook("UserPromptSubmit", { prompt: "Count the zorros" })).toEqual([]);
		appendFileSync(transcript, line({ type: "user", uuid: "u-1", message: { role: "user", content: "Count the zorros" } }));
		appendFileSync(transcript, line({ type: "assistant", uuid: "a-1", message: { content: [{ type: "tool_use", id: "toolu_z", name: "Grep" }] } }));
		appendFileSync(transcript, line({ type: "user", uuid: "u-2", message: { content: [{ type: "tool_result", tool_use_id: "toolu_z", content: "3 matches" }] } }));
		appendFileSync(transcript, line({ type: "assistant", uuid: "a-2", message: { content: [{ type: "text", text: "Three zorros." }] } }).slice(0, 20));
		await until(() => events().some((e) => e.type === "tool_end"));
		appendFileSync(transcript, line({ type: "assistant", uuid: "a-2", message: { content: [{ type: "text", text: "Three zorros." }] } }).slice(20));
		await until(() => events().some((e) => e.type === "message_end" && e.message.role === "assistant"));
		expect(await hook("Stop", { last_assistant_message: "Three zorros." })).toEqual([]);
		await until(() => events().some((e) => e.type === "agent_settled"));
		await reader.cancel();
		await pump.catch(() => {});
		for (const event of events()) expect(decodeEvent(event).kind).toBe("known");
		expect(events().map((e) => e.type)).toEqual(["session_start", "agent_start", "message_start", "message_end", "tool_start", "tool_end", "message_start", "message_end", "agent_end", "agent_settled"]);
		expect(events().at(-1)).toMatchObject({ aborted: false, outcome: "completed" });
	});

	it("types messages into the session's pane and stops with Escape", async () => {
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
		appendFileSync(transcript, line({ type: "user", uuid: "u-int", message: { content: [{ type: "text", text: "[Request interrupted by user]" }] } }));
		await until(async () => (await app("GET", "/state")).body.idle === true);
		expect((await app("GET", "/state")).body.lastOutcome).toMatchObject({ outcome: "aborted" });
	});

	it("answers a permission request from the phone exactly once and prints Claude Code's decision", async () => {
		const printed = hook("PermissionRequest", { tool_name: "Bash", tool_input: { command: "rm -rf dist" } });
		let id = "";
		await until(async () => { const approvals = boundApprovals((await app("GET", "/state")).body.approvals); id = approvals[0]?.id ?? ""; return !!id; });
		expect(boundApprovals((await app("GET", "/state")).body.approvals)).toEqual([{ id, kind: "command", title: "Bash: rm -rf dist", detail: "rm -rf dist", choices: ["accept", "decline"] }]);
		expect(await app("POST", "/approval", { id, decision: "cancel" })).toMatchObject({ status: 400 });
		expect(await app("POST", "/approval", { id, decision: "accept" })).toMatchObject({ status: 200, body: { status: "answered" } });
		expect(await app("POST", "/approval", { id, decision: "decline" })).toMatchObject({ status: 404 });
		expect((await printed).map((text) => JSON.parse(text))).toEqual([{ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } }]);
		const resolved = bridge.session.eventsSince(0).events.filter((e) => e.type === "approval_resolved");
		expect(resolved).toEqual([expect.objectContaining({ id, decision: "accept" })]);
	});

	it("the hook channel requires the Bearer scheme too, and a refused hook changes nothing", async () => {
		const control = readControl(paths, SESSION)!;
		const before = bridge.session.eventsSince(0).events.length;
		for (const authorization of [control.hookToken, `Basic ${control.hookToken}`, `bearer ${control.hookToken}`]) {
			const res = await fetch(`http://127.0.0.1:${entry.port}/hook/UserPromptSubmit`, { method: "POST", headers: { authorization }, body: JSON.stringify({ session_id: SESSION }) });
			expect(res.status).toBe(401);
		}
		expect(bridge.session.eventsSince(0).events).toHaveLength(before);
		const ok = await fetch(`http://127.0.0.1:${entry.port}/hook/UserPromptSubmit`, { method: "POST", headers: { authorization: `Bearer ${control.hookToken}` }, body: JSON.stringify({ session_id: SESSION }) });
		expect(ok.status).toBe(200);
	});

	it("a hook process that goes away cancels its approval, leaving Claude Code's own prompt", async () => {
		const control = readControl(paths, SESSION)!;
		// Claude Code asks for permission during a run.
		const submitted = await fetch(`http://127.0.0.1:${entry.port}/hook/UserPromptSubmit`, { method: "POST", headers: { authorization: `Bearer ${control.hookToken}` }, body: JSON.stringify({ session_id: SESSION }) });
		expect(submitted.status).toBe(200);
		const abort = new AbortController();
		const request = fetch(`http://127.0.0.1:${entry.port}/hook/PermissionRequest`, { method: "POST", signal: abort.signal, headers: { authorization: `Bearer ${control.hookToken}` }, body: JSON.stringify({ session_id: SESSION, tool_name: "Write", tool_input: { file_path: "/w/a" } }) }).catch(() => undefined);
		await until(async () => boundApprovals((await app("GET", "/state")).body.approvals).length === 1);
		abort.abort();
		await request;
		await until(async () => boundApprovals((await app("GET", "/state")).body.approvals).length === 0);
		expect(bridge.session.eventsSince(0).events.filter((e) => e.type === "approval_resolved")).toEqual([expect.objectContaining({ decision: "cancel" })]);
		// Claude Code now asks in its terminal: the session keeps showing that, and phone messages stay out of it.
		expect((await app("GET", "/state")).body.pendingPrompt).toMatchObject({ kind: "confirm" });
		expect(bridge.session.eventsSince(0).events.some((e) => e.type === "prompt_end")).toBe(false);
	});

	it("refuses a second bridge for the same session, and SessionEnd unpublishes everything", async () => {
		expect(await runClaudeBridge({ sessionId: SESSION, transcriptPath: transcript, cwd: "/w", source: "resume", approvalTimeoutMs: 60_000 }, { paths, env: {}, permissions, pid: 424_242 })).toBeUndefined();
		expect(await hook("SessionEnd", { reason: "exit" })).toEqual([]);
		await bridge.done;
		expect(readdirSync(paths.registryDir).filter((name) => name.endsWith(".json"))).toEqual([]);
		expect(readdirSync(paths.agentsDir)).toEqual([]);
		expect(readControl(paths, SESSION)).toBeUndefined();
		expect(await hook("Stop", {})).toEqual([]);
	});

	it("ends when the Claude Code process is gone", async () => {
		await bridge.stop();
		let alive = true;
		const watched = (await runClaudeBridge(
			{ sessionId: SESSION, transcriptPath: join(home, "missing.jsonl"), cwd: "/w", source: "startup", approvalTimeoutMs: 60_000, claudePid: 99_999 },
			{ paths, env: {}, permissions, alive: (pid) => pid === 99_999 ? alive : true, pollMs: 20 },
		))!;
		expect(watched.session.state().terminal).toBe(false);
		alive = false;
		await watched.done;
		expect(existsSync(join(paths.agentsDir, `claude-${SESSION}.lock`))).toBe(false);
	}, 10_000);
});
