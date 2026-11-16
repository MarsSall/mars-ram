// `mars-ram update` adapters: package location, shell-free package manager runs, the new package, the Windows window.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunResult } from "../../src/core/update.ts";
import { callerPids, findInstalledPackage, findManager, globalRoots, managerRunner, packageBinOf, packagesUnder, readInstalledVersion, runCaptured, waitForExit, windowCommand, windowsExeShim, windowsShimEntry } from "../../src/adapters/update.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "mars-ram-update-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

function packageAt(folder: string, version: string, name = "mars-ram"): string {
	mkdirSync(join(folder, "bin"), { recursive: true });
	writeFileSync(join(folder, "package.json"), JSON.stringify({ name, version }));
	writeFileSync(join(folder, "bin", "mars-ram.mjs"), "// launcher\n");
	return join(folder, "bin", "mars-ram.mjs");
}

describe("packageBinOf", () => {
	it("uses the launcher's MARS_RAM_PACKAGE_BIN, then install.json's packageBin, only when they name a mars-ram package", () => {
		const bin = packageAt(join(root, "pkg"), "0.1.7");
		const other = packageAt(join(root, "other"), "1.0.0", "other");
		expect(packageBinOf(bin, root)).toBe(bin);
		expect(packageBinOf(other, root)).toBeUndefined();
		expect(packageBinOf("relative/bin/mars-ram.mjs", root)).toBeUndefined();
		expect(packageBinOf(undefined, root)).toBeUndefined();
		mkdirSync(join(root, ".mars-ram"));
		writeFileSync(join(root, ".mars-ram", "install.json"), JSON.stringify({ packageBin: bin }));
		expect(packageBinOf(undefined, root)).toBe(bin);
		expect(packageBinOf("", root)).toBe(bin);
		writeFileSync(join(root, ".mars-ram", "install.json"), JSON.stringify({ packageBin: other }));
		expect(packageBinOf(undefined, root)).toBeUndefined();
	});
});

describe("windowsShimEntry", () => {
	it.each([
		// npm's cmd-shim (pnpm installed with npm), Node's own npm.cmd, pnpm's cmd-shim (corepack-style target).
		['endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\pnpm\\bin\\pnpm.cjs" %*\r\n', "C:\\npm\\pnpm.cmd", "C:\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs"],
		['SET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"\r\n"%NODE_EXE%" "%NPM_CLI_JS%" %*\r\n', "C:\\Program Files\\nodejs\\npm.cmd", "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js"],
		['@SETLOCAL\r\n@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\..\\corepack\\dist\\pnpm.js" %*\r\n)\r\n', "C:\\nodejs\\bin\\pnpm.cmd", "C:\\nodejs\\corepack\\dist\\pnpm.js"],
	])("resolves %j", (shim, path, entry) => {
		expect(windowsShimEntry(shim, path)).toBe(entry);
	});

	it("does not resolve shims that run something else", () => {
		expect(windowsShimEntry("@echo off\r\nvolta run %~n0 %*\r\n", "C:\\volta\\pnpm.cmd")).toBeUndefined();
		expect(windowsShimEntry('@echo off\r\n"%~dpn0.exe" %*\r\n', "C:\\x\\pnpm.cmd")).toBeUndefined();
	});
});

// pnpm 11 standalone's C:\Users\<user>\.pnpm\bin\pnpm.CMD, byte for byte (seen on a real Windows PC).
const PNPM11_SHIM = '@SETLOCAL\r\n@"%~dp0\\..\\global\\v11\\32b0-1a15679ec9f\\node_modules\\@pnpm\\exe\\pnpm.exe"   %*\r\n';
const PNPM11_CMD = "C:\\Users\\alex\\.pnpm\\bin\\pnpm.CMD";
const PNPM11_EXE = "C:\\Users\\alex\\.pnpm\\global\\v11\\32b0-1a15679ec9f\\node_modules\\@pnpm\\exe\\pnpm.exe";

