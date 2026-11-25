// Which process a pid names. A pid alone is not an identity: once a process ends, the system may give its pid to an
// unrelated one, and a check that only asks "does this pid run?" then takes a dead owner for alive. So owners record
// their start time next to their pid, and a process with that pid but another start time is someone else.
// - Linux: field 22 of /proc/<pid>/stat (starttime, clock ticks since boot): one small file read.
// - Windows: the process's creation time in ticks, from PowerShell without a shell (about half a second, so callers
//   use it only where a wrong answer blocks a start, never on every hook).
// - Elsewhere, or whenever it cannot be read (the process is gone, access is denied, PowerShell fails): unknown, and
//   callers fall back to the pid alone, as before start times were recorded.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type StartTimeDeps = {
	platform?: NodeJS.Platform;
	read?: (path: string) => string;
	run?: (command: string, args: string[], options: { encoding: "utf8"; shell: false; windowsHide: true; timeout: number }) => string;
};

const START = /^\d{1,20}$/;

/** The process's start time as digits, or undefined when it cannot be known. */
export function processStartTime(pid: number, deps: StartTimeDeps = {}): string | undefined {
	if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
	const platform = deps.platform ?? process.platform;
	try {
		if (platform === "linux") {
			const stat = (deps.read ?? ((path) => readFileSync(path, "utf8")))(`/proc/${pid}/stat`);
			// The command name (field 2) is in parentheses and may hold anything, so count from the last `)`.
			const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(" ");
			const start = fields[19];
			return start !== undefined && START.test(start) ? start : undefined;
		}
		if (platform === "win32") {
			const run = deps.run ?? ((command, args, options) => execFileSync(command, args, options));
			// The pid is a validated integer; nothing else goes into the script text.
			const output = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `[System.Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToUniversalTime().Ticks`], { encoding: "utf8", shell: false, windowsHide: true, timeout: 5000 }).trim();
			return START.test(output) ? output : undefined;
		}
	} catch { /* Gone, denied or failed: unknown. */ }
	return undefined;
}

export type ProcessProbe = { alive(pid: number): boolean; startTime(pid: number): string | undefined };

/**
 * Whether the process recorded as `pid` with start time `start` still runs: the pid runs and, when both start times
 * are known, they are the same. With either one unknown it is the pid alone (a live pid counts as the owner).
 */
export function processRuns(pid: number, start: string | undefined, probe: ProcessProbe): boolean {
	if (!probe.alive(pid)) return false;
	if (start === undefined) return true;
	const now = probe.startTime(pid);
	return now === undefined || now === start;
}
