// Every test uses a temporary home and an empty environment: the real ~/.claude/settings.json is never read or written.
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeConfigDir, createClaudeHooksAdapter } from "../../src/adapters/claude-hooks.ts";
import { CLAUDE_HOOK_EVENTS, hookHandler } from "../../src/core/claude-hooks.ts";

let home: string;
const command = () => ({ node: "/usr/bin/node", main: join(home, ".mars-ram/cli/src/main.ts") });
const adapter = (options: { onPath?: boolean; env?: NodeJS.ProcessEnv; node?: string } = {}) => createClaudeHooksAdapter({
	home, platform: "linux", env: options.env ?? {}, claudeOnPath: async () => options.onPath ?? false,
	command: () => ({ ...command(), ...(options.node ? { node: options.node } : {}) }),
});
const settingsPath = () => join(home, ".claude/settings.json");
const read = () => JSON.parse(readFileSync(settingsPath(), "utf8"));
const foreign = { model: "sonnet", hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] }, env: { FOO: "1" } };

beforeEach(() => { home = realpathSync(mkdtempSync(join(tmpdir(), "mr-claude-"))); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe.skipIf(process.platform === "win32")("Claude Code settings.json (temporary home)", () => {
	it("detects Claude Code by its folder or by claude on PATH, never otherwise", async () => {
		expect(await adapter().detected()).toBe(false);
		expect(await adapter({ onPath: true }).detected()).toBe(true);
		mkdirSync(join(home, ".claude"));
		expect(await adapter().detected()).toBe(true);
	});

	it("installs into an existing file with a backup, keeping foreign settings, mode and order; re-install changes nothing", async () => {
		mkdirSync(join(home, ".claude"));
		const original = `${JSON.stringify(foreign, null, 4)}\n`;
		writeFileSync(settingsPath(), original, { mode: 0o644 });
		chmodSync(settingsPath(), 0o644);
		const first = await adapter().install();
		expect(first).toEqual({ changed: true, backup: `${settingsPath()}.mars-ram.bak` });
		expect(readFileSync(first.backup!, "utf8")).toBe(original);
		expect(statSync(settingsPath()).mode & 0o777).toBe(0o644);
		const written = read();
		expect(Object.keys(written)).toEqual(["model", "hooks", "env"]);
		expect(written.hooks.Stop).toEqual([foreign.hooks.Stop[0], { hooks: [hookHandler({ ...command(), platform: "linux" }, "Stop")] }]);
		expect(Object.keys(written.hooks)).toEqual(["Stop", ...CLAUDE_HOOK_EVENTS.filter((e) => e !== "Stop")]);
		expect(await adapter().status()).toEqual({ detected: true, readable: true, registered: [...CLAUDE_HOOK_EVENTS], current: true });
		const bytes = readFileSync(settingsPath(), "utf8");
		expect(await adapter().install()).toEqual({ changed: false });
		expect(readFileSync(settingsPath(), "utf8")).toBe(bytes);
		const ownership = JSON.parse(readFileSync(join(home, ".mars-ram/claude-hooks.json"), "utf8"));
		expect(ownership).toMatchObject({ version: 1, state: "installed", settings: settingsPath() });
		expect(ownership.handlers).toHaveLength(CLAUDE_HOOK_EVENTS.length);
		expect(statSync(join(home, ".mars-ram/claude-hooks.json")).mode & 0o777).toBe(0o600);
	});

	it("uninstall removes only the owned hooks and the ownership record", async () => {
		mkdirSync(join(home, ".claude"));
		writeFileSync(settingsPath(), JSON.stringify(foreign));
		await adapter().install();
		expect(await adapter().uninstall()).toMatchObject({ changed: true });
		expect(read()).toEqual(foreign);
		expect(existsSync(join(home, ".mars-ram/claude-hooks.json"))).toBe(false);
		expect(await adapter().uninstall()).toEqual({ changed: false });
		expect(await adapter().status()).toMatchObject({ registered: [], current: false });
	});

	it("creates a private settings.json when there was none, and finds hooks of an older node path", async () => {
		await adapter().install();
		expect(statSync(settingsPath()).mode & 0o777).toBe(0o600);
		await adapter({ node: "/new/node" }).install();
		const stop = read().hooks.Stop;
		expect(stop).toHaveLength(1);
		expect(stop[0].hooks[0].command).toContain("'/new/node'");
		expect(await adapter().status()).toMatchObject({ current: false });
	});

	it("finishes an interrupted install: a pending record still lets uninstall find the handlers", async () => {
		mkdirSync(join(home, ".mars-ram"), { recursive: true });
		mkdirSync(join(home, ".claude"));
		const stale = { type: "command", command: "/gone/node /gone/elsewhere.ts hook claude Stop", timeout: 5 };
		writeFileSync(settingsPath(), JSON.stringify({ hooks: { Stop: [{ hooks: [stale] }, ...foreign.hooks.Stop] } }));
		writeFileSync(join(home, ".mars-ram/claude-hooks.json"), JSON.stringify({ version: 1, settings: settingsPath(), state: "pending", handlers: [stale] }));
		await adapter().uninstall();
		expect(read()).toEqual({ hooks: foreign.hooks });
	});

	it("edits a linked settings.json at its target and keeps the link", async () => {
		const dotfiles = join(home, "dotfiles");
		mkdirSync(dotfiles);
		mkdirSync(join(home, ".claude"));
		writeFileSync(join(dotfiles, "claude.json"), JSON.stringify(foreign));
		symlinkSync(join(dotfiles, "claude.json"), settingsPath());
		await adapter().install();
		expect(lstatSync(settingsPath()).isSymbolicLink()).toBe(true);
		expect(JSON.parse(readFileSync(join(dotfiles, "claude.json"), "utf8")).hooks.SessionStart).toHaveLength(1);
	});

	it.each([
		["invalid JSON", "{ \"model\": ", false],
		["a JSON list", "[]", false],
		["unreadable hooks", JSON.stringify({ hooks: { Stop: { hooks: [] } } }), true],
	])("refuses %s and changes nothing", async (_name, contents, readable) => {
		mkdirSync(join(home, ".claude"));
		writeFileSync(settingsPath(), contents);
		await expect(adapter().install()).rejects.toThrow();
		expect(readFileSync(settingsPath(), "utf8")).toBe(contents);
		expect(existsSync(`${settingsPath()}.mars-ram.bak`)).toBe(false);
		expect(await adapter().status()).toMatchObject({ readable, registered: [] });
	});

	it("follows CLAUDE_CONFIG_DIR when it is absolute", async () => {
		const custom = join(home, "custom-claude");
		mkdirSync(custom);
		const env = { CLAUDE_CONFIG_DIR: custom };
		expect(claudeConfigDir(home, env, "linux")).toBe(custom);
		expect(claudeConfigDir(home, { CLAUDE_CONFIG_DIR: "relative" }, "linux")).toBe(join(home, ".claude"));
		expect(claudeConfigDir("C:\\Users\\a", {}, "win32")).toBe("C:\\Users\\a\\.claude");
		await adapter({ env }).install();
		expect(existsSync(join(custom, "settings.json"))).toBe(true);
		expect(existsSync(settingsPath())).toBe(false);
	});
});
