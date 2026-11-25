// Starting a session's bridge from its SessionStart hook so that it outlives the hook.
//
// Linux and macOS: a detached child, as always. Windows: an agent may run its hooks inside a Job Object that kills
// every process in it when the hook ends (Codex does: its hooks' bridges died with the hook, while the same command
// run by hand left a working bridge). A detached child stays in its parent's job, so on Windows the bridge is
// created through WMI (Win32_Process.Create): the WMI provider host starts it, outside the hook's job. WMI starts it
// with the user's default environment rather than the hook's, so the few variables the bridge reads (the session's
// Herdr pane and how to reach Herdr, the registry folder) travel inside its config. When WMI fails, the detached
// spawn is still tried, so nothing works worse than before.
import { execFile, spawn } from "node:child_process";
import { resolve } from "node:path";
import { NODE_FLAG } from "../core/agent-hooks.ts";

/** What the bridge reads from its environment; nothing else is carried. */
export const BRIDGE_ENV_KEYS = ["HERDR_PANE_ID", "HERDR_BIN_PATH", "HERDR_SOCKET_PATH", "HERDR_CONFIG_PATH", "HERDR_WORKSPACE_ID", "HERDR_TAB_ID", "PI_BRIDGE_REGISTRY_DIR"] as const;
export type BridgeEnv = Partial<Record<(typeof BRIDGE_ENV_KEYS)[number], string>>;

const MAX_ENV_VALUE = 4096;
const validEnvValue = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MAX_ENV_VALUE && !/[\x00-\x1F\x7F]/.test(value);

/** The bridge's variables from the hook's environment; undefined when there are none. */
export function pickBridgeEnv(env: NodeJS.ProcessEnv): BridgeEnv | undefined {
	const picked: BridgeEnv = {};
	for (const key of BRIDGE_ENV_KEYS) if (validEnvValue(env[key])) picked[key] = env[key];
	return Object.keys(picked).length ? picked : undefined;
}

/** A config's `env`: only known keys with bounded single-line text. */
export function validBridgeEnv(value: unknown): value is BridgeEnv {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	return Object.entries(value).every(([key, text]) => (BRIDGE_ENV_KEYS as readonly string[]).includes(key) && validEnvValue(text));
}

/** The bridge process's environment: the variables its config carries over its own. */
export function bridgeEnvironment(own: NodeJS.ProcessEnv, carried: BridgeEnv | undefined): NodeJS.ProcessEnv {
	return carried ? { ...own, ...carried } : own;
}

/**
 * The bridge's Windows command line: both paths double-quoted, the agent and the base64url config bare. The same
 * path rules as the installed Codex hook (absolute; no `"`, `%`, `!`, control characters or trailing backslash),
 * so nothing in it can be split or changed by CreateProcess's parsing. Undefined when something does not fit.
 */