describe("windowsExeShim", () => {
	it("resolves pnpm 11's shim, which runs an .exe inside its own tool home", () => {
		expect(PNPM11_SHIM.length).toBe(89); // The 89 bytes of the real file.
		expect(windowsExeShim(PNPM11_SHIM, PNPM11_CMD)).toBe(PNPM11_EXE);
	});

	it.each([
		['"%~dp0\\..\\global\\pnpm.exe" %*', "C:\\Users\\alex\\.pnpm\\global\\pnpm.exe"],
		['SETLOCAL\n"%~dp0..\\global\\pnpm.exe"', "C:\\Users\\alex\\.pnpm\\global\\pnpm.exe"],
		['@SETLOCAL\r\n\r\n@"%~dp0/pnpm.EXE"\t%*', "C:\\Users\\alex\\.pnpm\\bin\\pnpm.EXE"],
	])("accepts the variant %j", (shim, exe) => {
		expect(windowsExeShim(shim, PNPM11_CMD)).toBe(exe);
	});

	it.each([
		['@SETLOCAL\r\n@"%~dp0\\..\\..\\evil.exe" %*'], // Escapes the tool home (C:\Users\alex\.pnpm).
		['@"%~dp0\\..\\..\\.pnpm\\x\\..\\..\\..\\evil.exe" %*'],
		['@"%~dp0\\..\\global\\pnpm.cmd" %*'], // Not an .exe.
		['@"%~dp0\\..\\global\\pnpm.exe:ads.exe" %*'],
		['@"%~dp0\\..\\global\\pnpm.exe" --silent %*'], // Extra arguments.
		['@"%~dp0\\..\\global\\pnpm.exe" %* & calc'],
		['@"%~dp0\\..\\%PNPM_HOME%\\pnpm.exe" %*'], // Other variables.
		['@"%~dp0\\..\\!X!\\pnpm.exe" %*'],
		['@SET "PATH=C:\\evil"\r\n@"%~dp0\\..\\global\\pnpm.exe" %*'], // Environment tricks.
		['@SETLOCAL\r\n@"%~dp0\\..\\global\\pnpm.exe" %*\r\n@echo done'], // A second command.
		['@SETLOCAL\r\n@SETLOCAL\r\n@"%~dp0\\..\\global\\pnpm.exe" %*'],
		['@"C:\\Users\\alex\\.pnpm\\global\\pnpm.exe" %*'], // Not relative to the shim.
		['@%~dp0\\..\\global\\pnpm.exe %*'], // Unquoted.
		['@"%~dpn0.exe" %*'],
		['@"%~dp0\\..\\global\\pnpm.exe" %1'],
		[""],
	])("refuses %j", (shim) => {
		expect(windowsExeShim(shim, PNPM11_CMD)).toBeUndefined();
	});

	it("refuses a shim in a drive's root, which has no tool home", () => {
		expect(windowsExeShim('@"%~dp0pnpm.exe" %*', "C:\\pnpm.cmd")).toBeUndefined();
	});
});

