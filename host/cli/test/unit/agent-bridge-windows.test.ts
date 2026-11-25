// The Windows bridge launch (WMI, outside the hook's job), the bridge's environment carried in its config, the
// removal of a bridge's files when it ends, and the diagnostic log of hooks and bridges. Everything runs against
// fakes and a temporary home: nothing touches the real ~/.codex, ~/.claude or ~/.mars-ram, and no PowerShell runs.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FilePermissions, posixPermissions } from "@workspace/protocol/bridge-host";
import type { BridgePaths, ControlRecord } from "../../src/adapters/agent-bridge.ts";
import { agentLogPath, appendAgentLog, formatAgentLogLine } from "../../src/adapters/agent-log.ts";
import { bridgeCommandLine, bridgeEnvironment, createWmiLauncher, launchBridge, pickBridgeEnv, WMI_CREATE_SCRIPT } from "../../src/adapters/bridge-launch.ts";
import { type ClaudeBridgeConfig, decodeBridgeConfig, encodeBridgeConfig } from "../../src/adapters/claude-bridge.ts";
import { type CodexBridgeConfig, decodeCodexBridgeConfig, encodeCodexBridgeConfig, runCodexBridge } from "../../src/adapters/codex-bridge.ts";
import { type CodexHookIO, defaultCodexHookIO, runCodexHook } from "../../src/adapters/codex-hook-client.ts";

const SESSION = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d";
const NODE = "C:\\Program Files\\nodejs\\node.exe";
const MAIN = "C:\\Users\\Mars Ram\\.mars-ram\\cli\\src\\main.ts";
const HOME = "C:\\Users\\Mars Ram";
const permissions: FilePermissions = process.platform === "win32" ? { restrictDirectory: () => {}, restrictFile: () => {} } : posixPermissions;
const PANE_ENV = { HERDR_PANE_ID: "w2G:p2", HERDR_BIN_PATH: "C:\\Program Files\\Herdr\\herdr.exe", HERDR_SOCKET_PATH: "\\\\.\\pipe\\herdr-mars", PI_BRIDGE_REGISTRY_DIR: "C:\\Users\\Mars Ram\\.pi-bridges" };
const HOOK_ENV = { ...PANE_ENV, OPENAI_API_KEY: "sk-secret", PATH: "C:\\Windows", CODEX_HOME: "C:\\x" };

const decodeLine = (line: string) => {
	const encoded = line.split(" ").at(-1)!;
	return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;
};


/** A live bridge's control record, as the bridge publishes it: inside its session lock's marker. */
function writeControl(agentsDir: string, prefix: string, session: string, control: { pid: number }): string {
	const lock = join(agentsDir, `${prefix}-${session}.lock`);
	mkdirSync(lock, { recursive: true });
	writeFileSync(join(lock, `${control.pid}-${"a".repeat(16)}`), JSON.stringify(control));
	return lock;
}

