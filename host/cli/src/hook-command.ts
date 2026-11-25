// Composition for the agent hooks: `mars-ram hook claude|codex <event>` (run by the agent for each installed hook)
// and `mars-ram bridge claude|codex <config>` (the per-session bridge process the SessionStart hook starts).
import { homedir } from "node:os";
import { agentLogger } from "./adapters/agent-log.ts";
import { bridgeEnvironment } from "./adapters/bridge-launch.ts";
import { bridgePaths, type ClaudeBridgeConfig, decodeBridgeConfig, runClaudeBridge } from "./adapters/claude-bridge.ts";
import { defaultHookIO, runClaudeHook } from "./adapters/claude-hook-client.ts";
import { type CodexBridgeConfig, decodeCodexBridgeConfig, runCodexBridge } from "./adapters/codex-bridge.ts";
import { defaultCodexHookIO, runCodexHook } from "./adapters/codex-hook-client.ts";

/**
 * Only a Claude Code the user runs in a terminal is a session for the phone. Claude Code started through the Agent
 * SDK or `claude -p` (for example Gentle Shell or another harness using Claude as its model engine) reads the same
 * settings.json and runs the same hooks; it sets CLAUDE_CODE_ENTRYPOINT to something other than "cli", so its hooks
 * do nothing. An older Claude Code that does not set it is treated as interactive.
 */
export function isInteractiveClaude(env: NodeJS.ProcessEnv): boolean {
	const entrypoint = env.CLAUDE_CODE_ENTRYPOINT;
	return entrypoint === undefined || entrypoint === "" || entrypoint === "cli";
}

/** Always 0: a hook's exit code 2 would block the agent (a prompt, a stop), and any other failure is noise. */
export async function hookCommand(args: string[]): Promise<number> {
	const [agent, event, ...rest] = args;
	if (event === undefined || rest.length) return 0;
	try {
		if (agent === "claude") { if (isInteractiveClaude(process.env)) await runClaudeHook(event, defaultHookIO()); }
		else if (agent === "codex") await runCodexHook(event, defaultCodexHookIO());
	} catch { /* Never in the agent's way. */ }
	return 0;
}

export async function bridgeCommand(args: string[]): Promise<number> {
	const [agent, encoded, ...rest] = args;
	if ((agent !== "claude" && agent !== "codex") || encoded === undefined || rest.length) return 2;
	const config = agent === "claude" ? decodeBridgeConfig(encoded) : decodeCodexBridgeConfig(encoded);
	if (!config) return 2;
	const home = homedir();
	// On Windows the bridge is created through WMI with the user's default environment: the session's Herdr pane
	// and the registry folder come in its config.
	const env = bridgeEnvironment(process.env, config.env);
	const deps = { paths: bridgePaths(home, env), env, log: agentLogger(home) };
	let running;
	try {
		running = agent === "claude" ? await runClaudeBridge(config as ClaudeBridgeConfig, deps) : await runCodexBridge(config as CodexBridgeConfig, deps);
	} catch {
		// Logged by the bridge.
		return 1;
	}
	if (!running) return 0;
	const bridge = running;
	// Windows delivers no SIGTERM (it terminates the process) and SIGBREAK for Ctrl+Break; an orderly exit that skips
	// stop() still takes the bridge's files away. A process killed from outside runs nothing: hooks prune after it.
	for (const signal of ["SIGTERM", "SIGINT", "SIGHUP", "SIGBREAK"] as const) process.on(signal, () => void bridge.stop(`signal-${signal}`));
	process.on("exit", () => bridge.removeFiles());
	await bridge.done;
	return 0;
}
