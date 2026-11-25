// The Claude Code session bridge process: one per Claude Code session, started by its SessionStart hook. The
// bridge itself is the shared agent bridge (agent-bridge.ts) with agent "claude-code": hooks from handleClaudeHook,
// the conversation from Claude Code's transcript under ~/.claude/projects/.
import { isAbsolute } from "node:path";
import { processIsAlive } from "@workspace/protocol/bridge-host";
import { handleClaudeHook, isClaudeHookEvent, MAX_APPROVAL_TIMEOUT_SECONDS, MIN_APPROVAL_TIMEOUT_SECONDS, validSessionId } from "../core/claude-hooks.ts";
import { parseTranscriptLine } from "../core/claude-transcript.ts";
import { type BridgeEnv, validBridgeEnv } from "./bridge-launch.ts";
import { type AgentBridgeDeps, type AgentBridgeSpec, type BridgePaths, type ControlRecord, readAgentControl, type RunningAgentBridge, runAgentBridge } from "./agent-bridge.ts";

export { approvalTimeoutMs, type BridgePaths, bridgePaths, type ControlRecord } from "./agent-bridge.ts";

export type ClaudeBridgeConfig = {
	sessionId: string;
	transcriptPath: string;
	cwd: string;
	/** The SessionStart `source` (startup, resume, clear, compact). */
	source: string;
	approvalTimeoutMs: number;
	/** The Claude Code process; the bridge ends when it is gone. */
	claudePid?: number;
	/** The hook's Herdr and registry variables, on Windows, where the bridge does not inherit them. */
	env?: BridgeEnv;
};

export const controlName = (sessionId: string) => `claude-${sessionId}`;

export function readControl(paths: BridgePaths, sessionId: string, alive: (pid: number) => boolean = processIsAlive): ControlRecord | undefined {
	return readAgentControl(paths, "claude", sessionId, alive);
}

export function encodeBridgeConfig(config: ClaudeBridgeConfig): string {
	return Buffer.from(JSON.stringify(config), "utf8").toString("base64url");
}

export function decodeBridgeConfig(encoded: string): ClaudeBridgeConfig | undefined {
	let value: Record<string, unknown>;
	try { value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { return undefined; }
	if (!value || typeof value !== "object") return undefined;
	const { sessionId, transcriptPath, cwd, source, approvalTimeoutMs, claudePid, env } = value;
	if (!validSessionId(sessionId) || typeof transcriptPath !== "string" || !isAbsolute(transcriptPath) || transcriptPath.length > 4096 || !transcriptPath.endsWith(".jsonl")) return undefined;
	if (typeof cwd !== "string" || cwd.length > 4096 || typeof source !== "string" || !/^[a-z_-]{1,20}$/.test(source)) return undefined;
	if (typeof approvalTimeoutMs !== "number" || approvalTimeoutMs < MIN_APPROVAL_TIMEOUT_SECONDS * 1000 || approvalTimeoutMs > MAX_APPROVAL_TIMEOUT_SECONDS * 1000) return undefined;
	if (claudePid !== undefined && (!Number.isInteger(claudePid) || (claudePid as number) <= 1)) return undefined;
	if (env !== undefined && !validBridgeEnv(env)) return undefined;
	return { sessionId, transcriptPath, cwd, source, approvalTimeoutMs, ...(claudePid === undefined ? {} : { claudePid: claudePid as number }), ...(env === undefined ? {} : { env }) };
}

export type ClaudeBridgeDeps = AgentBridgeDeps;
export type RunningClaudeBridge = RunningAgentBridge;

export const CLAUDE_BRIDGE: AgentBridgeSpec = {
	agent: "claude-code",
	prefix: "claude",
	provider: "anthropic",
	isEvent: isClaudeHookEvent,
	parser: () => parseTranscriptLine,
	hooks: (session) => (event, payload, closed, end) => handleClaudeHook(session, event as Parameters<typeof handleClaudeHook>[1], payload, closed, end),
};

/** Starts the bridge, or returns undefined when another live bridge already serves this session. */
export function runClaudeBridge(config: ClaudeBridgeConfig, deps: ClaudeBridgeDeps): Promise<RunningClaudeBridge | undefined> {
	const { claudePid, env: _env, ...rest } = config;
	return runAgentBridge(CLAUDE_BRIDGE, { ...rest, ...(claudePid === undefined ? {} : { agentPid: claudePid }) }, deps);
}