describe("Windows bridge launch", () => {
	it("builds the bridge command line with both paths double-quoted, and refuses what CreateProcess or cmd could change", () => {
		expect(bridgeCommandLine(NODE, MAIN, "codex", "eyJh_-")).toBe(`"${NODE}" --disable-warning=ExperimentalWarning "${MAIN}" bridge codex eyJh_-`);
		expect(bridgeCommandLine("\\\\server\\share\\node.exe", MAIN, "claude", "e30")).toBe(`"\\\\server\\share\\node.exe" --disable-warning=ExperimentalWarning "${MAIN}" bridge claude e30`);
		for (const [node, main, agent, encoded] of [
			["node.exe", MAIN, "codex", "e30"],
			["C:\\a\"b\\node.exe", MAIN, "codex", "e30"],
			[NODE, "C:\\100%\\main.ts", "codex", "e30"],
			[NODE, "C:\\hola!\\main.ts", "codex", "e30"],
			[NODE, "C:\\dir\\", "codex", "e30"],
			[NODE, "C:\\a\nb\\main.ts", "codex", "e30"],
			[NODE, MAIN, "co dex", "e30"],
			[NODE, MAIN, "codex", "e30 & calc"],
			[NODE, MAIN, "codex", ""],
		] as const) expect(bridgeCommandLine(node, main, agent, encoded)).toBeUndefined();
	});

	it("keeps only the Herdr and registry variables the bridge reads, never secrets or unsafe values", () => {
		expect(pickBridgeEnv(HOOK_ENV)).toEqual(PANE_ENV);
		expect(pickBridgeEnv({ PATH: "x" })).toBeUndefined();
		expect(pickBridgeEnv({ HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: "a\0b", HERDR_SOCKET_PATH: "x".repeat(5000) })).toEqual({ HERDR_PANE_ID: "w1:p1" });
		// The bridge's environment: the config's variables over its own.
		expect(bridgeEnvironment({ PATH: "p", HERDR_PANE_ID: "old" }, { HERDR_PANE_ID: "w1:p1" })).toEqual({ PATH: "p", HERDR_PANE_ID: "w1:p1" });
		const own = { PATH: "p" };
		expect(bridgeEnvironment(own, undefined)).toBe(own);
	});

	it("on Windows creates the bridge through WMI with the pane's variables in its config, and returns its pid", async () => {
		const wmi: [string, string][] = [];
		const spawned: unknown[] = [];
		const launch = await launchBridge("codex", (env) => encodeCodexBridgeConfig({ sessionId: SESSION, cwd: "C:\\w", source: "startup", approvalTimeoutMs: 60_000, ...(env ? { env } : {}) }), HOME, {
			platform: "win32", execPath: NODE, main: MAIN, env: HOOK_ENV,
			wmi: async (commandLine, cwd) => { wmi.push([commandLine, cwd]); return { ok: true, pid: 4321 }; },
			spawn: (...args) => { spawned.push(args); return 1; },
		});
		expect(launch).toEqual({ method: "wmi", pid: 4321 });
		expect(spawned).toEqual([]);
		expect(wmi).toHaveLength(1);
		const [commandLine, cwd] = wmi[0]!;
		expect(cwd).toBe(HOME);
		expect(commandLine.startsWith(`"${NODE}" --disable-warning=ExperimentalWarning "${MAIN}" bridge codex `)).toBe(true);
		const config = decodeLine(commandLine);
		expect(config.env).toEqual(PANE_ENV);
		expect(JSON.stringify(config)).not.toContain("sk-secret");
		expect(decodeCodexBridgeConfig(commandLine.split(" ").at(-1)!)).toMatchObject({ sessionId: SESSION, env: PANE_ENV });
	});

	it("falls back to the detached spawn when WMI fails or the paths are unsafe, saying why", async () => {
		for (const [wmiResult, main, expected] of [
			[{ ok: false, error: "WMI returned 9" }, MAIN, "WMI returned 9"],
			[{ ok: true, pid: 4321 }, "C:\\100%\\main.ts", "unsafe"],
		] as const) {
			const spawned: [string, string[], string][] = [];
			let wmiCalls = 0;
			const launch = await launchBridge("claude", (env) => `cfg${env ? "-env" : ""}`, HOME, {
				platform: "win32", execPath: NODE, main, env: HOOK_ENV,
				wmi: async () => { wmiCalls++; return wmiResult; },
				spawn: (file, args, cwd) => { spawned.push([file, args, cwd]); return 777; },
			});
			expect(launch).toMatchObject({ method: "spawn", pid: 777 });
			expect(launch.error).toContain(expected);
			expect(wmiCalls).toBe(main === MAIN ? 1 : 0);
			expect(spawned).toEqual([[NODE, ["--disable-warning=ExperimentalWarning", main, "bridge", "claude", "cfg-env"], HOME]]);
		}
	});

	it("a thrown WMI call also falls back", async () => {
		const launch = await launchBridge("codex", () => "e30", HOME, { platform: "win32", execPath: NODE, main: MAIN, env: {}, wmi: async () => { throw new Error("boom"); }, spawn: () => 5 });
		expect(launch).toMatchObject({ method: "spawn", pid: 5, error: "boom" });
	});

	it("elsewhere keeps today's detached spawn and does not put the environment in the config", async () => {
		const spawned: [string, string[], string][] = [];
		let wmiCalls = 0;
		const launch = await launchBridge("codex", (env) => (env ? "with-env" : "e30"), "/home/m", {
			platform: "linux", execPath: "/usr/bin/node", main: "/home/m/.mars-ram/cli/src/main.ts", env: HOOK_ENV,
			wmi: async () => { wmiCalls++; return { ok: true, pid: 1 }; },
			spawn: (file, args, cwd) => { spawned.push([file, args, cwd]); return 99; },
		});
		expect(launch).toEqual({ method: "spawn", pid: 99 });
		expect(wmiCalls).toBe(0);
		expect(spawned).toEqual([["/usr/bin/node", ["--disable-warning=ExperimentalWarning", "/home/m/.mars-ram/cli/src/main.ts", "bridge", "codex", "e30"], "/home/m"]]);
	});

	it("the WMI launcher runs a fixed CIM script with the command line and folder in variables, and reads the pid", async () => {
		const runs: { script: string; vars: Record<string, string>; timeoutMs: number }[] = [];
		let reply: { ok: true; stdout: string } | { ok: false; error: string } = { ok: true, stdout: "noise\r\n0|4321\r\n" };
		const wmi = createWmiLauncher(async (script, vars, timeoutMs) => { runs.push({ script, vars, timeoutMs }); return reply; });
		expect(await wmi(`"${NODE}" x`, HOME)).toEqual({ ok: true, pid: 4321 });
		expect(runs[0]!.script).toBe(WMI_CREATE_SCRIPT);
		expect(WMI_CREATE_SCRIPT).toContain("Invoke-CimMethod -ClassName Win32_Process -MethodName Create");
		expect(WMI_CREATE_SCRIPT).not.toContain(NODE);
		expect(runs[0]!.vars).toEqual({ MARS_RAM_BRIDGE_COMMAND_LINE: `"${NODE}" x`, MARS_RAM_BRIDGE_CWD: HOME });
		expect(runs[0]!.timeoutMs).toBeLessThanOrEqual(6000);
		reply = { ok: true, stdout: "9|\r\n" };
		expect(await wmi("x", HOME)).toEqual({ ok: false, error: "WMI returned 9" });
		reply = { ok: true, stdout: "garbage" };
		expect(await wmi("x", HOME)).toMatchObject({ ok: false });
		reply = { ok: false, error: "timed out" };
		expect(await wmi("x", HOME)).toEqual({ ok: false, error: "timed out" });
	});

	it("both bridge configs carry the environment and refuse unknown or unsafe variables", () => {
		const codex: CodexBridgeConfig = { sessionId: SESSION, cwd: "C:\\w", source: "startup", approvalTimeoutMs: 60_000, env: PANE_ENV };
		expect(decodeCodexBridgeConfig(encodeCodexBridgeConfig(codex))).toEqual(codex);
		const claude: ClaudeBridgeConfig = { sessionId: SESSION, transcriptPath: "/a/t.jsonl", cwd: "/w", source: "startup", approvalTimeoutMs: 60_000, env: { HERDR_PANE_ID: "w1:p1" } };
		expect(decodeBridgeConfig(encodeBridgeConfig(claude))).toEqual(claude);
		for (const env of [{ OPENAI_API_KEY: "x" }, { HERDR_PANE_ID: "a\nb" }, { HERDR_PANE_ID: 3 }, ["w1:p1"], "w1:p1"]) {
			expect(decodeCodexBridgeConfig(encodeCodexBridgeConfig({ ...codex, env } as unknown as CodexBridgeConfig))).toBeUndefined();
			expect(decodeBridgeConfig(encodeBridgeConfig({ ...claude, env } as unknown as ClaudeBridgeConfig))).toBeUndefined();
		}
	});
});