describe("findManager", () => {
	const files = new Map<string, string>();
	const options = (path: string) => ({ platform: "win32" as const, path, isFile: (file: string) => files.has(file.toLowerCase()), read: (file: string) => files.get(file.toLowerCase()) });
	beforeEach(() => files.clear());

	it("runs by name outside Windows; the system finds it or reports ENOENT", () => {
		expect(findManager("pnpm", { platform: "linux", path: "", isFile: () => false, read: () => undefined })).toEqual({ command: "pnpm", prefix: [] });
	});

	it("on Windows prefers an .exe, resolves a .cmd to Node plus its entry, and never runs the batch file", () => {
		files.set("c:\\pnpm\\pnpm.exe", "");
		expect(findManager("pnpm", options('"C:\\pnpm";C:\\npm'))).toEqual({ command: "C:\\pnpm\\pnpm.exe", prefix: [] });
		files.clear();
		files.set("c:\\npm\\pnpm.cmd", '"%_prog%"  "%dp0%\\node_modules\\pnpm\\bin\\pnpm.cjs" %*');
		files.set("c:\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs", "");
		expect(findManager("pnpm", options("C:\\empty;C:\\npm"))).toEqual({ command: process.execPath, prefix: ["C:\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs"] });
	});

	it("on Windows a missing manager is undefined and an unreadable shim is an error", () => {
		expect(findManager("bun", options("C:\\empty"))).toBeUndefined();
		files.set("c:\\volta\\pnpm.cmd", "@echo off\r\nvolta run %~n0 %*\r\n");
		expect(() => findManager("pnpm", options("C:\\volta"))).toThrow("Unsupported pnpm.cmd launcher: it cannot run without a shell.");
		files.set("c:\\gone\\pnpm.cmd", '"%dp0%\\node_modules\\pnpm\\bin\\pnpm.cjs"');
		expect(() => findManager("pnpm", options("C:\\gone"))).toThrow("Unsupported pnpm.cmd launcher");
	});

	it("on Windows runs the .exe that pnpm 11's shim forwards to, directly", () => {
		files.set(PNPM11_CMD.toLowerCase(), PNPM11_SHIM);
		files.set(PNPM11_EXE.toLowerCase(), "");
		expect(findManager("pnpm", options("C:\\Users\\alex\\.pnpm\\bin;C:\\npm"))).toEqual({ command: PNPM11_EXE, prefix: [] });
	});

	it("on Windows refuses pnpm 11's shim when its .exe is not there, and an .exe shim escaping its tool home", () => {
		files.set(PNPM11_CMD.toLowerCase(), PNPM11_SHIM);
		expect(() => findManager("pnpm", options("C:\\Users\\alex\\.pnpm\\bin"))).toThrow("Unsupported pnpm.cmd launcher");
		files.set("c:\\tools\\bin\\pnpm.cmd", '@"%~dp0\\..\\..\\evil.exe" %*');
		files.set("c:\\evil.exe", "");
		expect(() => findManager("pnpm", options("C:\\tools\\bin"))).toThrow("Unsupported pnpm.cmd launcher");
	});
});

describe("managerRunner", () => {
	it("asks for the global root and updates through pnpm 11's .exe, with argument arrays", async () => {
		const files = new Map([[PNPM11_CMD.toLowerCase(), PNPM11_SHIM], [PNPM11_EXE.toLowerCase(), ""]]);
		const calls: [string, string[]][] = [];
		const run = managerRunner(
			{ platform: "win32", path: "C:\\Users\\alex\\.pnpm\\bin", isFile: (file) => files.has(file.toLowerCase()), read: (file) => files.get(file.toLowerCase()) },
			async (command, args) => { calls.push([command, args]); return { ok: true, stdout: "" }; },
		);
		await run("pnpm", ["root", "-g"]);
		await run("pnpm", ["add", "-g", "mars-ram@latest"]);
		expect(calls).toEqual([[PNPM11_EXE, ["root", "-g"]], [PNPM11_EXE, ["add", "-g", "mars-ram@latest"]]]);
		expect(await run("bun", ["root", "-g"])).toEqual({ ok: false, missing: true });
	});

	it("reports an unsupported shim as a failure to ask, and runs nothing", async () => {
		const calls: string[] = [];
		const run = managerRunner(
			{ platform: "win32", path: "C:\\volta", isFile: (file) => file.toLowerCase() === "c:\\volta\\pnpm.cmd", read: () => "@echo off\r\nvolta run %~n0 %*\r\n" },
			async (command) => { calls.push(command); return { ok: true, stdout: "" }; },
		);
		expect(await run("pnpm", ["root", "-g"])).toEqual({ ok: false, error: "Unsupported pnpm.cmd launcher: it cannot run without a shell." });
		expect(calls).toEqual([]);
	});
});

