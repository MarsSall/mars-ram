// `mars-ram hook <agent> <event>`, the part every agent shares: what the agent runs for each installed hook. It must
// never get in the agent's way: it always exits 0, prints nothing except a PermissionRequest decision from the phone
// (built here from a bare allow/deny answered by the session's own bridge instance, never the bridge's text), and when the session's bridge is absent or does not answer it simply ends, so the agent carries on (or shows its
// own prompt) as usual. SessionStart starts the session's bridge when none is running (bridge-launch.ts); a bridge
// counts as running only while its lock marker, which holds the control record, names a live owner (pid plus start
// time at SessionStart, process-identity.ts; the pid alone on other events, which stay cheap and where a dead
// bridge only means an unanswered request). Each run with a valid session writes one line to the diagnostic log
// (agent-log.ts), and SessionStart and SessionEnd clear what bridges killed from outside left behind.
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { MAX_APPROVAL_TIMEOUT_SECONDS, permissionOutput, readHookDecision, validSessionId } from "../core/agent-hooks.ts";
import { approvalTimeoutMs, type BridgePaths, type ControlRecord, inspectAgentControl, type OwnerRuns, pruneAgentFiles } from "./agent-bridge.ts";
import type { AgentLog, AgentLogEntry } from "./agent-log.ts";
import type { BridgeLaunch } from "./bridge-launch.ts";
import { processRuns, processStartTime } from "./process-identity.ts";

export type BaseHookIO<C> = {
	stdin(): Promise<string>;
	/** Resolves once written: Windows pipes are asynchronous and the process exits right after. */
	stdout(text: string): Promise<void>;
	paths: BridgePaths;
	alive(pid: number): boolean;
	/** A process's start time, to tell a reused pid from its old owner; process-identity.ts by default. */
	startTime?(pid: number): string | undefined;
	hostConfig(): unknown;
	/** Starts the session's bridge so it outlives the hook; how it went, when known. */
	spawnBridge(config: C): void | Promise<BridgeLaunch | void>;
	post(port: number, token: string, event: string, body: unknown, timeoutMs: number): Promise<unknown>;
	sleep(ms: number): Promise<void>;
	/** The diagnostic log; absent in tests that do not look at it. */
	log?: AgentLog;
	/** Milliseconds, for the time a launch took; Date.now by default. */
	now?: () => number;
};

export type AgentHookSpec<C, I extends BaseHookIO<C>> = {
	/** The agent's files in the agents folder: `<prefix>-<sessionId>.json`. */
	prefix: string;
	isEvent(event: string): boolean;
	/** The new bridge's configuration from the SessionStart payload; undefined when no bridge can serve it. */
	startConfig(payload: Record<string, unknown>, sessionId: string, io: I): Promise<C | undefined>;
	/** What is forwarded to the bridge of the hook's payload. */
	body(payload: Record<string, unknown>): Record<string, unknown>;
	/** How long the forward waits for the bridge. */
	forwardTimeoutMs(event: string, io: I): number;
};

/** Ordinary hooks are fire-and-forget; the bridge is on this computer and answers at once. */
export const FORWARD_TIMEOUT_MS = 3000;
/**
 * SessionStart waits up to this long for a new bridge, so the session's first prompt already reaches it; it returns
 * as soon as the bridge is up. Windows needs the margin: restricting each private file runs PowerShell. Below the
 * SessionStart hook timeout.
 */
const START_WAIT_MS = 8000;

/** PermissionRequest waits past the bridge's own approval timeout, so the bridge always answers first. */
export const approvalForwardTimeoutMs = (hostConfig: unknown) => Math.min(approvalTimeoutMs(hostConfig) + 15_000, (MAX_APPROVAL_TIMEOUT_SECONDS + 45) * 1000);

/** What one hook run did, for the log. */
type HookOutcome = Omit<AgentLogEntry, "agent" | "event" | "pid">;

export async function runAgentHook<C, I extends BaseHookIO<C>>(spec: AgentHookSpec<C, I>, event: string, io: I): Promise<void> {
	if (!spec.isEvent(event)) return;
	let payload: Record<string, unknown>;
	try {
		const value: unknown = JSON.parse(await io.stdin());
		if (!value || typeof value !== "object" || Array.isArray(value)) return;
		payload = value as Record<string, unknown>;
	} catch { return; }
	const sessionId = payload.session_id;
	if (!validSessionId(sessionId)) return;
	const log = (outcome: HookOutcome) => {
		try { io.log?.({ agent: spec.prefix, event, pid: process.pid, ...outcome }); } catch { /* Diagnostics only. */ }
	};
	let outcome: HookOutcome;
	try {
		outcome = await hookRun(spec, event, io, payload, sessionId);
	} catch (error) {
		log({ outcome: "error", error: error instanceof Error ? error.message : String(error) });
		throw error;
	}
	log(outcome);
}

