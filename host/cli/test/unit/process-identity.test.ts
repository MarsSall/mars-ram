import { describe, expect, it } from "vitest";
import { processRuns, processStartTime } from "../../src/adapters/process-identity.ts";

/** A /proc/<pid>/stat line: fields 1–2, then field 3 (state) onward; starttime is field 22. */
const stat = (comm: string, starttime: string) => `4242 (${comm}) S ${Array.from({ length: 18 }, (_, i) => String(i + 4)).join(" ")} ${starttime} 23 24\n`;

describe("processStartTime", () => {
	it("Linux: field 22 of /proc/<pid>/stat, even when the command name holds spaces and parentheses", () => {
		const read = (path: string) => { expect(path).toBe("/proc/4242/stat"); return stat("node ) (x", "987654321"); };
		expect(processStartTime(4242, { platform: "linux", read })).toBe("987654321");
	});

	it("Linux: a process that is gone or a line that does not parse gives undefined", () => {
		expect(processStartTime(4242, { platform: "linux", read: () => { throw Object.assign(new Error("gone"), { code: "ENOENT" }); } })).toBeUndefined();
		expect(processStartTime(4242, { platform: "linux", read: () => "4242 (node) S 1 2" })).toBeUndefined();
		expect(processStartTime(4242, { platform: "linux", read: () => stat("node", "12a") })).toBeUndefined();
	});

	it("Windows: the process's creation ticks from PowerShell, without a shell", () => {
		const calls: { command: string; args: string[]; shell: unknown }[] = [];
		const run = (command: string, args: string[], options: { shell: false }) => { calls.push({ command, args, shell: options.shell }); return "638700000000000000\r\n"; };
		expect(processStartTime(4242, { platform: "win32", run })).toBe("638700000000000000");
		expect(calls).toHaveLength(1);
		expect(calls[0]!.command).toBe("powershell.exe");
		expect(calls[0]!.shell).toBe(false);
		expect(calls[0]!.args.at(-1)).toContain("GetProcessById(4242)");
	});

	it("Windows: a failure (gone, access denied, timeout) or odd output gives undefined", () => {
		expect(processStartTime(4242, { platform: "win32", run: () => { throw new Error("denied"); } })).toBeUndefined();
		expect(processStartTime(4242, { platform: "win32", run: () => "" })).toBeUndefined();
		expect(processStartTime(4242, { platform: "win32", run: () => "Exception calling" })).toBeUndefined();
	});

	it("other platforms and invalid pids: undefined, without reading anything", () => {
		const read = () => { throw new Error("must not read"); };
		const run = () => { throw new Error("must not run"); };
		expect(processStartTime(4242, { platform: "darwin", read, run })).toBeUndefined();
		expect(processStartTime(0, { platform: "linux", read, run })).toBeUndefined();
		expect(processStartTime(1.5, { platform: "win32", read, run })).toBeUndefined();
	});

	it.runIf(process.platform === "linux")("reads this process's real start time, the same each time", () => {
		const first = processStartTime(process.pid);
		expect(first).toMatch(/^\d+$/);
		expect(processStartTime(process.pid)).toBe(first);
	});
});

describe("processRuns", () => {
	const probe = (alive: boolean, start: string | undefined) => ({ alive: () => alive, startTime: () => start });
	it("a dead pid never runs", () => {
		expect(processRuns(100, "1", probe(false, "1"))).toBe(false);
		expect(processRuns(100, undefined, probe(false, undefined))).toBe(false);
	});
	it("a live pid with the recorded start time runs; another start time is another process", () => {
		expect(processRuns(100, "1", probe(true, "1"))).toBe(true);
		expect(processRuns(100, "1", probe(true, "2"))).toBe(false);
	});
	it("falls back to the pid when either start time is unknown", () => {
		expect(processRuns(100, undefined, probe(true, "2"))).toBe(true);
		expect(processRuns(100, "1", probe(true, undefined))).toBe(true);
	});
	it("does not read the start time of a dead pid or when none was recorded", () => {
		const startTime = () => { throw new Error("must not read"); };
		expect(processRuns(100, "1", { alive: () => false, startTime })).toBe(false);
		expect(processRuns(100, undefined, { alive: () => true, startTime })).toBe(true);
	});
});
