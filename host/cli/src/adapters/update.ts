// `mars-ram update` boundary: the package's location, package manager runs (argument arrays, never a shell string), the
// freshly installed package, and on Windows the window the update continues in.
import { spawn } from "node:child_process";
import { readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, win32 } from "node:path";
import type { GlobalRoot, InstalledPackage, PackageManager, RunResult, UpdatePorts } from "../core/update.ts";
import { newestPackage } from "../core/update.ts";
import { readWindowsPrivileges } from "./authorized-keys.ts";
import { isPackageEntry, readSmallFile } from "./cli-installation.ts";
import { readRelease } from "./release-version.ts";
import { askLine } from "./terminal.ts";

/** Set in the window the update continues in: the pids of the first terminal's processes, which it waits for. */
const CALLERS = "MARS_RAM_UPDATE_CALLERS";
/** Set by the package launcher (npm/mars-ram.mjs): its own pid. */
const LAUNCHER_PID = "MARS_RAM_LAUNCHER_PID";
const WAIT_LIMIT_MS = 30_000;
/** After the launcher exits, the shell reads the rest of the old mars-ram.cmd; this leaves it that long to do so. */
const SHELL_GRACE_MS = 1000;
const BIN = join("bin", "mars-ram.mjs");
const OUTPUT_LIMIT = 64 * 1024;

/** The launcher's MARS_RAM_PACKAGE_BIN, else install.json's packageBin; only the bin of a package named mars-ram counts. */
export function packageBinOf(named: string | undefined, home: string): string | undefined {
	const valid = (path: unknown): path is string => typeof path === "string" && isAbsolute(path) && isPackageEntry(path);
	if (named) return valid(named) ? named : undefined;
	try {
		const recorded: unknown = JSON.parse(readSmallFile(join(home, ".mars-ram", "install.json")) ?? "{}").packageBin;
		return valid(recorded) ? recorded : undefined;
	} catch { return undefined; }
}

/** npm's cmd-shim and Node's npm.cmd use %dp0% or %~dp0 for the Node entry; never execute or interpolate the batch file. */
export function windowsShimEntry(shim: string, shimPath: string): string | undefined {
	const match = shim.match(/(?:%~dp0|%dp0%)[\\/]([^"%*\r\n]+?\.[cm]?js)"/i);
	return match?.[1] ? win32.resolve(win32.dirname(shimPath), match[1]) : undefined;
}

/** The one command line of an .exe shim: `@"%~dp0<relative path>"`, then at most `%*`. No other variable, operator or argument. */
const EXE_SHIM_LINE = /^@?"%~dp0([^"%!^&|<>:*?\x00-\x1f]+)"[ \t]*(?:%\*)?$/i;

/**
 * pnpm 11 standalone's shim (`@SETLOCAL`, then `@"%~dp0\..\global\v11\<id>\node_modules\@pnpm\exe\pnpm.exe"   %*`)
 * forwards to an .exe: the .exe it names, which must stay inside the shim's tool home (the folder above the shim's own,
 * `C:\Users\<user>\.pnpm` there). Anything else is undefined; the caller checks that the file exists.
 */
export function windowsExeShim(shim: string, shimPath: string): string | undefined {
	const lines = shim.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	if (lines.length === 2 && /^@?setlocal$/i.test(lines[0] ?? "")) lines.shift();
	const relative = lines.length === 1 ? lines[0]?.match(EXE_SHIM_LINE)?.[1] : undefined;
	if (!relative || !win32.isAbsolute(shimPath)) return undefined;
	const home = win32.dirname(win32.dirname(shimPath));
	if (win32.parse(home).root === home) return undefined;
	const exe = win32.join(win32.dirname(shimPath), relative);
	return /\.exe$/i.test(exe) && exe.toLowerCase().startsWith(`${home.toLowerCase()}\\`) ? exe : undefined;
}

type Lookup = { platform: NodeJS.Platform; path: string; isFile(path: string): boolean; read(path: string): string | undefined };

/**
 * Outside Windows the system finds the manager (ENOENT when absent). On Windows Node cannot run a .cmd without a shell:
 * an .exe runs directly, a .cmd shim forwarding to an .exe (pnpm 11) runs that .exe, and a Node shim runs as Node plus
 * the entry it names. Undefined: not on PATH.
 */
export function findManager(manager: PackageManager, lookup: Lookup): { command: string; prefix: string[] } | undefined {
	if (lookup.platform !== "win32") return { command: manager, prefix: [] };
	for (const directory of lookup.path.split(";").map((entry) => entry.replace(/^"|"$/g, "")).filter(Boolean)) {
		const exe = win32.join(directory, `${manager}.exe`), cmd = win32.join(directory, `${manager}.cmd`);
		if (lookup.isFile(exe)) return { command: exe, prefix: [] };
		if (!lookup.isFile(cmd)) continue;
		const shim = lookup.read(cmd) ?? "";
		const target = windowsExeShim(shim, cmd);
		if (target) {
			if (!lookup.isFile(target)) throw new Error(`Unsupported ${manager}.cmd launcher: it cannot run without a shell.`);
			return { command: target, prefix: [] };
		}
		const entry = windowsShimEntry(shim, cmd);
		if (!entry || !lookup.isFile(entry)) throw new Error(`Unsupported ${manager}.cmd launcher: it cannot run without a shell.`);
		return { command: process.execPath, prefix: [entry] };
	}
	return undefined;
}

