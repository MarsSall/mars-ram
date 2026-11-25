import { describe, expect, it } from "vitest";
import { runLaunch } from "../../src/core/launch.ts";
import { checkCodexHooks, checkPi, diagnose, type DoctorPorts } from "../../src/core/doctor.ts";
import type { ProcessRunner } from "../../src/core/herdr-switcher.ts";
import { fakeFiles } from "./fixtures/repo-files.ts";

function setup(reuse = false, agent = "codex") {
	const calls: string[][] = [];
	const run: ProcessRunner = async (_file, args, opts) => {
		expect(opts.shell).toBe(false); calls.push([...args]);
		let result: object = {};
		if (args[0] === "workspace" && args[1] === "list") result = { workspaces: reuse ? [{ workspace_id: "w1" }] : [] };
		if (args[0] === "pane" && args[1] === "list") result = { panes: reuse ? [{ workspace_id: "w1", tab_id: "w1:t1", pane_id: "w1:p1", cwd: "/work/repo", agent }] : [] };
		if (args[1] === "process-info") result = { process_info: { foreground_processes: [{ argv: ["codex"] }] } };
		if (args[1] === "create") result = { workspace: { workspace_id: "w2" }, tab: { tab_id: "w2:t1" }, root_pane: { pane_id: "w2:p1" } };
		return JSON.stringify({ result });
	};
	return { calls, deps: { files: fakeFiles({ "/work": "dir", "/work/repo": "dir", "/work/repo/.git": "dir" }), roots: ["/work"], run, herdr: "herdr", installed: async () => true } };
}

describe("launch program codex", () => {
	it("starts Codex as the fixed literal codex in a new workspace", async () => {
		const { deps, calls } = setup();
		expect(await runLaunch(["--repo", "/work/repo", "--program", "codex"], deps)).toMatchObject({ ok: true, reused: false, workspace: "w2" });
		expect(calls).toContainEqual(["workspace", "create", "--cwd", "/work/repo", "--label", "repo · codex", "--no-focus"]);
		expect(calls).toContainEqual(["pane", "run", "w2:p1", "codex"]);
	});

	it("reuses a pane Herdr reports as agent codex, and only that", async () => {
		const reuse = setup(true);
		expect(await runLaunch(["--repo", "/work/repo", "--program", "codex"], reuse.deps)).toMatchObject({ ok: true, reused: true, workspace: "w1", tab: "w1:t1" });
		expect(reuse.calls.some((args) => args[1] === "create" || args[1] === "run")).toBe(false);
		expect(await runLaunch(["--repo", "/work/repo", "--program", "codex"], setup(true, "claude").deps)).toMatchObject({ reused: false });
		expect(await runLaunch(["--repo", "/work/repo", "--program", "claude-code"], setup(true, "codex").deps)).toMatchObject({ reused: false });
	});

	it("refuses spellings that are not the allowlisted program", async () => {
		for (const program of ["Codex", "codex ", "codex;ls", "openai-codex"]) {
			const { deps, calls } = setup();
			expect(await runLaunch(["--repo", "/work/repo", "--program", program], deps)).toMatchObject({ ok: false, code: "PROGRAM_NOT_ALLOWED" });
			expect(calls).toHaveLength(0);
		}
	});
});

type CodexState = Awaited<ReturnType<NonNullable<DoctorPorts["codexHooks"]>>>;
const all = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "Stop", "Interrupt", "SessionEnd"];
const ports = (codex?: Partial<CodexState>, overrides: Partial<DoctorPorts> = {}): DoctorPorts => ({
	platform: "linux", spanish: false, herdr: async () => true, herdrMachines: async () => [],
	cli: async () => ({ resolved: true, command: "/home/alex/.local/bin/mars-ram", current: true, localBin: true }),
	linkServer: async () => ({ present: true, current: true, configured: true, validLinks: 0, listener: false }),
	piVersion: async () => "pi 1.2.0", installation: async () => ({ present: true, current: true, homes: [{ path: "/pi", registered: true }] }),
	registry: async () => ({ exists: true, entries: [], directoryMode: 0o700, modes: [] }),
	alive: () => true, acl: async () => ({ safe: true, administratorOwner: false }), keyLocks: async () => [],
	tailscale: async () => "100.64.0.1", zerotier: async () => [], zeroTierInterfaces: async () => [], firewall: async () => ({ ufw: "inactive", firewalld: "inactive" }), forwarding: async () => ({ allowed: true, keysAllowed: true }),
	windows: async () => ({ service: true, shell: "cmd" }),
	uploads: async () => ({ state: { ok: true, path: "/tmp/mars-ram-1000/uploads" }, legacy: false }),
	...(codex ? { codexHooks: async () => ({ detected: true, readable: true, registered: all, current: true, trust: { known: false }, ...codex }) } : {}),
	...overrides,
});
const trusted = (overrides: Record<string, "trusted" | "stale" | "untrusted" | "disabled"> = {}) => ({ known: true as const, events: { ...Object.fromEntries(all.map((event) => [event, "trusted" as const])), ...overrides } });

