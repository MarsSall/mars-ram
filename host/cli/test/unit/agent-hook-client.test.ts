// The hook process and the session's control record, with real bridges in this process and injected process
// identities: a crashed bridge's leftovers never block or hijack the session's next bridge, whether the cleanup
// races the replacement (L32 finding 4) or the dead bridge's pid now belongs to another process (L32 finding 5).
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AgentBridgeSpec, type BridgePaths, pruneAgentFiles, readAgentControl, type RunningAgentBridge, runAgentBridge } from "../../src/adapters/agent-bridge.ts";
import { type AgentHookSpec, type BaseHookIO, post, runAgentHook } from "../../src/adapters/agent-hook-client.ts";
import type { AgentLogEntry } from "../../src/adapters/agent-log.ts";

const SESSION = "s1";
let dir: string;
let paths: BridgePaths;
let running: RunningAgentBridge[];
/** Pids that run, and each one's start time (absent: unreadable). */
let live: Set<number>;
let starts: Map<number, string>;
let received: { bridge: number; event: string }[];

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "agent-hook-"));
	paths = { registryDir: join(dir, "bridges"), agentsDir: join(dir, "agents") };
	running = [];
	live = new Set();
	starts = new Map();
	received = [];
});
afterEach(async () => {
	for (const bridge of running.reverse()) await bridge.stop();
	rmSync(dir, { recursive: true, force: true });
});

const alive = (pid: number) => live.has(pid);
const startTime = (pid: number) => starts.get(pid);

/** A bridge whose hooks only record which bridge got which event. */
const spec = (bridge: number): AgentBridgeSpec => ({
	agent: "claude-code",
	prefix: "claude",
	provider: "anthropic",
	isEvent: () => true,
	parser: () => () => [],
	hooks: () => async (event) => { received.push({ bridge, event }); return {}; },
});

/** Starts a bridge as process `pid`, with its own registry folder so a cleanup can be given an empty one. */
async function bridge(pid: number): Promise<RunningAgentBridge | undefined> {
	const started = await runAgentBridge(spec(pid), { sessionId: SESSION, cwd: dir, source: "startup", approvalTimeoutMs: 1000 }, {
		paths: { registryDir: join(dir, `bridges-${pid}`), agentsDir: paths.agentsDir },
		env: {},
		permissions: { restrictDirectory: () => {}, restrictFile: () => {} },
		alive,
		startTime,
		pid,
	});
	if (started) running.push(started);
	return started;
}

type Snapshot = Map<string, string | null>;
/** Every folder (null) and file (its text) under the agents folder. */
function snapshot(root = paths.agentsDir, into: Snapshot = new Map()): Snapshot {
	for (const name of readdirSync(root)) {
		const path = join(root, name);
		if (statSync(path).isDirectory()) { into.set(relative(paths.agentsDir, path), null); snapshot(path, into); }
		else into.set(relative(paths.agentsDir, path), readFileSync(path, "utf8"));
	}
	return into;
}
function restore(state: Snapshot): void {
	rmSync(paths.agentsDir, { recursive: true, force: true });
	mkdirSync(paths.agentsDir);
	for (const [path, text] of state) {
		if (text === null) mkdirSync(join(paths.agentsDir, path), { recursive: true });
		else writeFileSync(join(paths.agentsDir, path), text);
	}
}

type IO = BaseHookIO<Record<string, never>> & { startTime(pid: number): string | undefined };
const hookSpec: AgentHookSpec<Record<string, never>, IO> = {
	prefix: "claude",
	isEvent: () => true,
	startConfig: async () => ({}),
	body: (payload) => payload,
	forwardTimeoutMs: () => 3000,
};

/** Runs one hook; what it logged. `launch` is what SessionStart's spawnBridge does. */
async function hook(event: string, launch: () => Promise<number | undefined> = async () => undefined): Promise<{ log: AgentLogEntry; launches: number }> {
	const logs: AgentLogEntry[] = [];
	let launches = 0;
	const io: IO = {
		stdin: async () => JSON.stringify({ session_id: SESSION, hook_event_name: event }),
		stdout: async () => {},
		paths: { registryDir: join(dir, "bridges-empty"), agentsDir: paths.agentsDir },
		alive,
		startTime,
		hostConfig: () => ({}),
		spawnBridge: async () => { launches++; const pid = await launch(); return { method: "spawn", ...(pid === undefined ? {} : { pid }) }; },
		post,
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5))),
		log: (entry) => logs.push(entry),
	};
	await runAgentHook(hookSpec, event, io);
	return { log: logs[0]!, launches };
}

