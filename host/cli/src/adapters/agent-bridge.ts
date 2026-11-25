// The session bridge process of a hook-driven agent (Claude Code, Codex): one per agent session, started by its
// SessionStart hook. It serves the same registry entry and HTTP/SSE protocol as the Pi bridge (with the agent's
// kind), learns state from the hooks forwarded to it on a separate loopback channel, reads the conversation from
// the agent's transcript, and acts only by typing into the session's own Herdr pane. It ends with SessionEnd, or
// when the agent process is gone. What differs per agent comes in an AgentBridgeSpec.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { type AgentKind, APP_ID, REGISTRY_DIRECTORY } from "@workspace/protocol";
import {
	createHerdrTerminal,
	createToken,
	type FilePermissions,
	platformPermissions,
	preparePrivateDirectory,
	processIsAlive,
	publishEntry,
	pruneStaleEntries,
	removeEntry,
	startHttpServer,
	type TerminalExecFile,
} from "@workspace/protocol/bridge-host";
import { AgentSession, type ConversationItem, type Timers } from "../core/agent-session.ts";
import { DEFAULT_APPROVAL_TIMEOUT_SECONDS, type HookAnswer, MAX_APPROVAL_TIMEOUT_SECONDS, MIN_APPROVAL_TIMEOUT_SECONDS, type TranscriptState, validSessionId } from "../core/agent-hooks.ts";
import type { AgentLog } from "./agent-log.ts";
import { processRuns, processStartTime } from "./process-identity.ts";
import { startTranscriptTail } from "./transcript-tail.ts";

export type BridgePaths = { registryDir: string; agentsDir: string };

/** Where bridges publish themselves (shared with the Pi bridge) and where agent bridges keep their hook channel. */
export function bridgePaths(home: string = homedir(), env: NodeJS.ProcessEnv = process.env): BridgePaths {
	return { registryDir: env.PI_BRIDGE_REGISTRY_DIR ?? join(home, REGISTRY_DIRECTORY), agentsDir: join(home, `.${APP_ID}`, "agents") };
}

/**
 * What the hook process reads to reach a session's bridge. The token is only for /hook routes. It is the content of
 * the bridge's own lock marker (see acquireSessionLock), so it exists exactly as long as that owner holds the lock,
 * and nothing but the owner's exact marker name ever removes it. `pid` is the marker's.
 */
export type ControlRecord = { version: 1; pid: number; port: number; hookToken: string; bridgeInstanceId: string };

/**
 * Whether the lock owner recorded as `pid`, with its start time when the marker names one, still runs. A bare
 * `(pid) => boolean` is a pid-only check.
 */
export type OwnerRuns = (pid: number, start?: string) => boolean;

/** What the session's lock holds: its single owner's marker name, and that owner's record when it runs. */
export type ControlLookup = { marker?: string; control?: ControlRecord };

const validRecord = (value: ControlRecord | undefined): boolean =>
	value?.version === 1 && Number.isInteger(value.pid) && value.pid > 0 && Number.isInteger(value.port) && value.port > 0 && value.port <= 65535 && typeof value.hookToken === "string" && value.hookToken.length >= 32 && typeof value.bridgeInstanceId === "string" && !!value.bridgeInstanceId;

/**
 * The session's control record: valid only inside the current lock's single marker, whose owner `runs` says still
 * runs, and with that marker's pid. `prefix` names the agent's lock in the agents folder: `<prefix>-<sessionId>.lock`.
 */
export function inspectAgentControl(paths: BridgePaths, prefix: string, sessionId: string, runs: OwnerRuns = (pid) => processIsAlive(pid)): ControlLookup {
	if (!validSessionId(sessionId)) return {};
	const lock = join(paths.agentsDir, `${prefix}-${sessionId}.lock`);
	let names: string[];
	try { names = readdirSync(lock); } catch { return {}; }
	const owner = names.length === 1 ? MARKER.exec(names[0]!) : null;
	if (!owner) return {};
	const marker = owner[0];
	const pid = Number(owner[1]);
	if (!runs(pid, owner[2])) return { marker };
	try {
		const value = JSON.parse(readFileSync(join(lock, marker), "utf8")) as ControlRecord;
		return validRecord(value) && value.pid === pid ? { marker, control: value } : { marker };
	} catch {
		return { marker };
	}
}