export function bridgeCommandLine(node: string, main: string, agent: string, encoded: string): string | undefined {
	for (const path of [node, main]) {
		if (!/^(?:[A-Za-z]:\\|\\\\)/.test(path) || /["%!\x00-\x1F\x7F]/.test(path) || path.endsWith("\\")) return undefined;
	}
	if (!/^[a-z]{1,20}$/.test(agent) || !/^[A-Za-z0-9_-]{1,16384}$/.test(encoded)) return undefined;
	return `"${node}" ${NODE_FLAG} "${main}" bridge ${agent} ${encoded}`;
}

/**
 * Creates the process through WMI with a hidden window and prints `<ReturnValue>|<ProcessId>`. The command line and
 * folder come from variables, never from the script text. If the startup information cannot be built, the process
 * is created without it.
 */
export const WMI_CREATE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$arguments = @{ CommandLine = $env:MARS_RAM_BRIDGE_COMMAND_LINE; CurrentDirectory = $env:MARS_RAM_BRIDGE_CWD }
try {
	$class = Get-CimClass -ClassName Win32_ProcessStartup
	$arguments.ProcessStartupInformation = New-CimInstance -CimClass $class -ClientOnly -Property @{ ShowWindow = [uint16]0 }
} catch { }
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments $arguments
"$($result.ReturnValue)|$($result.ProcessId)"
`;

/** WMI's answer is in the hook's time budget (SessionStart allows 10 s on Claude Code, 20 s on Codex). */
const WMI_TIMEOUT_MS = 6000;

export type PowerShellRun = (script: string, vars: Record<string, string>, timeoutMs: number) => Promise<{ ok: true; stdout: string } | { ok: false; error: string }>;
export type WmiCreate = (commandLine: string, cwd: string) => Promise<{ ok: true; pid: number } | { ok: false; error: string }>;
/** Starts a detached child with no streams and no window; its pid, when known. */
export type DetachedSpawn = (file: string, args: string[], cwd: string) => number | undefined;

export function createWmiLauncher(run: PowerShellRun): WmiCreate {
	return async (commandLine, cwd) => {
		const result = await run(WMI_CREATE_SCRIPT, { MARS_RAM_BRIDGE_COMMAND_LINE: commandLine, MARS_RAM_BRIDGE_CWD: cwd }, WMI_TIMEOUT_MS);
		if (!result.ok) return result;
		const last = result.stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
		const match = /^(\d{1,10})\|(\d{0,10})$/.exec(last);
		if (!match) return { ok: false, error: "WMI gave no answer" };
		const code = Number(match[1]);
		const pid = Number(match[2]);
		if (code !== 0) return { ok: false, error: `WMI returned ${code}` };
		return pid > 0 ? { ok: true, pid } : { ok: false, error: "WMI gave no process id" };
	};
}

const runPowerShell: PowerShellRun = (script, vars, timeoutMs) => new Promise((done) => {
	execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, ...vars }, shell: false, windowsHide: true, timeout: timeoutMs, encoding: "utf8" }, (error, stdout) => {
		done(error ? { ok: false, error: error.killed ? "PowerShell timed out" : error.message } : { ok: true, stdout });
	});
});

export const detachedSpawn: DetachedSpawn = (file, args, cwd) => {
	const child = spawn(file, args, { detached: true, stdio: "ignore", windowsHide: true, shell: false, cwd, env: process.env });
	child.on("error", () => {});
	child.unref();
	return child.pid;
};

export type BridgeLaunch = { method: "wmi" | "spawn"; pid?: number; error?: string };

export type LaunchDeps = {
	platform: NodeJS.Platform;
	execPath: string;
	/** The CLI's main.ts. */
	main: string;
	env: NodeJS.ProcessEnv;
	wmi: WmiCreate;
	spawn: DetachedSpawn;
};

const cliMain = resolve(import.meta.dirname, "../main.ts");

/**
 * Starts `mars-ram bridge <agent> <config>`. `encode` builds the config, with the bridge's variables on Windows.
 * Never throws: a failed launch is reported in the result.
 */
export async function launchBridge(agent: string, encode: (env?: BridgeEnv) => string, home: string, deps: Partial<LaunchDeps> = {}): Promise<BridgeLaunch> {
	const platform = deps.platform ?? process.platform;
	const node = deps.execPath ?? process.execPath;
	const main = deps.main ?? cliMain;
	const start = deps.spawn ?? detachedSpawn;
	let error: string | undefined;
	let encoded: string;
	if (platform === "win32") {
		encoded = encode(pickBridgeEnv(deps.env ?? process.env));
		const line = bridgeCommandLine(node, main, agent, encoded);
		if (line === undefined) error = "unsafe path for WMI";
		else {
			try {
				const created = await (deps.wmi ?? createWmiLauncher(runPowerShell))(line, home);
				if (created.ok) return { method: "wmi", pid: created.pid };
				error = created.error;
			} catch (thrown) {
				error = thrown instanceof Error ? thrown.message : String(thrown);
			}
		}
	} else encoded = encode();
	let pid: number | undefined;
	try { pid = start(node, [NODE_FLAG, main, "bridge", agent, encoded], home); } catch (thrown) {
		error = [error, thrown instanceof Error ? thrown.message : String(thrown)].filter(Boolean).join("; ");
	}
	return { method: "spawn", ...(pid === undefined ? {} : { pid }), ...(error === undefined ? {} : { error }) };
}