describe("stale control-record cleanup (L32 finding 4)", () => {
	it("a cleanup that judged the old bridge dead, paused while a replacement started, keeps the replacement's record", async () => {
		live.add(100).add(process.pid);
		starts.set(100, "1000");
		expect(await bridge(100)).toBeTruthy();
		const crashed = snapshot();
		live.delete(100);
		live.add(200);
		starts.set(200, "2000");
		expect(await bridge(200)).toBeTruthy();
		const replaced = snapshot();

		// The cleanup reads the crashed bridge's files; the replacement publishes its own before it removes anything.
		restore(crashed);
		let swapped = false;
		pruneAgentFiles({ registryDir: join(dir, "bridges-empty"), agentsDir: paths.agentsDir }, (pid) => {
			if (!swapped) { swapped = true; restore(replaced); return false; }
			return alive(pid);
		});
		expect(swapped).toBe(true);

		expect(readAgentControl(paths, "claude", SESSION, alive)?.bridgeInstanceId).toBe(running[1]!.session.instanceId);
		const { log } = await hook("UserPromptSubmit");
		expect(log).toMatchObject({ outcome: "forwarded", bridgePid: 200 });
		expect(received).toEqual([{ bridge: 200, event: "UserPromptSubmit" }]);
	});

	it("a crashed bridge's record is cleared, and SessionStart launches a new bridge that hooks then reach", async () => {
		live.add(100).add(process.pid);
		starts.set(100, "1000");
		await bridge(100);
		live.delete(100);
		pruneAgentFiles(paths, alive);
		expect(readAgentControl(paths, "claude", SESSION, alive)).toBeUndefined();
		live.add(200);
		const start = await hook("SessionStart", async () => { await bridge(200); return 200; });
		expect(start).toMatchObject({ launches: 1, log: { outcome: "bridge-ready", bridgePid: 200 } });
		expect((await hook("Stop")).log).toMatchObject({ outcome: "forwarded", bridgePid: 200 });
		expect(received).toEqual([{ bridge: 200, event: "Stop" }]);
	});

	it("a live bridge's record is never cleared", async () => {
		live.add(100).add(process.pid);
		await bridge(100);
		pruneAgentFiles(paths, alive);
		expect((await hook("Stop")).log).toMatchObject({ outcome: "forwarded", bridgePid: 100 });
	});
});

describe("pid reuse (L32 finding 5)", () => {
	it("an old control record whose pid now belongs to another process does not skip the launch", async () => {
		live.add(100).add(process.pid);
		starts.set(100, "1000");
		await bridge(100);
		// The bridge died without cleanup and an unrelated process got its pid.
		starts.set(100, "5000");
		live.add(200);
		starts.set(200, "2000");
		const start = await hook("SessionStart", async () => { await bridge(200); return 200; });
		expect(start).toMatchObject({ launches: 1, log: { outcome: "bridge-ready", bridgePid: 200 } });
		expect((await hook("UserPromptSubmit")).log).toMatchObject({ outcome: "forwarded", bridgePid: 200 });
		expect(received).toEqual([{ bridge: 200, event: "UserPromptSubmit" }]);
	});

	it("an old lock whose owner's pid now belongs to another process: the single launch succeeds", async () => {
		live.add(100).add(process.pid);
		starts.set(100, "1000");
		await bridge(100);
		starts.set(100, "5000");
		live.add(200);
		starts.set(200, "2000");
		expect(await bridge(200)).toBeTruthy();
		expect(readAgentControl(paths, "claude", SESSION, alive)?.bridgeInstanceId).toBe(running[1]!.session.instanceId);
	});

	it("a live bridge with its recorded start time still holds the session: no launch, SessionStart reaches it", async () => {
		live.add(100).add(process.pid);
		starts.set(100, "1000");
		await bridge(100);
		live.add(200);
		const start = await hook("SessionStart", async () => { await bridge(200); return 200; });
		expect(start).toMatchObject({ launches: 0, log: { outcome: "forwarded", bridgePid: 100 } });
		expect(await bridge(200)).toBeUndefined();
	});

	it("when the start time cannot be read, a live pid still counts as the owner (pid-only fallback)", async () => {
		live.add(100).add(process.pid);
		await bridge(100);
		live.add(200);
		expect(await bridge(200)).toBeUndefined();
		const start = await hook("SessionStart", async () => { await bridge(200); return 200; });
		expect(start).toMatchObject({ launches: 0, log: { outcome: "forwarded", bridgePid: 100 } });
	});
});