/** Runs a manager, found as above, with an argument array: the root queries and the update itself go through here. */
export function managerRunner(lookup: Lookup, exec: (command: string, args: string[]) => Promise<RunResult> = runCaptured) {
	return async (manager: PackageManager, args: string[]): Promise<RunResult> => {
		let found;
		try { found = findManager(manager, lookup); } catch (error) { return { ok: false, error: (error as Error).message }; }
		return found ? exec(found.command, [...found.prefix, ...args]) : { ok: false, missing: true };
	};
}

/** Runs with stdin from the terminal and captures output (the last 64 KiB of each stream) to explain a failure. */
export function runCaptured(command: string, args: string[]): Promise<RunResult> {
	return new Promise((resolve) => {
		const output = { stdout: "", stderr: "" };
		const child = spawn(command, args, { stdio: ["inherit", "pipe", "pipe"], shell: false, windowsHide: true });
		for (const name of ["stdout", "stderr"] as const) {
			child[name].setEncoding("utf8");
			child[name].on("data", (chunk: string) => { output[name] = (output[name] + chunk).slice(-OUTPUT_LIMIT); });
		}
		child.on("error", (error: NodeJS.ErrnoException) => resolve(error.code === "ENOENT" ? { ok: false, missing: true } : { ok: false, error: error.message }));
		child.on("close", (code) => resolve(code === 0 ? { ok: true, stdout: output.stdout } : { ok: false, code: code ?? 1, ...output }));
	});
}

function isFile(path: string): boolean {
	try { return statSync(path).isFile(); } catch { return false; }
}

/** Real folders of the mars-ram packages in a global root: `root/mars-ram` (npm, pnpm 9/10, Bun) and pnpm 11's
 * `root/<id>/node_modules/mars-ram`, which link into its store. */
export function packagesUnder(root: string): string[] {
	let folders: string[] = [];
	try { folders = readdirSync(root); } catch { return []; }
	const found = new Set<string>();
	for (const dir of [join(root, "mars-ram"), ...folders.map((folder) => join(root, folder, "node_modules", "mars-ram"))]) {
		if (!isPackageEntry(join(dir, BIN))) continue;
		try { found.add(realpathSync(dir)); } catch { /* Gone meanwhile. */ }
	}
	return [...found];
}

/** Asks pnpm and npm for their global root (`root -g`, read-only) and reads Bun's global folder, which has no such command. */
export async function globalRoots(run: (manager: PackageManager, args: string[]) => Promise<RunResult>, bunRoot: string): Promise<GlobalRoot[]> {
	const roots: GlobalRoot[] = [];
	for (const manager of ["pnpm", "npm"] as const) {
		const result = await run(manager, ["root", "-g"]);
		const root = result.ok ? result.stdout?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) : undefined;
		if (!result.ok && "missing" in result) roots.push({ manager, state: "missing" });
		else roots.push(root && isAbsolute(root) ? { manager, state: "ok", packages: packagesUnder(root) } : { manager, state: "failed" });
	}
	let bun = false;
	try { bun = statSync(bunRoot).isDirectory(); } catch { /* No Bun globals. */ }
	roots.push(bun ? { manager: "bun", state: "ok", packages: packagesUnder(bunRoot) } : { manager: "bun", state: "missing" });
	return roots;
}

/** The version in that folder's package.json when it is still the mars-ram package. */
export function readInstalledVersion(dir: string): string | undefined {
	try {
		const manifest: unknown = JSON.parse(readSmallFile(join(dir, "package.json")) ?? "null");
		if (!manifest || typeof manifest !== "object") return undefined;
		const { name, version } = manifest as Record<string, unknown>;
		return name === "mars-ram" && typeof version === "string" && version ? version : undefined;
	} catch { return undefined; }
}

/** `root/mars-ram` (npm, pnpm 9/10, Bun) or pnpm 11's `root/<id>/node_modules/mars-ram`; the newest release wins. */
export function findInstalledPackage(roots: string[]): InstalledPackage | undefined {
	const found: InstalledPackage[] = [];
	for (const root of roots) {
		let folders: string[] = [];
		try { folders = readdirSync(root); } catch { continue; }
		for (const entry of [join(root, "mars-ram", BIN), ...folders.map((folder) => join(root, folder, "node_modules", "mars-ram", BIN))]) {
			if (!isPackageEntry(entry)) continue;
			try {
				const version: unknown = JSON.parse(readSmallFile(join(dirname(dirname(entry)), "package.json")) ?? "{}").version;
				if (typeof version === "string") found.push({ entry, version });
			} catch { /* Not a readable package. */ }
		}
	}
	return newestPackage(found);
}