describe("agent hooks log", () => {
	let home: string;
	beforeEach(() => { home = realpathSync(mkdtempSync(join(tmpdir(), "mr-agent-log-"))); });
	afterEach(() => { rmSync(home, { recursive: true, force: true }); });

	it("writes one line with the time, agent, event, outcome, pids and a bounded error with no paths or tokens", () => {
		const line = formatAgentLogLine({ agent: "codex", event: "SessionStart", outcome: "bridge-ready", pid: 12, bridgePid: 34, method: "wmi", error: `Could not restrict access to C:\\Users\\Mars\\.mars-ram\\agents\\x.json: token ${"a1".repeat(32)}\nsecond line /home/m/.codex/sessions/r.jsonl` }, new Date("2026-11-23T10:00:00.000Z"));
		expect(line.endsWith("\n")).toBe(true);
		expect(line.split("\n")).toHaveLength(2);
		expect(line.startsWith("2026-11-23T10:00:00.000Z agent=codex event=SessionStart outcome=bridge-ready pid=12 bridge=34 method=wmi error=")).toBe(true);
		expect(line).not.toContain("Users");
		expect(line).not.toContain(".codex");
		expect(line).not.toContain("a1a1a1a1");
		expect(line.length).toBeLessThan(400);
		expect(formatAgentLogLine({ agent: "co dex", event: "x\ny", outcome: "ok" }, new Date(0))).toBe("1970-01-01T00:00:00.000Z agent=? event=? outcome=ok\n");
	});

	it("appends under ~/.mars-ram/logs, rotates past the size limit and never throws", () => {
		const path = agentLogPath(home);
		expect(path).toBe(join(home, ".mars-ram", "logs", "agent-hooks.log"));
		for (let i = 0; i < 5; i++) appendAgentLog(path, { agent: "claude", event: "Stop", outcome: "forwarded", pid: i }, { maxBytes: 200 });
		expect(existsSync(`${path}.1`)).toBe(true);
		expect(statSync(path).size).toBeLessThanOrEqual(200);
		expect(readFileSync(path, "utf8")).toContain("pid=4");
		const blocked = join(home, "file");
		writeFileSync(blocked, "");
		expect(() => appendAgentLog(join(blocked, "logs", "agent-hooks.log"), { agent: "codex", event: "Stop", outcome: "x" })).not.toThrow();
	});
});

