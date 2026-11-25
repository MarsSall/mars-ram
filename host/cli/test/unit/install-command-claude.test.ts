// The install command's Claude Code step, with every adapter faked: nothing reads or writes the real home.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	order: [] as string[],
	answers: [] as string[],
	asked: [] as string[],
	homes: ["/home/alex/.pi/agent"],
	pi: true,
	claude: { detected: true, fails: false } as { detected: boolean; fails: boolean } | undefined,
	installs: [] as unknown[][],
	record: undefined as unknown,
}));
vi.mock("../../src/adapters/installation.ts", () => ({
	createInstallAdapter: () => ({
		packageBin: "/pkg/bin/mars-ram.mjs", keptLauncher: () => undefined, writeHostConfig: async () => { state.order.push("host"); return true; },
		piAvailable: () => state.pi,
		...(state.claude ? { claude: {
			detected: async () => state.claude!.detected,
			settingsPath: () => "/home/alex/.claude/settings.json",
			install: async () => { state.order.push("claude install"); if (state.claude!.fails) throw new Error("settings.json is not valid JSON"); return { changed: true }; },
			uninstall: async () => { state.order.push("claude uninstall"); return { changed: true }; },
			status: async () => ({ detected: true, readable: true, registered: [], current: false }),
		} } : {}),
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
	Object.assign(state, { order: [], answers: [], asked: [], homes: ["/home/alex/.pi/agent"], pi: true, claude: { detected: true, fails: false }, installs: [], record: undefined });
});
afterEach(() => vi.restoreAllMocks());

describe("install with Claude Code", () => {
	it("asks after the Pi homes and installs the hooks after the host copy", async () => {
		expect(await installCommand("install")).toBe(0);
		expect(state.asked).toEqual([installText.exclude, installText.confirmInstall, expect.stringMatching(/^Claude Code found\. Add the mars-ram hooks to \/home\/alex\/\.claude\/settings\.json/)]);
		expect(state.installs).toEqual([[["/home/alex/.pi/agent"], true, { hostOnly: true }]]);
		expect(state.order).toEqual(["install", "host", "claude install"]);
		expect(out.at(-1)).toMatch(/Claude Code hooks installed/);
	});

	it("without Pi, installs only the host copy and the hooks; Pi is not required", async () => {
		state.pi = false;
		expect(await installCommand("install")).toBe(0);
		expect(state.asked).toHaveLength(1);
		expect(state.installs).toEqual([[[], true, { hostOnly: true }]]);
		expect(state.order).toEqual(["install", "host", "claude install"]);
	});

	it("without Pi and without Claude Code, fails as before with the missing-Pi message", async () => {
		state.pi = false;
		state.claude = { detected: false, fails: false };
		expect(await installCommand("install")).toBe(1);
		expect(out.join("\n")).toContain(installText.missingPi);
		expect(state.order).toEqual([]);
	});

	it("declining the hooks with no Pi home changes nothing", async () => {
		state.pi = false;
		state.answers = ["n"];
		expect(await installCommand("install")).toBe(0);
		expect(state.order).toEqual([]);
	});

	it("declining the hooks keeps the Pi install as before, without touching Claude Code", async () => {
		state.answers = ["", "y", "n"];
		expect(await installCommand("install")).toBe(0);
		expect(state.installs).toEqual([[["/home/alex/.pi/agent"], true, { hostOnly: false }]]);
		expect(state.order).not.toContain("claude install");
	});

	it("a Claude Code settings problem is reported and fails the command after the Pi part is done", async () => {
		state.claude = { detected: true, fails: true };
		expect(await installCommand("install")).toBe(1);
		expect(state.order).toEqual(["install", "host", "claude install"]);
		expect(out.at(-1)).toBe("Claude Code hooks were not changed: settings.json is not valid JSON");
	});

	it("never asks about Claude Code where it is not installed", async () => {
		state.claude = { detected: false, fails: false };
		expect(await installCommand("install")).toBe(0);
		expect(state.asked).toEqual([installText.exclude, installText.confirmInstall]);
	});

	it("uninstall removes the hooks before the copy they run", async () => {
		state.record = { copy: "/home/alex/.mars-ram/pi-bridge", homes: ["/home/alex/.pi/agent"], version: "1", date: "today" };
		expect(await installCommand("uninstall")).toBe(0);
		expect(state.order).toEqual(["claude uninstall", "uninstall"]);
		state.order = [];
		state.record = undefined;
		expect(await installCommand("uninstall")).toBe(0);
		expect(state.order).toEqual(["claude uninstall", "uninstall"]);
	});
});
