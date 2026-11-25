// Ownership and write safety of the hooks config editor, for Claude Code's settings.json and Codex's hooks.json.
// Every test uses a temporary home and an empty environment: the real ~/.claude, ~/.codex and ~/.mars-ram are never
// read or written.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClaudeHooksAdapter } from "../../src/adapters/claude-hooks.ts";
import { createCodexHooksAdapter } from "../../src/adapters/codex-hooks.ts";
import { CLAUDE_HOOK_EVENTS } from "../../src/core/claude-hooks.ts";
import { CODEX_HOOK_EVENTS } from "../../src/core/codex-hooks.ts";

let home: string;
beforeEach(() => { home = realpathSync(mkdtempSync(join(tmpdir(), "mr-hookfile-"))); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

const main = () => join(home, ".mars-ram/cli/src/main.ts");
const agents = [
	{
		name: "Claude Code",
		agent: "claude",
		events: CLAUDE_HOOK_EVENTS as readonly string[],
		config: () => join(home, ".claude/settings.json"),
		ownership: () => join(home, ".mars-ram/claude-hooks.json"),
		adapter: (node = "/usr/bin/node") => createClaudeHooksAdapter({ home, platform: "linux", env: {}, claudeOnPath: async () => true, command: () => ({ node, main: main() }) }),
	},
	{
		name: "Codex",
		agent: "codex",
		events: CODEX_HOOK_EVENTS as readonly string[],
		config: () => join(home, ".codex/hooks.json"),
		ownership: () => join(home, ".mars-ram/codex-hooks.json"),
		adapter: (node = "/usr/bin/node") => createCodexHooksAdapter({ home, platform: "linux", env: {}, codexOnPath: async () => true, command: () => ({ node, main: main() }) }),
	},
];

const snapshot = (path: string) => (existsSync(path) ? { bytes: readFileSync(path, "utf8"), mtime: statSync(path).mtimeMs, ino: statSync(path).ino } : undefined);

describe.skipIf(process.platform === "win32").each(agents)("$name hooks config: ownership", ({ agent, events, config, ownership, adapter }) => {
	/** Foreign commands that merely end with the mars-ram invocation: a user's wrapper around it, in both forms. */
	const wrappers = () => [
		{ type: "command", command: `/usr/local/bin/with-audit '/usr/bin/node' --disable-warning=ExperimentalWarning '${main()}' hook ${agent} Stop`, timeout: 9 },
		{ type: "command", command: `nice -n 5 "/usr/bin/node" "${main()}" hook ${agent} Stop` },
		{ type: "command", command: "/usr/local/bin/wrapper", args: [main(), "hook", agent, "Stop"] },
	];
	const seed = () => {
		mkdirSync(join(config(), ".."), { recursive: true });
		const value = { hooks: { Stop: [{ hooks: wrappers() }] } };
		writeFileSync(config(), JSON.stringify(value, null, 2));
		return value;
	};
	const stopCommands = () => (JSON.parse(readFileSync(config(), "utf8")).hooks?.Stop ?? []).flatMap((group: { hooks: { command: string }[] }) => group.hooks);

	it("install keeps a foreign wrapper that ends with the mars-ram invocation, and adds its own entry", async () => {
		seed();
		expect(await adapter().install()).toMatchObject({ changed: true });
		const stop = stopCommands();
		expect(stop.slice(0, 3)).toEqual(wrappers());
		expect(stop).toHaveLength(4);
		const recorded = JSON.parse(readFileSync(ownership(), "utf8")).handlers as unknown[];
		for (const wrapper of wrappers()) expect(recorded).not.toContainEqual(wrapper);
	});

	it("reinstall with another node path replaces only the recorded entry, never the wrapper", async () => {
		seed();
		await adapter().install();
		await adapter("/opt/node/bin/node").install();
		const stop = stopCommands();
		expect(stop.slice(0, 3)).toEqual(wrappers());
		expect(stop).toHaveLength(4);
		expect(stop[3].command ?? "").toContain("/opt/node/bin/node");
	});

	it("uninstall removes only recorded entries; the wrapper survives", async () => {
		const value = seed();
		await adapter().install();
		expect(await adapter().uninstall()).toMatchObject({ changed: true });
		expect(JSON.parse(readFileSync(config(), "utf8"))).toEqual(value);
		expect(existsSync(ownership())).toBe(false);
	});

	it("uninstall without an ownership record removes only entries that equal a generated command", async () => {
		const value = seed();
		await adapter().install();
		rmSync(ownership());
		expect(await adapter().uninstall()).toMatchObject({ changed: true });
		expect(JSON.parse(readFileSync(config(), "utf8"))).toEqual(value);
	});

	it("uninstall without an ownership record keeps a handler with our command but the user's own timeout or fields", async () => {
		await adapter().install();
		const installed = JSON.parse(readFileSync(config(), "utf8"));
		const ours = installed.hooks.Stop.at(-1).hooks[0];
		const customized = { ...ours, timeout: 42, statusMessage: "mine" };
		installed.hooks.Stop.at(-1).hooks = [customized];
		writeFileSync(config(), JSON.stringify(installed, null, 2));
		rmSync(ownership());
		await adapter().uninstall();
		expect(stopCommands()).toEqual([customized]);
	});

	it("doctor does not count a wrapper as a registered hook", async () => {
		seed();
		expect(await adapter().status()).toMatchObject({ registered: [], current: false });
		await adapter().install();
		expect(await adapter().status()).toMatchObject({ registered: [...events], current: true });
	});
});

describe.skipIf(process.platform === "win32").each(agents)("$name hooks config: validated before any write", ({ config, ownership, adapter }) => {
	const backup = () => `${config()}.mars-ram.bak`;

	it.each([
		["malformed JSON", "{ \"hooks\": ", /not valid JSON/],
		["a whitespace-only file", "  \n\t\n", /empty|whitespace/i],
		["a JSON list", "[1, 2]", /JSON object/],
		["a JSON string", "\"hooks\"", /JSON object/],
		["null", "null", /JSON object/],
		["an integer beyond the safe range", "{\"theme\": \"dark\", \"seed\": 12345678901234567890}", /would change/],
		["a large id inside a foreign hook", "{\"hooks\": {\"Stop\": [{\"hooks\": [{\"type\": \"command\", \"command\": \"x\", \"id\": 9007199254740993}]}]}}", /would change/],
		["a duplicate key", "{\"theme\": \"dark\", \"theme\": \"light\"}", /would change/],
	])("refuses %s and leaves the config, its backup and the ownership file unchanged", async (_name, contents, message) => {
		mkdirSync(join(config(), ".."), { recursive: true });
		writeFileSync(config(), contents);
		writeFileSync(backup(), "previous backup");
		mkdirSync(join(home, ".mars-ram"), { recursive: true });
		const record = JSON.stringify({ version: 1, settings: config(), state: "installed", handlers: [] });
		writeFileSync(ownership(), record);
		await expect(adapter().install()).rejects.toThrow(message);
		await expect(adapter().install()).rejects.toThrow(/nothing changed/i);
		expect(readFileSync(config(), "utf8")).toBe(contents);
		expect(readFileSync(backup(), "utf8")).toBe("previous backup");
		expect(readFileSync(ownership(), "utf8")).toBe(record);
	});

	it("refuses a config that is not valid UTF-8 and leaves its bytes and the backup unchanged", async () => {
		mkdirSync(join(config(), ".."), { recursive: true });
		const bytes = Buffer.concat([Buffer.from("{\"theme\": \"da"), Buffer.from([0xff]), Buffer.from("rk\"}")]);
		writeFileSync(config(), bytes);
		writeFileSync(backup(), "previous backup");
		await expect(adapter().install()).rejects.toThrow(/UTF-8/);
		await expect(adapter().uninstall()).rejects.toThrow(/nothing changed/i);
		expect(readFileSync(config()).equals(bytes)).toBe(true);
		expect(readFileSync(backup(), "utf8")).toBe("previous backup");
		expect(existsSync(ownership())).toBe(false);
	});

	it("refuses without creating an ownership file when there was none (no pending record)", async () => {
		mkdirSync(join(config(), ".."), { recursive: true });
		writeFileSync(config(), "{ broken");
		await expect(adapter().install()).rejects.toThrow(/not valid JSON/);
		expect(existsSync(ownership())).toBe(false);
		expect(existsSync(join(home, ".mars-ram"))).toBe(false);
		expect(existsSync(backup())).toBe(false);
	});

	it("keeps numbers JSON represents exactly, such as safe integers and decimals", async () => {
		mkdirSync(join(config(), ".."), { recursive: true });
		writeFileSync(config(), "{\"limit\": 9007199254740991, \"ratio\": 0.5, \"neg\": -3}");
		expect(await adapter().install()).toMatchObject({ changed: true });
		expect(JSON.parse(readFileSync(config(), "utf8"))).toMatchObject({ limit: 9007199254740991, ratio: 0.5, neg: -3 });
	});

	it("a no-op reinstall rewrites neither the config nor the ownership file", async () => {
		await adapter().install();
		const before = { config: snapshot(config()), ownership: snapshot(ownership()), backup: snapshot(backup()) };
		await new Promise((done) => setTimeout(done, 20));
		expect(await adapter().install()).toEqual({ changed: false });
		expect({ config: snapshot(config()), ownership: snapshot(ownership()), backup: snapshot(backup()) }).toEqual(before);
	});

	it("a reinstall whose config is already right but whose record is missing writes only the record", async () => {
		await adapter().install();
		const configBefore = snapshot(config());
		const record = readFileSync(ownership(), "utf8");
		rmSync(ownership());
		expect(await adapter().install()).toEqual({ changed: false });
		expect(snapshot(config())).toEqual(configBefore);
		expect(readFileSync(ownership(), "utf8")).toBe(record);
	});
});