describe("hooks and bridges on Windows: logging and cleanup", () => {
	let home: string;
	let paths: BridgePaths;
	beforeEach(() => {
		home = realpathSync(mkdtempSync(join(tmpdir(), "mr-agent-win-")));
		paths = { registryDir: join(home, ".mars-ram/bridges"), agentsDir: join(home, ".mars-ram/agents") };
	});
	afterEach(() => { rmSync(home, { recursive: true, force: true }); });

	const fakeIO = (logs: Record<string, unknown>[], stdin: Record<string, unknown>, control?: () => void): CodexHookIO => ({
		stdin: async () => JSON.stringify({ session_id: SESSION, cwd: "/w", transcript_path: "/home/m/.codex/sessions/secret-rollout.jsonl", prompt: "mi clave es hunter2", ...stdin }),
		stdout: async () => {},
		paths,
		alive: (pid) => pid !== 999_999,
		hostConfig: () => undefined,
		codexPid: async () => undefined,
		spawnBridge: async () => ({ method: "wmi", pid: 4321 }),
		post: async () => ({}),
		sleep: async () => { control?.(); },
		log: (entry) => { logs.push(entry); },
	});

	it("each hook run logs one line with its outcome, and never the prompt or the transcript path", async () => {
		const logs: Record<string, unknown>[] = [];
		const control: ControlRecord = { version: 1, pid: 4321, port: 50001, hookToken: "h".repeat(64), bridgeInstanceId: "inst" };
		mkdirSync(paths.agentsDir, { recursive: true });
		await runCodexHook("SessionStart", fakeIO(logs, { source: "startup" }, () => { writeControl(paths.agentsDir, "codex", SESSION, control); }));
		await runCodexHook("UserPromptSubmit", fakeIO(logs, {}));
		rmSync(join(paths.agentsDir, `codex-${SESSION}.lock`), { recursive: true });
		await runCodexHook("Stop", fakeIO(logs, {}));
		expect(logs.map(({ event, outcome, bridgePid, method }) => ({ event, outcome, bridgePid, method }))).toEqual([
			{ event: "SessionStart", outcome: "bridge-ready", bridgePid: 4321, method: "wmi" },
			{ event: "UserPromptSubmit", outcome: "forwarded", bridgePid: 4321, method: undefined },
			{ event: "Stop", outcome: "no-bridge", bridgePid: undefined, method: undefined },
		]);
		expect(logs.every((entry) => entry.agent === "codex" && entry.pid === process.pid)).toBe(true);
		expect(JSON.stringify(logs)).not.toMatch(/hunter2|secret-rollout|hhhh/);
	});

	it("SessionStart logs a bridge that never came up, with the launch's error", async () => {
		const logs: Record<string, unknown>[] = [];
		const io = fakeIO(logs, {});
		io.spawnBridge = async () => ({ method: "spawn", pid: 77, error: "WMI returned 9" });
		await runCodexHook("SessionStart", io);
		expect(logs).toEqual([{ agent: "codex", event: "SessionStart", outcome: "bridge-not-ready", pid: process.pid, bridgePid: 77, method: "spawn", error: "WMI returned 9" }]);
	});

	it("the default hook IO writes its lines to the home's log", async () => {
		const io: CodexHookIO = { ...defaultCodexHookIO(home), paths, stdin: async () => JSON.stringify({ session_id: SESSION, prompt: "hunter2" }) };
		await runCodexHook("Stop", io);
		const text = readFileSync(agentLogPath(home), "utf8");
		expect(text).toMatch(/ agent=codex event=Stop outcome=no-bridge pid=\d+\n$/);
		expect(text).not.toContain("hunter2");
	});

	it("SessionStart and SessionEnd remove what bridges killed without warning left behind (registry entry, control record)", async () => {
		const bridge = (await runCodexBridge({ sessionId: SESSION, cwd: "/w", source: "startup", approvalTimeoutMs: 60_000 }, { paths, env: {}, permissions }))!;
		const [name] = readdirSync(paths.registryDir).filter((file) => file.endsWith(".json"));
		const live = JSON.parse(readFileSync(join(paths.registryDir, name!), "utf8")) as Record<string, unknown>;
		// A second, hard-killed bridge (its pid no longer runs): its files stay as it left them.
		const deadId = "0b9d6d0e-8d0a-4a4e-9f0e-000000000001";
		writeFileSync(join(paths.registryDir, `${deadId}.json`), JSON.stringify({ ...live, bridgeInstanceId: deadId, pid: 999_999 }));
		writeFileSync(join(paths.agentsDir, "codex-dead-session.json"), JSON.stringify({ version: 1, pid: 999_999, port: 1, hookToken: "t".repeat(64), bridgeInstanceId: deadId }));
		writeFileSync(join(paths.agentsDir, "notes.txt"), "not ours");
		const logs: Record<string, unknown>[] = [];
		await runCodexHook("SessionEnd", { ...fakeIO(logs, { reason: "other" }), post: async () => { await bridge.stop("session-end"); return {}; } });
		expect(readdirSync(paths.registryDir)).toEqual([]);
		expect(readdirSync(paths.agentsDir)).toEqual(["notes.txt"]);
	});

	it("stopping removes the registry entry even when Windows keeps it busy for a moment, and logs start and exit", async () => {
		const failures = new Map<string, number>();
		const logs: Record<string, unknown>[] = [];
		const bridge = (await runCodexBridge({ sessionId: SESSION, cwd: "/w", source: "startup", approvalTimeoutMs: 60_000 }, {
			paths, env: {}, permissions,
			remove: (path) => {
				const count = failures.get(path) ?? 0;
				if (count < 2) { failures.set(path, count + 1); throw Object.assign(new Error("busy"), { code: "EBUSY" }); }
				rmSync(path, { force: true });
			},
			log: (entry) => { logs.push(entry); },
		}))!;
		await bridge.stop("session-end");
		await bridge.done;
		expect(readdirSync(paths.registryDir).filter((file) => file.endsWith(".json"))).toEqual([]);
		expect(readdirSync(paths.agentsDir)).toEqual([]);
		expect(logs).toEqual([
			{ agent: "codex", event: "bridge-start", outcome: "started", pid: process.pid },
			{ agent: "codex", event: "bridge-exit", outcome: "session-end", pid: process.pid },
		]);
	});

	it("removeFiles (the exit handler) takes the entry, control record and lock away synchronously", async () => {
		const bridge = (await runCodexBridge({ sessionId: SESSION, cwd: "/w", source: "startup", approvalTimeoutMs: 60_000 }, { paths, env: {}, permissions }))!;
		bridge.removeFiles();
		expect(readdirSync(paths.registryDir).filter((file) => file.endsWith(".json"))).toEqual([]);
		expect(readdirSync(paths.agentsDir)).toEqual([]);
		await bridge.stop();
	});
});