describe("runCaptured", () => {
	it("captures the output and exit code of a failure, without a shell", async () => {
		const result = await runCaptured(process.execPath, ["-e", "process.stdout.write('out'); process.stderr.write('err; $(echo no)'); process.exit(3)"]);
		expect(result).toEqual({ ok: false, code: 3, stdout: "out", stderr: "err; $(echo no)" });
	});

	it("reports success with its output, and a program that does not exist as missing", async () => {
		expect(await runCaptured(process.execPath, ["-e", "console.log('/global/root')"])).toEqual({ ok: true, stdout: "/global/root\n" });
		expect(await runCaptured(join(root, "no-such-manager"), [])).toEqual({ ok: false, missing: true });
	});
});

describe("findInstalledPackage", () => {
	it("finds the package in npm's and pnpm 9/10's global root (root/mars-ram)", () => {
		const bin = packageAt(join(root, "mars-ram"), "0.1.8");
		expect(findInstalledPackage([root])).toEqual({ entry: bin, version: "0.1.8" });
	});

	it("finds pnpm 11's isolated global folders (root/<id>/node_modules/mars-ram) and picks the newest", () => {
		packageAt(join(root, "1627aa-1a1c7f6f1e4", "node_modules", "mars-ram"), "0.1.7");
		const newest = packageAt(join(root, "1981e0-18dd7eb16bdbdf3e-0", "node_modules", "mars-ram"), "0.1.10");
		packageAt(join(root, "31752-18de", "node_modules", "mars-ram"), "9.9.9", "not-mars-ram");
		mkdirSync(join(root, "unrelated"));
		expect(findInstalledPackage([root])).toEqual({ entry: newest, version: "0.1.10" });
	});

	it("is undefined when no root holds the package", () => {
		expect(findInstalledPackage([join(root, "missing"), root])).toBeUndefined();
	});
});

describe("windowCommand", () => {
	it("starts Node with the package launcher in a new console through cmd's start, quoted for cmd", () => {
		expect(windowCommand({ systemRoot: "C:\\Windows", node: "C:\\Program Files\\nodejs\\node.exe", bin: "C:\\Users\\ASUS\\AppData\\Local\\pnpm\\global\\5\\node_modules\\mars-ram\\bin\\mars-ram.mjs" })).toEqual({
			command: "C:\\Windows\\System32\\cmd.exe",
			args: ["/d", "/v:off", "/s", "/c", '"start "mars-ram update" "C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\ASUS\\AppData\\Local\\pnpm\\global\\5\\node_modules\\mars-ram\\bin\\mars-ram.mjs" update"'],
		});
	});

	it("refuses paths cmd would read differently", () => {
		for (const bin of ['C:\\a"b\\mars-ram.mjs', "C:\\%TEMP%\\mars-ram.mjs", "C:\\a\r\nb\\mars-ram.mjs"]) expect(windowCommand({ systemRoot: "C:\\Windows", node: "C:\\node.exe", bin })).toBeUndefined();
	});
});

describe("waitForExit", () => {
	it("polls until every process is gone, then pauses 1 s for cmd.exe to finish the old mars-ram.cmd", async () => {
		const alive = new Map([[41, 1], [42, 3]]);
		const sleeps: number[] = [];
		expect(await waitForExit([41, 42], { alive: (pid) => { const left = alive.get(pid) ?? 0; alive.set(pid, left - 1); return left > 0; }, sleep: async (ms) => { sleeps.push(ms); } })).toBe(true);
		// 41 is seen alive once, 42 three times (the first poll stops at 41): four polls, then the pause.
		expect(sleeps).toEqual([200, 200, 200, 200, 1000]);
	});

	it("reports false, never proceeding, when one is still running at the limit", async () => {
		let slept = 0;
		expect(await waitForExit([41, 42], { alive: (pid) => pid === 42, sleep: async (ms) => { slept += ms; }, limitMs: 1000 })).toBe(false);
		expect(slept).toBe(1000);
		const sleeps: number[] = [];
		expect(await waitForExit([], { alive: () => true, sleep: async (ms) => { sleeps.push(ms); } })).toBe(true);
		expect(sleeps).toEqual([1000]);
	});
});