export function readAgentControl(paths: BridgePaths, prefix: string, sessionId: string, runs: OwnerRuns = (pid) => processIsAlive(pid)): ControlRecord | undefined {
	return inspectAgentControl(paths, prefix, sessionId, runs).control;
}

/** Hook control records of builds before the record moved into the lock marker. */
const LEGACY_CONTROL_FILE = /^(?:claude|codex)-[A-Za-z0-9-]{1,100}\.json$/;
const LOCK_NAME = /^(?:claude|codex)-[A-Za-z0-9-]{1,100}\.lock$/;
const STAGING_NAME = /^((?:claude|codex)-[A-Za-z0-9-]{1,100}\.lock)\.([0-9a-f-]{1,64})\.tmp$/;

/**
 * Removes what bridges that no longer run left behind: their registry entries, and their session locks with the
 * control records inside. A bridge removes its own files when it ends, but on Windows a process killed from outside
 * (a job closing, Task Manager, `taskkill /F`) runs no handler at all. A lock is cleared exactly as a starter takes
 * over a dead one (its dead owner's marker by exact name, then the folder only if empty), so a cleanup that paused
 * after judging an owner dead can never remove a replacement's lock or record. The check is the pid alone: a dead
 * owner whose pid was reused stays until the session's next start, which checks start times. Best effort; files
 * that are not ours are left alone.
 */
export function pruneAgentFiles(paths: BridgePaths, alive: (pid: number) => boolean = processIsAlive): void {
	try { pruneStaleEntries(paths.registryDir, alive); } catch { /* Best effort. */ }
	let names: string[];
	try { names = readdirSync(paths.agentsDir); } catch { return; }
	const runs: OwnerRuns = (pid) => alive(pid);
	for (const name of names) {
		const path = join(paths.agentsDir, name);
		try {
			if (LOCK_NAME.test(name)) { clearStaleLock(path, 0, runs, nodeLockFs); continue; }
			const staging = STAGING_NAME.exec(name);
			if (staging) { sweepStagingFolder(join(paths.agentsDir, staging[1]!), staging[2]!, 0, runs, nodeLockFs); continue; }
			if (!LEGACY_CONTROL_FILE.test(name)) continue;
			// Only builds before this one write these, so removing one by its path cannot race a current bridge.
			const pid = (JSON.parse(readFileSync(path, "utf8")) as { pid?: unknown }).pid;
			if (typeof pid === "number" && Number.isInteger(pid) && pid > 0 && !alive(pid)) rmSync(path, { force: true });
		} catch { /* Unreadable, busy or not ours. */ }
	}
}

const RETRIED = new Set(["EBUSY", "EPERM", "EACCES"]);
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Removes one file, retrying briefly when Windows reports it busy (another process, such as an antivirus or a
 * client reading the registry, has it open). Synchronous, so it also works in an exit handler. Throws the last error.
 */
