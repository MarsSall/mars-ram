// The install command's Codex step, with every adapter faked: nothing reads or writes the real home.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	order: [] as string[],
	answers: [] as string[],
	asked: [] as string[],
	homes: ["/home/alex/.pi/agent"],
	pi: true,
	claude: false,
	codex: { detected: true, fails: false, changed: true },
	installs: [] as unknown[][],
	record: undefined as unknown,
}));
const hookStep = (name: string, path: string, agent: () => { detected: boolean; fails: boolean; changed: boolean } | false) => ({
	detected: async () => { const a = agent(); return !!a && a.detected; },
	settingsPath: () => path,
	install: async () => { state.order.push(`${name} install`); const a = agent(); if (a && a.fails) throw new Error("hooks.json is not valid JSON"); return { changed: !!a && a.changed }; },
	uninstall: async () => { state.order.push(`${name} uninstall`); return { changed: true }; },
	status: async () => ({}),
});
vi.mock("../../src/adapters/installation.ts", () => ({
	createInstallAdapter: () => ({
		packageBin: "/pkg/bin/mars-ram.mjs", keptLauncher: () => undefined, writeHostConfig: async () => { state.order.push("host"); return true; },
		piAvailable: () => state.pi,
		claude: hookStep("claude", "/home/alex/.claude/settings.json", () => state.claude && { detected: true, fails: false, changed: true }),
		codex: hookStep("codex", "/home/alex/.codex/hooks.json", () => state.codex),
	}),
}));
vi.mock("../../src/adapters/repos.ts", () => ({ findPrograms: async () => ({}) }));
vi.mock("../../src/core/installation.ts", () => ({
	selectHomes: (homes: string[]) => homes,
	Installation: class {
		async homes() { return state.homes; }
		async install(...args: unknown[]) { state.order.push("install"); state.installs.push(args); return []; }
		async record() { return state.record; }
		async uninstall() { state.order.push("uninstall"); return []; }
	},
}));
vi.mock("../../src/adapters/uploads-cleanup.ts", () => ({ removeLegacyUploads: () => undefined, removeUploadsFolder: () => undefined }));
vi.mock("../../src/adapters/terminal.ts", async (importOriginal) => ({
	...await importOriginal<typeof import("../../src/adapters/terminal.ts")>(),
	spanish: false,
	createPrompter: () => ({ ask: async (question: string) => { state.asked.push(question); return state.answers.shift() ?? "y"; }, close: () => {} }),
	isYes: (answer: string | null) => answer === "y",
}));

const { installCommand } = await import("../../src/install-command.ts");
const { installText } = await import("../../src/adapters/terminal.ts");

let out: string[];
beforeEach(() => {
	out = [];
	vi.spyOn(console, "log").mockImplementation((line: string) => { out.push(line); });
	vi.spyOn(console, "error").mockImplementation((line: string) => { out.push(line); });
	Object.assign(state, { order: [], answers: [], asked: [], homes: ["/home/alex/.pi/agent"], pi: true, claude: false, codex: { detected: true, fails: false, changed: true }, installs: [], record: undefined });
});
afterEach(() => vi.restoreAllMocks());

describe("install with Codex", () => {
	it("asks after the Pi homes, installs the hooks after the host copy, and says to trust them in Codex with /hooks", async () => {
		expect(await installCommand("install")).toBe(0);
		expect(state.asked).toEqual([installText.exclude, installText.confirmInstall, expect.stringMatching(/^Codex found\. Add the mars-ram hooks to \/home\/alex\/\.codex\/hooks\.json/)]);
		expect(state.installs).toEqual([[["/home/alex/.pi/agent"], true, { hostOnly: true }]]);
		expect(state.order).toEqual(["install", "host", "codex install"]);
		expect(out.at(-2)).toMatch(/^Codex hooks installed in \/home\/alex\/\.codex\/hooks\.json/);
		expect(out.at(-1)).toMatch(/open Codex, type \/hooks, review the mars-ram hooks and trust them/);
	});

	it("repeats the trust reminder when the hooks were already up to date", async () => {
		state.codex = { detected: true, fails: false, changed: false };
		expect(await installCommand("install")).toBe(0);
		expect(out.at(-2)).toMatch(/Codex hooks already up to date/);
		expect(out.at(-1)).toMatch(/\/hooks/);
	});

	it("asks for Claude Code first, then Codex, and installs both", async () => {
		state.claude = true;
		expect(await installCommand("install")).toBe(0);
		expect(state.asked.slice(2).map((q) => q.split(".")[0])).toEqual(["Claude Code found", "Codex found"]);
		expect(state.order).toEqual(["install", "host", "claude install", "codex install"]);
	});

	it("without Pi, installs only the host copy and the Codex hooks", async () => {
		state.pi = false;
		expect(await installCommand("install")).toBe(0);
		expect(state.asked).toHaveLength(1);
		expect(state.installs).toEqual([[[], true, { hostOnly: true }]]);
	});

	it("never asks about Codex where it is not installed, and a declined Codex is not touched", async () => {
		state.codex = { detected: false, fails: false, changed: true };
		expect(await installCommand("install")).toBe(0);
		expect(state.asked).toEqual([installText.exclude, installText.confirmInstall]);
		Object.assign(state, { asked: [], order: [], installs: [], codex: { detected: true, fails: false, changed: true }, answers: ["", "y", "n"] });
		expect(await installCommand("install")).toBe(0);
		expect(state.installs).toEqual([[["/home/alex/.pi/agent"], true, { hostOnly: false }]]);
		expect(state.order).not.toContain("codex install");
	});

	it("a hooks.json problem is reported and fails the command after the rest is done", async () => {
		state.codex = { detected: true, fails: true, changed: true };
		expect(await installCommand("install")).toBe(1);
		expect(state.order).toEqual(["install", "host", "codex install"]);
		expect(out.at(-1)).toBe("Codex hooks were not changed: hooks.json is not valid JSON");
	});

	it("uninstall removes both agents' hooks before the copy they run", async () => {
		state.record = { copy: "/home/alex/.mars-ram/pi-bridge", homes: ["/home/alex/.pi/agent"], version: "1", date: "today" };
		expect(await installCommand("uninstall")).toBe(0);
		expect(state.order).toEqual(["claude uninstall", "codex uninstall", "uninstall"]);
		state.order = [];
		state.record = undefined;
		expect(await installCommand("uninstall")).toBe(0);
		expect(state.order).toEqual(["claude uninstall", "codex uninstall", "uninstall"]);
	});
});