describe("callerPids", () => {
	it("this CLI, its parent and the launcher's pid from the environment, each once; never the shell", () => {
		expect(callerPids({ MARS_RAM_LAUNCHER_PID: "21" }, 30, 20)).toEqual([30, 20, 21]);
		expect(callerPids({ MARS_RAM_LAUNCHER_PID: "20", MARS_RAM_LAUNCHER_PPID: "10" }, 30, 20)).toEqual([30, 20]);
		expect(callerPids({ MARS_RAM_LAUNCHER_PID: "x" }, 30, 20)).toEqual([30, 20]);
		expect(callerPids({}, 30, 20)).toEqual([30, 20]);
	});
});

describe("globalRoots (S4)", () => {
	it("asks npm and pnpm for their global root and reads Bun's folder; missing and failing managers are reported as such", async () => {
		const npmRoot = join(root, "npm-root"), bunRoot = join(root, "bun", "install", "global", "node_modules");
		packageAt(join(npmRoot, "mars-ram"), "0.1.6");
		packageAt(join(bunRoot, "mars-ram"), "0.1.6");
		const asked: string[] = [];
		const answers: Record<string, RunResult> = { npm: { ok: true, stdout: `npm notice\n${npmRoot}\n` }, pnpm: { ok: false, missing: true } };
		const run = async (manager: string, args: string[]) => { asked.push(`${manager} ${args.join(" ")}`); return answers[manager]!; };
		expect(await globalRoots(run, bunRoot)).toEqual([
			{ manager: "pnpm", state: "missing" },
			{ manager: "npm", state: "ok", packages: [realpathSync(join(npmRoot, "mars-ram"))] },
			{ manager: "bun", state: "ok", packages: [realpathSync(join(bunRoot, "mars-ram"))] },
		]);
		expect(asked).toEqual(["pnpm root -g", "npm root -g"]);
		answers.pnpm = { ok: false, code: 1, stdout: "", stderr: "boom" };
		answers.npm = { ok: false, error: "Unsupported npm.cmd launcher" };
		expect(await globalRoots(run, join(root, "no-bun"))).toEqual([{ manager: "pnpm", state: "failed" }, { manager: "npm", state: "failed" }, { manager: "bun", state: "missing" }]);
		answers.pnpm = { ok: true, stdout: "\n" };
		expect((await globalRoots(run, bunRoot))[0]).toEqual({ manager: "pnpm", state: "failed" });
	});
});

describe("packagesUnder", () => {
	it("returns real package folders: root/mars-ram and pnpm 11's root/<id>/node_modules/mars-ram links into its store", () => {
		const store = join(root, "custom-store", "v11", "links", "@", "mars-ram", "0.1.6", "984a01", "node_modules", "mars-ram");
		packageAt(store, "0.1.6");
		const global = join(root, "global", "v11");
		mkdirSync(join(global, "1627aa-1a1c7f6f1e4", "node_modules"), { recursive: true });
		symlinkSync(store, join(global, "1627aa-1a1c7f6f1e4", "node_modules", "mars-ram"));
		packageAt(join(global, "other", "node_modules", "mars-ram"), "1.0.0", "not-mars-ram");
		expect(packagesUnder(global)).toEqual([realpathSync(store)]);
		expect(packagesUnder(join(root, "missing"))).toEqual([]);
	});
});

describe("readInstalledVersion (S5)", () => {
	it("reads the version of the mars-ram package still in that folder, or undefined", () => {
		const dir = join(root, "pkg");
		packageAt(dir, "0.1.6");
		expect(readInstalledVersion(dir)).toBe("0.1.6");
		writeFileSync(join(dir, "package.json"), "{");
		expect(readInstalledVersion(dir)).toBeUndefined();
		packageAt(dir, "0.1.6", "other");
		expect(readInstalledVersion(dir)).toBeUndefined();
		expect(readInstalledVersion(join(root, "gone"))).toBeUndefined();
	});
});