export function removeWithRetry(path: string, remove: (path: string) => void = removeEntry, attempts = 6, delayMs = 50): void {
	for (let attempt = 1; ; attempt++) {
		try { remove(path); return; } catch (error) {
			if (attempt >= attempts || !RETRIED.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
			pause(delayMs);
		}
	}
}

/** host.json `approvalTimeoutSeconds`, bounded; the default otherwise. */
export function approvalTimeoutMs(hostConfig: unknown): number {
	const value = hostConfig && typeof hostConfig === "object" ? (hostConfig as Record<string, unknown>).approvalTimeoutSeconds : undefined;
	const seconds = typeof value === "number" && Number.isFinite(value) ? Math.min(MAX_APPROVAL_TIMEOUT_SECONDS, Math.max(MIN_APPROVAL_TIMEOUT_SECONDS, Math.round(value))) : DEFAULT_APPROVAL_TIMEOUT_SECONDS;
	return seconds * 1000;
}

export type AgentBridgeConfig = {
	sessionId: string;
	/** The agent's transcript; absent when the agent gave none (Codex may not). */
	transcriptPath?: string;
	cwd: string;
	/** The SessionStart `source` (startup, resume, clear, compact). */
	source: string;
	approvalTimeoutMs: number;
	/** The agent process; the bridge ends when it is gone. */
	agentPid?: number;
};

export type HookHandler = (event: string, payload: Record<string, unknown>, closed: AbortSignal, end: () => void) => Promise<HookAnswer>;

export type AgentBridgeSpec = {
	agent: AgentKind;
	/** File-name prefix and approval id prefix: `claude`, `codex`. */
	prefix: string;
	/** The provider the agent's models come from, for the state's `model`. */
	provider: string;
	isEvent(event: string): boolean;
	/** A line reader for one transcript (it may keep state between lines). */
	parser(): (line: string) => ConversationItem[];
	/** The hook handling for one session. */
	hooks(session: AgentSession, transcript: TranscriptState, timers: Timers): HookHandler;
};

export type AgentBridgeDeps = {
	paths: BridgePaths;
	env: NodeJS.ProcessEnv;
	permissions?: FilePermissions;
	herdr?: TerminalExecFile;
	alive?: (pid: number) => boolean;
	/** A process's start time (process-identity.ts by default); tests inject one. */
	startTime?: (pid: number) => string | undefined;
	pollMs?: number;
	clock?: () => number;
	/** This process, as written in the session lock; tests running two bridges in one process set another. */
	pid?: number;
	/** Removes one of the bridge's files (tests make it fail). */
	remove?: (path: string) => void;
	/** The diagnostic log: one line when the bridge starts and one when it ends. */
	log?: AgentLog;
};

export type RunningAgentBridge = {
	session: AgentSession;
	port: number;
	entryPath: string;
	/** Ends the bridge; `reason` goes to the log (`session-end`, `agent-gone`, a signal…). */
	stop(reason?: string): Promise<void>;
	done: Promise<void>;
	/** Removes the registry entry and the lock (with the control record) at once, synchronously: for a process exit handler. */
	removeFiles(): void;
};

const EVENT_CAPACITY = 1000;
const HISTORY_LIMIT = 500;
const MAX_BODY_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 15_000;
const INITIAL_TRANSCRIPT_BYTES = 8 * 1024 * 1024;

/** What the session lock does to the file system; tests interleave two starters through it. */
export type SessionLockFs = {
	mkdir(path: string): void;
	/** Creates an empty file; fails when it exists. */
	create(path: string): void;
	rename(from: string, to: string): void;
	readdir(path: string): string[];
	readFile(path: string): string;
	unlink(path: string): void;
	rmdir(path: string): void;
};

const nodeLockFs: SessionLockFs = {
	mkdir: (path) => mkdirSync(path, { mode: 0o700 }),
	create: (path) => writeFileSync(path, "", { flag: "wx", mode: 0o600 }),
	rename: (from, to) => renameSync(from, to),
	readdir: (path) => readdirSync(path),
	readFile: (path) => readFileSync(path, "utf8"),
	unlink: (path) => unlinkSync(path),
	rmdir: (path) => rmdirSync(path),
};

/**
 * An owner marker: `<pid>-<start>-<16 hex>`, unique per acquisition. `<start>` is the owner's process start time
 * (digits, process-identity.ts); a marker made when it could not be read is `<pid>-<16 hex>` and is checked by pid.
 */
const MARKER = /^([1-9]\d{0,9})-(?:(\d{1,20})-)?[0-9a-f]{16}$/;
const LOCK_ATTEMPTS = 100;
const LOCK_RETRY_MS = 10;
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code ?? "";

/** Who takes the lock: its start time (for the marker name) and its record (written into the staged marker). */
export type LockOwner = { start?: string | undefined; record?: (stagedMarker: string) => void };

/**
 * One bridge per session. The lock is a folder in the private agents folder holding one marker file named after its
 * owner (`<pid>-<start>-<nonce>`); the owner's file name is the only lock state, so there is never a half-written
 * lock. The file's content is the owner's control record, written before the lock is placed, so whoever sees the
 * lock sees the whole record, and it goes only with its marker, by its exact name.
 * - Taking: the marker is made in a private staging folder, which is then renamed onto the lock path. A rename onto
 *   a folder that holds a marker fails on Linux and Windows (on Linux it may replace an empty folder, which is a free
 *   lock), so it succeeds for exactly one starter, and the lock is never seen without its owner.
 * - Taking over: a dead owner's marker is removed by its exact name, which removes nothing if anyone already did,
 *   and the emptied folder by rmdir, which never removes a folder holding a new owner's marker. The taker then
 *   competes for the free lock like any other starter. So a stale lock needs no guard, and whatever a crash leaves
 *   (a dead owner's marker, an empty folder, a staging folder) is cleared by the next single start on its first try.
 * Chosen over an OS-held lock (a Linux abstract socket or a Windows named pipe, released by the OS on a crash):
 * those names live in a namespace every local user can bind, so another user could hold a session's bridge off, and
 * they need an async listen; this folder sits under the user's private directory and stays synchronous.
 * An owner is alive when `runs` says so: its pid runs and, when both are known, with the start time its marker names
 * (a dead owner whose pid an unrelated process got is dead).
 * Returns this owner's marker path (for releaseSessionLock), or undefined when a live bridge holds the lock.
 */
export function acquireSessionLock(lock: string, self: number, runs: OwnerRuns, fs: SessionLockFs = nodeLockFs, owner: LockOwner = {}): string | undefined {
	sweepStaging(lock, self, runs, fs);
	const start = owner.start !== undefined && /^\d{1,20}$/.test(owner.start) ? `${owner.start}-` : "";
	const marker = `${self}-${start}${randomBytes(8).toString("hex")}`;
	const staging = `${lock}.${marker}.tmp`;
	fs.mkdir(staging);
	let placed = false;
	try {
		fs.create(join(staging, marker));
		owner.record?.(join(staging, marker));
		let failure: unknown;
		for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
			try {
				fs.rename(staging, lock);
				placed = true;
				return join(lock, marker);
			} catch (error) { failure = error; }
			const found = clearStaleLock(lock, self, runs, fs);
			if (found === "held") return undefined;
			if (found === "wait") pause(LOCK_RETRY_MS);
		}
		throw new Error(`could not take the session lock ${lock}: ${(failure as Error)?.message ?? String(failure)}`);
	} finally {
		if (!placed) {
			try { fs.unlink(join(staging, marker)); } catch { /* Not made. */ }
			try { fs.rmdir(staging); } catch { /* Best effort; swept by a later start. */ }
		}
	}
}

