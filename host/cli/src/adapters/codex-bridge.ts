// The Codex session bridge process: one per Codex session, started by its SessionStart hook. The shared agent bridge
// (agent-bridge.ts) with agent "codex": hooks from handleCodexHook, the conversation from Codex's rollout JSONL when
// its path is known and its format understood, otherwise from the prompts and replies the hooks carry.
import { isAbsolute } from "node:path";
import { processIsAlive } from "@workspace/protocol/bridge-host";
import { MAX_APPROVAL_TIMEOUT_SECONDS, MIN_APPROVAL_TIMEOUT_SECONDS, validSessionId } from "../core/agent-hooks.ts";
import { type CodexHookEvent, handleCodexHook, HookHistory, isCodexHookEvent } from "../core/codex-hooks.ts";
import { createRolloutReader } from "../core/codex-rollout.ts";
import { type BridgeEnv, validBridgeEnv } from "./bridge-launch.ts";
import { type AgentBridgeDeps, type AgentBridgeSpec, type BridgePaths, type ControlRecord, readAgentControl, type RunningAgentBridge, runAgentBridge } from "./agent-bridge.ts";

export type CodexBridgeConfig = {
	sessionId: string;
	/** Codex's rollout file; absent when Codex reported none. */
	transcriptPath?: string;
	cwd: string;
	source: string;
	approvalTimeoutMs: number;
	/** The Codex process; the bridge ends when it is gone. */
	codexPid?: number;
	/** The hook's Herdr and registry variables, on Windows, where the bridge does not inherit them. */
	env?: BridgeEnv;
};

export function readCodexControl(paths: BridgePaths, sessionId: string, alive: (pid: number) => boolean = processIsAlive): ControlRecord | undefined {
	return readAgentControl(paths, "codex", sessionId, alive);
}

/** A rollout path the bridge will read: absolute, bounded, a .jsonl file. */
export const validRolloutPath = (value: unknown): value is string => typeof value === "string" && isAbsolute(value) && value.length <= 4096 && value.endsWith(".jsonl");

export function encodeCodexBridgeConfig(config: CodexBridgeConfig): string {
	return Buffer.from(JSON.stringify(config), "utf8").toString("base64url");
}

export function decodeCodexBridgeConfig(encoded: string): CodexBridgeConfig | undefined {
	let value: Record<string, unknown>;
	try { value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { return undefined; }
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const { sessionId, transcriptPath, cwd, source, approvalTimeoutMs, codexPid, env } = value;
	if (!validSessionId(sessionId) || (transcriptPath !== undefined && !validRolloutPath(transcriptPath))) return undefined;
	if (typeof cwd !== "string" || cwd.length > 4096 || typeof source !== "string" || !/^[a-z_-]{1,20}$/.test(source)) return undefined;
	if (typeof approvalTimeoutMs !== "number" || approvalTimeoutMs < MIN_APPROVAL_TIMEOUT_SECONDS * 1000 || approvalTimeoutMs > MAX_APPROVAL_TIMEOUT_SECONDS * 1000) return undefined;
	if (codexPid !== undefined && (!Number.isInteger(codexPid) || (codexPid as number) <= 1)) return undefined;
	if (env !== undefined && !validBridgeEnv(env)) return undefined;
	return { sessionId, ...(transcriptPath === undefined ? {} : { transcriptPath }), cwd, source, approvalTimeoutMs, ...(codexPid === undefined ? {} : { codexPid: codexPid as number }), ...(env === undefined ? {} : { env }) };
}

export const CODEX_BRIDGE: AgentBridgeSpec = {
	agent: "codex",
	prefix: "codex",
	provider: "openai",
	isEvent: isCodexHookEvent,
	parser: () => {
		const reader = createRolloutReader();
		return (line) => reader.parse(line);
	},
	hooks: (session, transcript, timers) => {
		const history = new HookHistory(session, transcript, timers);
		return (event, payload, closed, end) => handleCodexHook(session, history, event as CodexHookEvent, payload, closed, end);
	},
};

/** Starts the bridge, or returns undefined when another live bridge already serves this session. */
export function runCodexBridge(config: CodexBridgeConfig, deps: AgentBridgeDeps): Promise<RunningAgentBridge | undefined> {
	const { codexPid, env: _env, ...rest } = config;
	return runAgentBridge(CODEX_BRIDGE, { ...rest, ...(codexPid === undefined ? {} : { agentPid: codexPid }) }, deps);
}