describe("doctor Codex hooks", () => {
	it("says nothing without Codex or without the port", async () => {
		expect(await checkCodexHooks(ports())).toEqual([]);
		expect(await checkCodexHooks(ports({ detected: false }))).toEqual([]);
	});

	it("reports registered and trusted hooks", async () => {
		expect(await checkCodexHooks(ports({ trust: trusted() }))).toEqual([
			{ status: "ok", finding: `Codex hooks registered: ${all.join(", ")}.` },
			{ status: "ok", finding: expect.stringMatching(/trusted in Codex/) },
		]);
	});

	it("reports untrusted and turned-off hooks with how to trust them in Codex", async () => {
		const findings = await checkCodexHooks(ports({ trust: trusted({ Interrupt: "untrusted", SessionEnd: "untrusted", Stop: "disabled" }) }));
		expect(findings.slice(1)).toEqual([
			{ status: "warning", finding: "Codex hooks turned off in Codex: Stop.", fix: expect.stringMatching(/\/hooks/) },
			{ status: "warning", finding: "Codex hooks not trusted yet, so Codex does not run them: Interrupt, SessionEnd.", fix: "Open Codex, type /hooks, review the mars-ram hooks and trust them." },
		]);
	});

	it("reports hooks whose recorded trust is for an older command as needing re-trust with /hooks", async () => {
		const findings = await checkCodexHooks(ports({ trust: trusted({ Stop: "stale", PermissionRequest: "stale" }) }));
		expect(findings).toEqual([
			{ status: "ok", finding: `Codex hooks registered: ${all.join(", ")}.` },
			{ status: "warning", finding: "Codex hooks need re-trust with /hooks: they changed since Codex trusted them, so Codex does not run them: PermissionRequest, Stop.", fix: "Open Codex, type /hooks, review the mars-ram hooks and trust them again." },
		]);
		const es = await checkCodexHooks({ ...ports({ trust: trusted({ Stop: "stale" }) }), spanish: true });
		expect(es[1]).toEqual({ status: "warning", finding: "Hooks de Codex que hay que volver a aprobar con /hooks: cambiaron desde que Codex los aprobó, así que no los ejecuta: Stop.", fix: "Abrí Codex, escribí /hooks, revisá los hooks de mars-ram y volvé a aprobarlos." });
	});

	it("notes that trust is unknown when config.toml cannot tell", async () => {
		expect(await checkCodexHooks(ports({}))).toMatchObject([{ status: "ok" }, { status: "warning", finding: expect.stringMatching(/could not be read from its config\.toml/), fix: expect.stringMatching(/\/hooks/) }]);
	});

	it("reports missing, outdated and unreadable hooks with the fix", async () => {
		expect(await checkCodexHooks(ports({ registered: [], current: false }))).toMatchObject([{ status: "warning", finding: expect.stringMatching(/not installed/), fix: expect.stringMatching(/mars-ram install/) }]);
		expect((await checkCodexHooks(ports({ registered: ["Stop"], current: false, trust: trusted() })))[0]).toMatchObject({ status: "warning", finding: expect.stringMatching(/outdated or incomplete \(Stop\)/) });
		expect(await checkCodexHooks(ports({ readable: false }))).toMatchObject([{ status: "warning", finding: expect.stringMatching(/could not be read/) }]);
	});

	it("Pi missing is only a warning when Codex is what this computer runs", async () => {
		const noPi = { piVersion: async () => { throw new Error("missing"); } };
		expect(await checkPi(ports(undefined, noPi))).toMatchObject([{ status: "problem" }]);
		expect(await checkPi(ports({ trust: trusted() }, noPi))).toMatchObject([{ status: "warning", finding: "Pi is unavailable on PATH; only Codex sessions can be followed." }]);
		const both = ports({ trust: trusted() }, { ...noPi, claudeHooks: async () => ({ detected: true, readable: true, registered: [], current: false }) });
		expect((await checkPi(both))[0]!.finding).toBe("Pi is unavailable on PATH; only Claude Code and Codex sessions can be followed.");
		expect((await diagnose(ports({ trust: trusted() }, noPi))).code).toBe(0);
	});
});

describe.skipIf(process.platform === "win32")("Codex program lookup", () => {
	it("finds Codex by its codex executable and records it as codex", async () => {
		const { chmod, mkdir, mkdtemp, realpath, rm, writeFile } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const { findPrograms, installedProgram } = await import("../../src/adapters/repos.ts");
		const dir = await realpath(await mkdtemp(join(tmpdir(), "mr-codex-programs-")));
		try {
			await mkdir(join(dir, "bin"));
			const codex = join(dir, "bin", "codex");
			await writeFile(codex, "#!/bin/sh\n");
			await chmod(codex, 0o755);
			expect(await findPrograms(join(dir, "bin"))).toEqual({ codex });
			expect(await installedProgram("codex", {}, join(dir, "bin"))).toBe(true);
		} finally { await rm(dir, { recursive: true, force: true }); }
	});
});