/** Looks at the lock after a failed take: `held` by a live bridge, `freed` by this call, or `wait` and look again. */
function clearStaleLock(lock: string, self: number, runs: OwnerRuns, fs: SessionLockFs): "held" | "freed" | "wait" {
	const stale = (pid: number, start?: string) => !(Number.isInteger(pid) && pid > 0 && pid !== self && runs(pid, start));
	let names: string[];
	try {
		names = fs.readdir(lock);
	} catch (error) {
		if (errorCode(error) === "ENOENT") return "freed";
		if (errorCode(error) !== "ENOTDIR") return "wait";
		// A pid file from a build before lock folders. unlink never removes a folder, so this cannot remove a new lock.
		let owner = NaN;
		try { owner = Number(fs.readFile(lock).trim()); } catch { /* Gone or unreadable: stale. */ }
		if (!stale(owner)) return "held";
		try { fs.unlink(lock); return "freed"; } catch { return "wait"; }
	}
	const owners = names.map((name) => MARKER.exec(name));
	if (owners.some((owner) => !owner)) throw new Error(`${lock} holds something that is not a session lock marker`);
	// A marker with this process's own pid is left from an earlier process that had the same pid.
	if (owners.some((owner) => !stale(Number(owner![1]), owner![2]))) return "held";
	for (const name of names) {
		try { fs.unlink(join(lock, name)); } catch (error) { if (errorCode(error) !== "ENOENT") return "wait"; }
	}
	try { fs.rmdir(lock); return "freed"; } catch (error) {
		// Gone or retaken (it holds a new marker): look again. Busy on Windows: also look again.
		return errorCode(error) === "ENOENT" ? "freed" : "wait";
	}
}

