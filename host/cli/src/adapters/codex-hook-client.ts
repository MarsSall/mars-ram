// `mars-ram hook codex <event>`: what Codex runs for each installed hook (through its shell: `$SHELL -lc` on Linux,
// `%COMSPEC% /C` on Windows). Same rules as the Claude Code hook: always exit 0, print only a PermissionRequest
// decision, end at once without a bridge. SessionEnd and Interrupt must finish within Codex's 1–3 s limit.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { APP_ID } from "@workspace/protocol";
import { processIsAlive } from "@workspace/protocol/bridge-host";
import { isCodexHookEvent, MAX_HOOK_TEXT } from "../core/codex-hooks.ts";
import { approvalTimeoutMs, bridgePaths } from "./agent-bridge.ts";
import { type AgentHookSpec, approvalForwardTimeoutMs, type BaseHookIO, FORWARD_TIMEOUT_MS, findAgentPid, POSIX_SHELLS, post, readStdin, runAgentHook } from "./agent-hook-client.ts";
import { agentLogger } from "./agent-log.ts";
import { launchBridge } from "./bridge-launch.ts";
import { type CodexBridgeConfig, encodeCodexBridgeConfig, validRolloutPath } from "./codex-bridge.ts";

export type CodexHookIO = BaseHookIO<CodexBridgeConfig> & { codexPid(): Promise<number | undefined> };

/** Codex gives SessionEnd and Interrupt 1–3 s in all, Node's start included: the forward gets a fraction. */
const QUICK_FORWARD_MS = 1200;

const CODEX_HOOK: AgentHookSpec<CodexBridgeConfig, CodexHookIO> = {
	prefix: "codex",
	isEvent: isCodexHookEvent,
	async startConfig(payload, sessionId, io) {
		// transcript_path may be null, or (as its format is not a stable interface) something else than JSONL.
		const transcript = validRolloutPath(payload.transcript_path) ? payload.transcript_path : undefined;
		const source = typeof payload.source === "string" && /^[a-z_-]{1,20}$/.test(payload.source) ? payload.source : "startup";
		let pid: number | undefined;
		try { pid = await io.codexPid(); } catch { pid = undefined; }
		return {
			sessionId,
			...(transcript === undefined ? {} : { transcriptPath: transcript }),
			cwd: typeof payload.cwd === "string" && payload.cwd.length <= 4096 ? payload.cwd : "",
			source,
			approvalTimeoutMs: approvalTimeoutMs(io.hostConfig()),
			...(pid === undefined ? {} : { codexPid: pid }),
		};
	},
	// The prompt and the reply go to the bridge (bounded): they are its history when the rollout cannot be read.
	body: (payload) => Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, (key === "prompt" || key === "last_assistant_message") && typeof value === "string" ? value.slice(0, MAX_HOOK_TEXT) : value])),
	forwardTimeoutMs: (event, io) => (event === "PermissionRequest" ? approvalForwardTimeoutMs(io.hostConfig()) : event === "SessionEnd" || event === "Interrupt" ? QUICK_FORWARD_MS : FORWARD_TIMEOUT_MS),
};

export function runCodexHook(event: string, io: CodexHookIO): Promise<void> {
	return runAgentHook(CODEX_HOOK, event, io);
}

/** Login shells Codex may start the hook with on Linux ($SHELL -lc), beyond the plain POSIX ones. */
const LOGIN_SHELLS = new Set([...POSIX_SHELLS, "tcsh", "csh", "nu", "elvish", "xonsh", "pwsh", "yash", "oksh", "loksh"]);
/** Shells Codex may run a Windows hook command with (%COMSPEC% /C by default). */
const WINDOWS_SHELLS = new Set(["cmd.exe", "powershell.exe", "pwsh.exe", "bash.exe", "sh.exe"]);

export type WindowsProcessInfo = (pid: number) => Promise<{ name: string; parentPid: number } | undefined>;

/**
 * The Codex process that ran this hook. Linux: the parent, skipping login shells (read from /proc). Windows: the
 * parent is the shell Codex ran the command with (cmd.exe by default), so its parent is Codex; when the parent
 * cannot be read, undefined (the bridge then ends only with SessionEnd). Elsewhere undefined: the shell in between
 * cannot be skipped without /proc, and watching it would end the bridge with the hook.
 */
export async function findCodexPid(ppid: number = process.ppid, platform: NodeJS.Platform = process.platform, read: (path: string) => string = (path) => readFileSync(path, "utf8"), windowsProcess: WindowsProcessInfo = queryWindowsProcess): Promise<number | undefined> {
	if (!Number.isInteger(ppid) || ppid <= 1) return undefined;
	if (platform === "linux") return findAgentPid(ppid, platform, read, LOGIN_SHELLS);
	if (platform !== "win32") return undefined;
	const parent = await windowsProcess(ppid);
	if (!parent) return undefined;
	if (!WINDOWS_SHELLS.has(parent.name.toLowerCase())) return ppid;
	return Number.isInteger(parent.parentPid) && parent.parentPid > 4 ? parent.parentPid : undefined;
}

/** One process's image name and parent, read with PowerShell (no shell; the pid is an integer checked above). */
export const queryWindowsProcess: WindowsProcessInfo = (pid) => new Promise((resolveInfo) => {
	if (!Number.isInteger(pid) || pid <= 0) return resolveInfo(undefined);
	const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { "$($p.Name)|$($p.ParentProcessId)" }`;
	execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { shell: false, windowsHide: true, timeout: 3000, encoding: "utf8" }, (error, stdout) => {
		if (error) return resolveInfo(undefined);
		const match = /^([^|\r\n]{1,260})\|(\d{1,10})\s*$/.exec(stdout.trim());
		resolveInfo(match ? { name: match[1]!, parentPid: Number(match[2]) } : undefined);
	});
});

export function defaultCodexHookIO(home: string = homedir()): CodexHookIO {
	return {
		stdin: readStdin,
		stdout: (text) => new Promise((done) => process.stdout.write(`${text}\n`, () => done())),
		paths: bridgePaths(home),
		alive: processIsAlive,
		hostConfig: () => { try { return JSON.parse(readFileSync(join(home, `.${APP_ID}`, "host.json"), "utf8")); } catch { return undefined; } },
		codexPid: () => findCodexPid(),
		spawnBridge: (config) => launchBridge("codex", (env) => encodeCodexBridgeConfig(env ? { ...config, env } : config), home),
		post,
		sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
		log: agentLogger(home),
	};
}
