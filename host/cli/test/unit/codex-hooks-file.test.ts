// Every test uses a temporary home and an empty environment: the real ~/.codex is never read or written.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codexHome, createCodexHooksAdapter } from "../../src/adapters/codex-hooks.ts";
import { CODEX_HOOK_EVENTS, type CodexHookEvent, codexHookHandler, codexHookHash } from "../../src/core/codex-hooks.ts";

let home: string;
const command = () => ({ node: "/usr/bin/node", main: join(home, ".mars-ram/cli/src/main.ts") });
const adapter = (options: { onPath?: boolean; env?: NodeJS.ProcessEnv; node?: string } = {}) => createCodexHooksAdapter({
	home, platform: "linux", env: options.env ?? {}, codexOnPath: async () => options.onPath ?? false,
	command: () => ({ ...command(), ...(options.node ? { node: options.node } : {}) }),
});
const hooksPath = () => join(home, ".codex/hooks.json");
const read = () => JSON.parse(readFileSync(hooksPath(), "utf8"));
const foreign = { description: "Team hooks", hooks: { Stop: [{ hooks: [{ type: "command", command: "say done", timeout: 5 }] }], PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "audit.sh" }] }] } };

beforeEach(() => { home = realpathSync(mkdtempSync(join(tmpdir(), "mr-codex-"))); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe.skipIf(process.platform === "win32")("Codex hooks.json (temporary home)", () => {
	it("detects Codex by its home folder or by codex on PATH, never otherwise", async () => {
		expect(await adapter().detected()).toBe(false);
		expect(await adapter({ onPath: true }).detected()).toBe(true);
		mkdirSync(join(home, ".codex"));
		expect(await adapter().detected()).toBe(true);
	});

	it("installs with a backup, keeping description, foreign hooks, mode and order; re-install changes nothing", async () => {
		mkdirSync(join(home, ".codex"));
		const original = `${JSON.stringify(foreign, null, 4)}\n`;
		writeFileSync(hooksPath(), original);
		chmodSync(hooksPath(), 0o644);
		const first = await adapter().install();
		expect(first).toEqual({ changed: true, backup: `${hooksPath()}.mars-ram.bak` });
		expect(readFileSync(first.backup!, "utf8")).toBe(original);
		expect(statSync(hooksPath()).mode & 0o777).toBe(0o644);
		const written = read();
		expect(Object.keys(written)).toEqual(["description", "hooks"]);
		expect(written.description).toBe("Team hooks");
		expect(written.hooks.Stop).toEqual([foreign.hooks.Stop[0], { hooks: [codexHookHandler({ ...command(), platform: "linux" }, "Stop")] }]);
		expect(written.hooks.PreToolUse).toEqual(foreign.hooks.PreToolUse);
		expect(Object.keys(written.hooks)).toEqual(["Stop", "PreToolUse", ...CODEX_HOOK_EVENTS.filter((e) => e !== "Stop")]);
		const bytes = readFileSync(hooksPath(), "utf8");
		expect(await adapter().install()).toEqual({ changed: false });
		expect(readFileSync(hooksPath(), "utf8")).toBe(bytes);
		const ownership = JSON.parse(readFileSync(join(home, ".mars-ram/codex-hooks.json"), "utf8"));
		expect(ownership).toMatchObject({ version: 1, state: "installed", settings: hooksPath() });
		expect(ownership.handlers).toHaveLength(CODEX_HOOK_EVENTS.length);
		expect(statSync(join(home, ".mars-ram/codex-hooks.json")).mode & 0o777).toBe(0o600);
	});

	it("uninstall removes only the owned hooks and the ownership record", async () => {
		mkdirSync(join(home, ".codex"));
		writeFileSync(hooksPath(), JSON.stringify(foreign));
		await adapter().install();
		expect(await adapter().uninstall()).toMatchObject({ changed: true });
		expect(read()).toEqual(foreign);
		expect(existsSync(join(home, ".mars-ram/codex-hooks.json"))).toBe(false);
		expect(await adapter().uninstall()).toEqual({ changed: false });
	});

	it("creates a private hooks.json when there was none, and replaces hooks of an older node path in place", async () => {
		await adapter().install();
		expect(statSync(hooksPath()).mode & 0o777).toBe(0o600);
		expect(read()).toEqual({ hooks: expect.any(Object) });
		await adapter({ node: "/new/node" }).install();
		expect(read().hooks.Stop).toHaveLength(1);
		expect(read().hooks.Stop[0].hooks[0].command).toContain("'/new/node'");
	});

	it.each([
		["invalid JSON", "{ \"hooks\": "],
		["a JSON list", "[]"],
		["unreadable hooks", JSON.stringify({ hooks: { Stop: { hooks: [] } } })],
	])("refuses %s and changes nothing", async (_name, contents) => {
		mkdirSync(join(home, ".codex"));
		writeFileSync(hooksPath(), contents);
		await expect(adapter().install()).rejects.toThrow();
		expect(readFileSync(hooksPath(), "utf8")).toBe(contents);
		expect(existsSync(`${hooksPath()}.mars-ram.bak`)).toBe(false);
	});

	it("doctor status: registration, then trust read from config.toml", async () => {
		expect(await adapter().status()).toEqual({ detected: false, readable: true, registered: [], current: false, trust: { known: false } });
		await adapter().install();
		const untrusted = await adapter().status();
		expect(untrusted).toMatchObject({ detected: true, readable: true, registered: [...CODEX_HOOK_EVENTS], current: true, trust: { known: true } });
		expect(untrusted.trust.known && Object.values(untrusted.trust.events)).toEqual(Array(6).fill("untrusted"));
		const keys = { SessionStart: "session_start", UserPromptSubmit: "user_prompt_submit", PermissionRequest: "permission_request", Stop: "stop", Interrupt: "interrupt", SessionEnd: "session_end" };
		const config = read();
		const recorded = (stale: boolean) => Object.entries(keys).map(([event, key]) => {
			const hash = codexHookHash(event as CodexHookEvent, config.hooks[event][0].matcher, config.hooks[event][0].hooks[0], "linux");
			return `[hooks.state."${hooksPath()}:${key}:0:0"]\ntrusted_hash = "${stale ? "sha256:x" : hash}"\n`;
		}).join("");
		writeFileSync(join(home, ".codex/config.toml"), recorded(false));
		const trusted = await adapter().status();
		expect(trusted.trust.known && Object.values(trusted.trust.events)).toEqual(Array(6).fill("trusted"));
		writeFileSync(join(home, ".codex/config.toml"), recorded(true));
		const stale = await adapter().status();
		expect(stale.trust.known && Object.values(stale.trust.events)).toEqual(Array(6).fill("stale"));
		writeFileSync(hooksPath(), "{");
		expect(await adapter().status()).toMatchObject({ readable: false, trust: { known: false } });
	});

	it("refuses to install from a Node path Codex's shell would read differently, and doctor still reports", async () => {
		await adapter().install();
		const odd = adapter({ node: "/opt/o'neil/node" });
		await expect(odd.install()).rejects.toThrow(/quotes, backslashes/);
		expect(await odd.status()).toMatchObject({ readable: true, registered: [...CODEX_HOOK_EVENTS], current: false });
	});

	it("follows CODEX_HOME when it is absolute", async () => {
		const custom = join(home, "custom-codex");
		mkdirSync(custom);
		expect(codexHome(home, { CODEX_HOME: custom }, "linux")).toBe(custom);
		expect(codexHome(home, { CODEX_HOME: "relative" }, "linux")).toBe(join(home, ".codex"));
		expect(codexHome("C:\\Users\\a", {}, "win32")).toBe("C:\\Users\\a\\.codex");
		await adapter({ env: { CODEX_HOME: custom } }).install();
		expect(existsSync(join(custom, "hooks.json"))).toBe(true);
		expect(existsSync(hooksPath())).toBe(false);
	});

	it("writes Codex's Windows form: commandWindows with double-quoted node.exe and main.ts", async () => {
		// An absolute CODEX_HOME keeps the file inside the temporary home: Windows path joining would make it relative here.
		const win = createCodexHooksAdapter({
			home, platform: "win32", env: { CODEX_HOME: join(home, ".codex") }, codexOnPath: async () => true,
			command: () => ({ node: "C:\\Program Files\\nodejs\\node.exe", main: "C:\\Users\\Ana\\.mars-ram\\cli\\src\\main.ts" }),
		});
		expect(win.settingsPath()).toBe(hooksPath());
		await win.install();
		const [group] = JSON.parse(readFileSync(win.settingsPath(), "utf8")).hooks.Interrupt;
		const line = "\"C:\\Program Files\\nodejs\\node.exe\" --disable-warning=ExperimentalWarning \"C:\\Users\\Ana\\.mars-ram\\cli\\src\\main.ts\" hook codex Interrupt";
		expect(group).toEqual({ hooks: [{ type: "command", command: line, commandWindows: line, timeout: 3 }] });
		expect(await win.status()).toMatchObject({ current: true });
	});
});