/** Removes the staging folders of starters that died before placing them. */
function sweepStaging(lock: string, self: number, runs: OwnerRuns, fs: SessionLockFs): void {
	const prefix = `${basename(lock)}.`;
	let names: string[];
	try { names = fs.readdir(dirname(lock)); } catch { return; }
	for (const name of names) {
		if (name.startsWith(prefix) && name.endsWith(".tmp")) sweepStagingFolder(lock, name.slice(prefix.length, -".tmp".length), self, runs, fs);
	}
}

/** Removes `<lock>.<marker>.tmp` when the starter its marker names is dead: the marker by name, then the folder. */
function sweepStagingFolder(lock: string, marker: string, self: number, runs: OwnerRuns, fs: SessionLockFs): void {
	const owner = MARKER.exec(marker);
	if (!owner || Number(owner[1]) === self || runs(Number(owner[1]), owner[2])) return;
	const staging = `${lock}.${marker}.tmp`;
	try { fs.unlink(join(staging, marker)); } catch { /* Gone. */ }
	try { fs.rmdir(staging); } catch { /* Gone, or not ours to touch. */ }
}

/**
 * Releases a lock acquireSessionLock gave: removes this owner's marker by name (so it never touches another owner's
 * lock), then the folder if it is empty. Throws when the marker stays; that does not block the next start, which
 * finds this owner dead. A folder left behind after the marker went is a free lock.
 */
export function releaseSessionLock(marker: string, remove: (path: string) => void = removeEntry): void {
	removeWithRetry(marker, remove);
	try { removeWithRetry(dirname(marker), (path) => rmdirSync(path)); } catch { /* Free already, or another owner's now. */ }
}

/**
 * Starts the bridge, or returns undefined when another live bridge already serves this session. The hook server
 * starts first, so the control record (its port and token) goes into the lock marker before the lock is placed; a
 * starter that finds the lock held closes it again.
 */
