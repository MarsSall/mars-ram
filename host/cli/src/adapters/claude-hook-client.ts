// `mars-ram hook claude <event>`: what Claude Code runs for each installed hook. It must never get in Claude Code's
// way: it always exits 0, prints nothing except a PermissionRequest decision from the phone, and when the session's
// bridge is absent or does not answer it simply ends, so Claude Code carries on (or shows its own prompt) as usual.
// The shared part is agent-hook-client.ts.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { APP_ID } from "@workspace/protocol";
import { processIsAlive } from "@workspace/protocol/bridge-host";
import { isClaudeHookEvent } from "../core/claude-hooks.ts";
import { bridgePaths } from "./agent-bridge.ts";
import { type AgentHookSpec, approvalForwardTimeoutMs, type BaseHookIO, FORWARD_TIMEOUT_MS, findAgentPid, post, readStdin, runAgentHook } from "./agent-hook-client.ts";
import { agentLogger } from "./agent-log.ts";
import { launchBridge } from "./bridge-launch.ts";
import { approvalTimeoutMs, type ClaudeBridgeConfig, encodeBridgeConfig } from "./claude-bridge.ts";

export type HookIO = BaseHookIO<ClaudeBridgeConfig> & { claudePid(): number | undefined };

/** Fields the bridge never needs: the prompt and the reply text stay out of the hook channel. */
const DROPPED = new Set(["prompt", "last_assistant_message"]);

const CLAUDE_HOOK: AgentHookSpec<ClaudeBridgeConfig, HookIO> = {
	prefix: "claude",
	isEvent: isClaudeHookEvent,
	async startConfig(payload, sessionId, io) {
		const transcript = payload.transcript_path;
		if (typeof transcript !== "string" || !isAbsolute(transcript) || !transcript.endsWith(".jsonl") || transcript.length > 4096) return undefined;
		const source = typeof payload.source === "string" && /^[a-z_-]{1,20}$/.test(payload.source) ? payload.source : "startup";
		const pid = io.claudePid();
		return {
			sessionId,
			transcriptPath: transcript,
			cwd: typeof payload.cwd === "string" && payload.cwd.length <= 4096 ? payload.cwd : "",
			source,
			approvalTimeoutMs: approvalTimeoutMs(io.hostConfig()),
			...(pid === undefined ? {} : { claudePid: pid }),
		};
	},
	body: (payload) => Object.fromEntries(Object.entries(payload).filter(([key]) => !DROPPED.has(key))),
	forwardTimeoutMs: (event, io) => (event === "PermissionRequest" ? approvalForwardTimeoutMs(io.hostConfig()) : FORWARD_TIMEOUT_MS),
};

export function runClaudeHook(event: string, io: HookIO): Promise<void> {
	return runAgentHook(CLAUDE_HOOK, event, io);
}

/**
 * The Claude Code process that ran this hook: the parent, skipping a shell in between on Linux (read from /proc).
 * Elsewhere the parent itself: Windows hooks run in exec form, with Claude Code as the direct parent.
 */
export function findClaudePid(ppid: number = process.ppid, platform: NodeJS.Platform = process.platform, read: (path: string) => string = (path) => readFileSync(path, "utf8")): number | undefined {
	return findAgentPid(ppid, platform, read);
}

export function defaultHookIO(home: string = homedir()): HookIO {
	return {
		stdin: readStdin,
		stdout: (text) => new Promise((done) => process.stdout.write(`${text}\n`, () => done())),
		paths: bridgePaths(home),
		alive: processIsAlive,
		hostConfig: () => { try { return JSON.parse(readFileSync(join(home, `.${APP_ID}`, "host.json"), "utf8")); } catch { return undefined; } },
		claudePid: () => findClaudePid(),
		spawnBridge: (config) => launchBridge("claude", (env) => encodeBridgeConfig(env ? { ...config, env } : config), home),
		post,
		sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
		log: agentLogger(home),
	};
}