/** cmd's `start` is the only way to open a new console; paths with `"` or `%` (or line breaks) would be read differently. */
export function windowCommand(options: { systemRoot: string; node: string; bin: string }): { command: string; args: string[] } | undefined {
	if (/["%\r\n]/.test(options.node + options.bin)) return undefined;
	return { command: win32.join(options.systemRoot, "System32", "cmd.exe"), args: ["/d", "/v:off", "/s", "/c", `"start "mars-ram update" "${options.node}" "${options.bin}" update"`] };
}

/** This CLI, its parent (the launcher) and the pid the launcher passed, each once. Never the shell: typed into cmd or
 * PowerShell, the shell runs the script in its own process and stays open. */
export function callerPids(env: NodeJS.ProcessEnv, pid: number, ppid: number): number[] {
	const launcher = env[LAUNCHER_PID];
	return [...new Set([pid, ppid, ...(launcher && /^[1-9]\d*$/.test(launcher) ? [Number(launcher)] : [])])];
}

/** True once every process has exited, after a 1 s pause for the shell to finish the old mars-ram.cmd; false, without
 * the pause, when one still runs at the limit. */
export async function waitForExit(pids: number[], options: { alive?: (pid: number) => boolean; sleep?: (ms: number) => Promise<void>; limitMs?: number } = {}): Promise<boolean> {
	const alive = options.alive ?? ((id: number) => { try { process.kill(id, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; } });
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	for (let waited = 0; ; waited += 200) {
		if (!pids.some((pid) => alive(pid))) { await sleep(SHELL_GRACE_MS); return true; }
		if (waited >= (options.limitMs ?? WAIT_LIMIT_MS)) return false;
		await sleep(200);
	}
}

/** Runs a command of the new package as its own Node process, in this terminal; undefined when it could not start. */
function runEntry(entry: string, command: string, printError: (line: string) => void): Promise<number | undefined> {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [entry, command], { stdio: "inherit", shell: false });
		child.on("error", (error) => { printError(error.message); resolve(undefined); });
		child.on("close", (code) => resolve(code ?? 1));
	});
}

export function createUpdatePorts(print: (line: string) => void = console.log, printError: (line: string) => void = console.error): UpdatePorts {
	const env = process.env;
	const callers = (env[CALLERS] ?? "").split(",").filter((value) => /^[1-9]\d*$/.test(value)).map(Number);
	const lookup: Lookup = { platform: process.platform, path: env.PATH ?? env.Path ?? "", isFile, read: (path) => readSmallFile(path) };
	const run = managerRunner(lookup);
	const packageBin = packageBinOf(env.MARS_RAM_PACKAGE_BIN, homedir());
	let packageDir: string | undefined;
	try { packageDir = packageBin && realpathSync(dirname(dirname(packageBin))); } catch { /* Not a package after all. */ }
	// Bun has no `root -g`: its globals live in $BUN_INSTALL (default ~/.bun)/install/global/node_modules.
	const bunRoot = join(env.BUN_INSTALL || join(homedir(), ".bun"), "install", "global", "node_modules");
	return {
		platform: process.platform,
		packageBin,
		packageDir,
		currentVersion: readRelease(),
		inWindow: process.platform === "win32" && callers.length > 0,
		elevated: () => readWindowsPrivileges().elevated,
		globalRoots: () => globalRoots(run, bunRoot),
		async openWindow() {
			const command = packageBin && windowCommand({ systemRoot: env.SystemRoot ?? "C:\\Windows", node: process.execPath, bin: packageBin });
			if (!command) return false;
			const pids = callerPids(env, process.pid, process.ppid).join(",");
			return new Promise<boolean>((resolve) => {
				// Detached: the window outlives this process, which ends now so the shell finishes the old mars-ram.cmd first.
				const child = spawn(command.command, command.args, { detached: true, stdio: "ignore", windowsVerbatimArguments: true, env: { ...env, [CALLERS]: pids } });
				child.on("error", () => resolve(false));
				child.on("spawn", () => { child.unref(); resolve(true); });
			});
		},
		waitForCaller: () => waitForExit(callers),
		runManager: run,
		installedVersion: readInstalledVersion,
		async installedPackage(manager) {
			// Bun replaces its global folder in place; npm and pnpm say where their global packages are.
			if (manager === "bun") return findInstalledPackage([bunRoot]);
			const root = await run(manager, ["root", "-g"]);
			const folder = root.ok ? root.stdout?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) : undefined;
			return folder ? findInstalledPackage([folder]) : undefined;
		},
		runInstall: async (entry) => (await runEntry(entry, "install", printError)) ?? 1,
		runDoctor: (entry) => runEntry(entry, "doctor", printError),
		async waitForEnter() { await askLine(""); },
		print,
		printError,
	};
}