export async function runAgentBridge(spec: AgentBridgeSpec, config: AgentBridgeConfig, deps: AgentBridgeDeps): Promise<RunningAgentBridge | undefined> {
	const permissions = deps.permissions ?? platformPermissions();
	const alive = deps.alive ?? processIsAlive;
	const startTime = deps.startTime ?? ((pid: number) => processStartTime(pid));
	const runs: OwnerRuns = (pid, start) => processRuns(pid, start, { alive, startTime });
	const { registryDir, agentsDir } = deps.paths;
	const name = `${spec.prefix}-${config.sessionId}`;
	const lock = join(agentsDir, `${name}.lock`);
	const self = deps.pid ?? process.pid;

	preparePrivateDirectory(agentsDir, permissions);
	let marker: string | undefined;
	const releaseLock = (): string | undefined => {
		if (!marker) return undefined;
		try { releaseSessionLock(marker, deps.remove); return undefined; } catch (error) { return (error as Error).message; }
	};

	let server: Awaited<ReturnType<typeof startHttpServer>> | undefined;
	let entryPath: string | undefined;
	let tail: { stop(): void; poll(): void } | undefined;
	let watch: ReturnType<typeof setInterval> | undefined;
	let finished!: () => void;
	const done = new Promise<void>((resolve) => { finished = resolve; });
	let stopping: Promise<void> | undefined;
	const pending = new Set<ReturnType<typeof setTimeout>>();
	const timers: Timers = {
		set: (ms, run) => {
			const timer = setTimeout(() => { pending.delete(timer); run(); }, ms);
			pending.add(timer);
			return () => { clearTimeout(timer); pending.delete(timer); };
		},
	};

	const terminal = createHerdrTerminal(deps.env, deps.herdr);
	const session = new AgentSession({
		agent: spec.agent,
		sessionId: config.sessionId,
		instanceId: randomUUID(),
		capacity: EVENT_CAPACITY,
		historyLimit: HISTORY_LIMIT,
		clock: deps.clock ?? Date.now,
		timers,
		approvalTimeoutMs: config.approvalTimeoutMs,
		newId: () => `${spec.prefix}-${randomBytes(12).toString("hex")}`,
		provider: spec.provider,
		...(terminal ? { terminal } : {}),
	});
	let recognized = false;
	const transcript: TranscriptState = { present: config.transcriptPath !== undefined, recognized: () => recognized, poll: () => tail?.poll() };
	const handle = spec.hooks(session, transcript, timers);

	let started = false;
	const log = (event: string, outcome: string, error?: string) => {
		try { deps.log?.({ agent: spec.prefix, event, outcome, pid: process.pid, ...(error === undefined ? {} : { error }) }); } catch { /* Diagnostics only. */ }
	};
	/** Removes some of this bridge's files; the first failure's message, if any. */
	const removeAll = (paths: (string | undefined)[]): string | undefined => {
		let failure: string | undefined;
		for (const path of paths) {
			if (!path) continue;
			try { removeWithRetry(path, deps.remove); } catch (error) { failure ??= (error as Error).message; }
		}
		return failure;
	};

	const stop = (reason = "stopped"): Promise<void> => stopping ??= (async () => {
		session.close();
		tail?.stop();
		if (watch) clearInterval(watch);
		for (const timer of pending) clearTimeout(timer);
		pending.clear();
		const failure = removeAll([entryPath]);
		try { await server?.close(); } finally {
			// The lock (with the control record) last, so no second bridge starts for the session before the rest is gone.
			const lockFailure = releaseLock();
			if (started) log("bridge-exit", failure ?? lockFailure ? "remove-failed" : reason, failure ?? lockFailure);
			finished();
		}
	})();

	try {
		const token = createToken();
		const hookToken = createToken();
		server = await startHttpServer({
			session,
			token,
			maxBodyBytes: MAX_BODY_BYTES,
			heartbeatMs: HEARTBEAT_MS,
			hooks: {
				token: hookToken,
				handle: async (event, body, closed) => {
					if (!spec.isEvent(event) || !body || typeof body !== "object" || Array.isArray(body)) return { status: 400, body: {} };
					const payload = body as Record<string, unknown>;
					if (payload.session_id !== undefined && payload.session_id !== config.sessionId) return { status: 400, body: {} };
					const answer = await handle(event, payload, closed, () => setImmediate(() => void stop(event === "SessionEnd" ? "session-end" : "ended-by-hook")));
					// The hook process checks this against the control record before it trusts a decision.
					return { status: 200, body: { ...answer, bridgeInstanceId: session.instanceId } };
				},
			},
		});
		const record: ControlRecord = { version: 1, pid: self, port: server.port, hookToken, bridgeInstanceId: session.instanceId };
		marker = acquireSessionLock(lock, self, runs, nodeLockFs, {
			start: startTime(self),
			record: (path) => { permissions.restrictFile(path); writeFileSync(path, JSON.stringify(record)); },
		});
		if (!marker) {
			await stop("held");
			return undefined;
		}
		pruneStaleEntries(registryDir, alive);
		entryPath = publishEntry(registryDir, {
			...session.envelope(),
			port: server.port,
			token,
			pid: process.pid,
			cwd: config.cwd,
			startedAt: Date.now(),
			agent: spec.agent,
			capabilities: session.capabilities(),
		}, permissions);
		session.started(config.source);
		if (config.transcriptPath !== undefined) {
			const parse = spec.parser();
			tail = startTranscriptTail({
				path: config.transcriptPath,
				initialBytes: INITIAL_TRANSCRIPT_BYTES,
				pollMs: deps.pollMs ?? 500,
				onLines: (lines, live) => {
					const items = lines.flatMap(parse);
					if (!recognized && items.some((item) => item.type === "user" || item.type === "assistant")) recognized = true;
					session.conversation(items, live);
				},
			});
		}
		if (config.agentPid !== undefined) {
			const pid = config.agentPid;
			watch = setInterval(() => { if (!alive(pid)) void stop("agent-gone"); }, 2000);
		}
		started = true;
		log("bridge-start", "started");
	} catch (error) {
		log("bridge-start", "failed", (error as Error)?.message ?? String(error));
		await stop("failed");
		throw error;
	}
	return { session, port: server.port, entryPath, stop, done, removeFiles: () => {
		// After stop() the files are gone, and the session's lock may already be another bridge's.
		if (!stopping) { removeAll([entryPath]); releaseLock(); }
	} };
}
