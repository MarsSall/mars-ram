import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ record: undefined as unknown, legacy: vi.fn(), temp: vi.fn() }));
vi.mock("../../src/adapters/installation.ts", () => ({
	createInstallAdapter: () => ({ packageBin: "/pkg/bin/mars-ram.mjs", keptLauncher: () => undefined, writeHostConfig: async () => true }),
}));
vi.mock("../../src/adapters/repos.ts", () => ({ findPrograms: async () => ({}) }));
vi.mock("../../src/core/installation.ts", () => ({
	selectHomes: (homes: string[]) => homes,
	Installation: class {
		async homes() { return ["/home/alex/.pi/agent"]; }
		async install() { return []; }
		async record() { return state.record; }
		async uninstall() { return []; }
	},
}));
vi.mock("../../src/adapters/uploads-cleanup.ts", () => ({ removeLegacyUploads: state.legacy, removeUploadsFolder: state.temp }));
vi.mock("../../src/adapters/terminal.ts", async (importOriginal) => ({
	...await importOriginal<typeof import("../../src/adapters/terminal.ts")>(),
	spanish: false,
	createPrompter: () => ({ ask: async () => "y", close: () => {} }),
	isYes: () => true,
}));

const { installCommand } = await import("../../src/install-command.ts");
const { installText } = await import("../../src/adapters/terminal.ts");

let lines: string[];
beforeEach(() => {
	lines = [];
	vi.spyOn(console, "log").mockImplementation((line: string) => { lines.push(line); });
	state.legacy.mockReset();
	state.temp.mockReset();
	state.record = undefined;
});
afterEach(() => vi.restoreAllMocks());

describe("install command attachment cleanup", () => {
	it("install removes the legacy folder and says so before the usual summary", async () => {
		state.legacy.mockReturnValue("Removed old attachments folder ~/.mars-ram/uploads (attachments now live in /tmp/mars-ram-1000/uploads).");
		expect(await installCommand("install")).toBe(0);
		expect(state.temp).not.toHaveBeenCalled();
		const removed = lines.indexOf("Removed old attachments folder ~/.mars-ram/uploads (attachments now live in /tmp/mars-ram-1000/uploads).");
		expect(removed).toBeGreaterThan(-1);
		expect(lines.findIndex(line => line.startsWith(installText.installed))).toBeGreaterThan(removed);
	});

	it("install prints nothing extra without a legacy folder, and a failed cleanup does not fail install", async () => {
		expect(await installCommand("install")).toBe(0);
		const quiet = [...lines];
		state.legacy.mockImplementation(() => { throw new Error("EACCES"); });
		lines.length = 0;
		expect(await installCommand("install")).toBe(0);
		expect(lines).toEqual([...quiet.slice(0, -1), "Could not clean up the attachments folder: EACCES", quiet.at(-1)]);
	});

	it("uninstall removes both attachment folders after the usual message", async () => {
		state.record = { copy: "/home/alex/.mars-ram/pi-bridge", homes: ["/home/alex/.pi/agent"], version: "1", date: "today" };
		state.temp.mockResolvedValue("Removed attachments folder /tmp/mars-ram-1000/uploads.");
		expect(await installCommand("uninstall")).toBe(0);
		expect(lines.slice(lines.indexOf(installText.removed))).toEqual([installText.removed, "Removed attachments folder /tmp/mars-ram-1000/uploads.", expect.stringMatching(/npm package/)]);
		expect(state.legacy).toHaveBeenCalled();
	});

	it("uninstall without an installation record still removes them", async () => {
		state.temp.mockResolvedValue("Removed attachments folder /tmp/mars-ram-1000/uploads.");
		expect(await installCommand("uninstall")).toBe(0);
		expect(lines).toContain(installText.noInstallation);
		expect(lines).toContain("Removed attachments folder /tmp/mars-ram-1000/uploads.");
	});
});