async function hookRun<C, I extends BaseHookIO<C>>(spec: AgentHookSpec<C, I>, event: string, io: I, payload: Record<string, unknown>, sessionId: string): Promise<HookOutcome> {
	const byPid: OwnerRuns = (pid) => io.alive(pid);
	const inspect = (runs: OwnerRuns) => inspectAgentControl(io.paths, spec.prefix, sessionId, runs);
	if (event === "SessionStart") pruneAgentFiles(io.paths, io.alive);
	// SessionStart is the one launch a session gets, so an owner whose pid now names another process must not hold it
	// off: it checks the start time too.
	const found = event === "SessionStart"
		? inspect((pid, start) => processRuns(pid, start, { alive: (p) => io.alive(p), startTime: (p) => io.startTime ? io.startTime(p) : processStartTime(p) }))
		: inspect(byPid);
	let control: ControlRecord | undefined = found.control;

	if (event === "SessionStart" && !control) {
		const config = await spec.startConfig(payload, sessionId, io);
		if (config === undefined) return { outcome: "no-bridge-config" };
		const now = io.now ?? Date.now;
		const launchedAt = now();
		const launch = (await io.spawnBridge(config)) ?? undefined;
		// The launch (WMI on Windows) counts against the wait, but the bridge always gets a second to come up.
		for (let waited = Math.min(Math.max(0, now() - launchedAt), START_WAIT_MS - 1000); waited < START_WAIT_MS && !control; waited += 100) {
			await io.sleep(100);
			// Any owner but the stale one found above is the new bridge (or another start's): the pid is enough.
			const seen = inspect(byPid);
			control = seen.marker === found.marker ? undefined : seen.control;
		}
		// The new bridge records the session start itself.
		const bridgePid = control?.pid ?? launch?.pid;
		return {
			outcome: control ? "bridge-ready" : "bridge-not-ready",
			...(bridgePid === undefined ? {} : { bridgePid }),
			...(launch?.method === undefined ? {} : { method: launch.method }),
			...(launch?.error === undefined ? {} : { error: launch.error }),
		};
	}
	if (!control) return { outcome: "no-bridge" };

	const answer = await io.post(control.port, control.hookToken, event, spec.body(payload), spec.forwardTimeoutMs(event, io));
	if (event === "SessionEnd") pruneAgentFiles(io.paths, io.alive);
	const forwarded: HookOutcome = { outcome: answer === undefined ? "no-answer" : "forwarded", bridgePid: control.pid };
	if (event !== "PermissionRequest" || !answer || typeof answer !== "object" || Array.isArray(answer)) return forwarded;
	// Only the bridge instance the control record names may decide; whatever else is listening on that port may not.
	const { bridgeInstanceId, decision } = answer as { bridgeInstanceId?: unknown; decision?: unknown };
	if (typeof bridgeInstanceId !== "string" || bridgeInstanceId !== control.bridgeInstanceId) return { ...forwarded, outcome: "foreign-answer" };
	const parsed = readHookDecision(decision);
	if (!parsed) return { ...forwarded, outcome: "no-decision" };
	await io.stdout(JSON.stringify(permissionOutput(parsed)));
	return { ...forwarded, outcome: `decision-${parsed.behavior}` };
}

/** POSIX shells that may sit between the agent and the hook when it runs a shell-form command. */
export const POSIX_SHELLS = new Set(["sh", "bash", "dash", "zsh", "fish", "ksh", "mksh", "ash", "busybox"]);

/**
 * The agent process that ran this hook: the parent, skipping shells in between on Linux (read from /proc).
 * Elsewhere the parent itself.
 */
export function findAgentPid(ppid: number = process.ppid, platform: NodeJS.Platform = process.platform, read: (path: string) => string = (path) => readFileSync(path, "utf8"), shells: ReadonlySet<string> = POSIX_SHELLS): number | undefined {
	if (!Number.isInteger(ppid) || ppid <= 1) return undefined;
	if (platform !== "linux") return ppid;
	let pid = ppid;
	for (let hop = 0; hop < 3; hop++) {
		let comm: string;
		let parent: number;
		try {
			comm = read(`/proc/${pid}/comm`).trim();
			const stat = read(`/proc/${pid}/stat`);
			parent = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
		} catch { return undefined; }
		if (!shells.has(comm)) return pid;
		if (!Number.isInteger(parent) || parent <= 1) return undefined;
		pid = parent;
	}
	return undefined;
}

const MAX_STDIN = 2 * 1024 * 1024;

export function readStdin(): Promise<string> {
	if (process.stdin.isTTY) return Promise.resolve("");
	return new Promise((resolveText) => {
		const chunks: Buffer[] = [];
		let size = 0;
		const finish = () => { clearTimeout(timer); clearTimeout(silent); resolveText(Buffer.concat(chunks).toString("utf8")); };
		// The agent closes stdin after writing the event; never hang if something else runs the command.
		const timer = setTimeout(() => { process.stdin.destroy(); finish(); }, 5000);
		// The agent writes the event as it starts the hook, so it is already waiting in the pipe: an open stdin that
		// stays silent is not an agent's.
		const silent = setTimeout(() => { if (size === 0) { process.stdin.destroy(); finish(); } }, 1500);
		process.stdin.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_STDIN) { chunks.length = 0; process.stdin.destroy(); return finish(); }
			chunks.push(chunk);
		});
		process.stdin.on("end", finish);
		process.stdin.on("error", finish);
	});
}

export function post(port: number, token: string, event: string, body: unknown, timeoutMs: number): Promise<unknown> {
	return new Promise((resolveAnswer) => {
		const data = JSON.stringify(body);
		const req = request({ host: "127.0.0.1", port, method: "POST", path: `/hook/${event}`, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "content-length": Buffer.byteLength(data) }, timeout: timeoutMs }, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => chunks.push(chunk));
			res.on("end", () => {
				if (res.statusCode !== 200) return resolveAnswer(undefined);
				try { resolveAnswer(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { resolveAnswer(undefined); }
			});
			res.on("error", () => resolveAnswer(undefined));
		});
		req.on("timeout", () => req.destroy());
		req.on("error", () => resolveAnswer(undefined));
		req.end(data);
	});
}
