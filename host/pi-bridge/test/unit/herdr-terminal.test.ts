import { describe, expect, it } from "vitest";
import { createHerdrTerminal, type TerminalExecFile } from "../../src/adapters/herdr-terminal.ts";

function fixture(env: NodeJS.ProcessEnv = { HERDR_PANE_ID: "pane-123" }) {
	const calls: { file: string; args: readonly string[]; options: unknown }[] = [];
	let failAt = 0;
	const exec: TerminalExecFile = (file, args, options, callback) => {
		calls.push({ file, args, options });
		callback(calls.length === failAt ? new Error("secret stderr") : null, "\u001b[32mvisible", "private stderr");
	};
	return { calls, port: createHerdrTerminal(env, exec), fail: (at: number) => { failAt = at; } };
}

describe("Herdr terminal focus", () => {
	function focusFixture(stdout = '{"result":{"pane":{"tab_id":"w2G:t2"}}}', failAt = 0, pane = "w2G:p2") {
		const calls: { args: readonly string[]; options: unknown }[] = [];
		const run: TerminalExecFile = (_file, args, options, callback) => {
			calls.push({ args, options });
			callback(calls.length === failAt ? new Error("private failure") : null, stdout, "private stderr");
		};
		return { calls, port: createHerdrTerminal({ HERDR_PANE_ID: pane }, run) };
	}
	it("gets its own tab, then focuses its workspace and tab with bounded shell-free calls", async () => {
		const f = focusFixture();
		expect(await f.port!.focus()).toEqual({ ok: true, value: undefined });
		expect(f.calls.map(c => c.args)).toEqual([["pane", "get", "w2G:p2"], ["workspace", "focus", "w2G"], ["tab", "focus", "w2G:t2"]]);
		for (const call of f.calls) expect(call.options).toMatchObject({ shell: false, timeout: 3000, maxBuffer: 1024 * 1024 });
	});
	it.each(["not JSON", "null", "{}", '{"result":{"pane":{"tab_id":"-bad"}}}', '{"result":{"pane":{"tab_id":"w2G:t2;cmd"}}}', '{"result":{"pane":{"tab_id":"other:t2"}}}', '{"result":{"pane":{"tab_id":"w2G:p2"}}}', '{"result":{"pane":{"tab_id":"w2G:t2\\n"}}}']) ("refuses malformed or unsafe tab metadata %s before changing focus", async stdout => {
		const f = focusFixture(stdout);
		expect(await f.port!.focus()).toMatchObject({ ok: false });
		expect(f.calls).toHaveLength(1);
	});
	it.each([1, 2, 3])("stops and hides subprocess failure at step %s", async failAt => {
		const f = focusFixture(undefined, failAt);
		expect(await f.port!.focus()).toEqual({ ok: false, message: "Herdr did not complete the terminal operation." });
		expect(f.calls).toHaveLength(failAt);
	});
	it("cannot derive a workspace from a legacy pane id", async () => {
		const f = focusFixture(undefined, 0, "pane-123");
		expect(await f.port!.focus()).toMatchObject({ ok: false });
		expect(f.calls).toEqual([]);
	});
});

describe("Herdr terminal adapter", () => {
	it.each([undefined, "", "-other", "../pane", "pane;cmd", "pane with spaces", ":p2", "w2G:p2:x", "a\nb", "pane\n", "x".repeat(129)])("does not create a port for invalid pane %j", (pane) => {
		const env = pane === undefined ? {} : { HERDR_PANE_ID: pane };
		const f = fixture(env);
		expect(f.port).toBeUndefined();
		expect(f.calls).toEqual([]);
	});
	it.each(["w2G:p2", "w12:p104", "pane-123"])("creates a port for a real Herdr pane id %j", (pane) => {
		const env = { HERDR_PANE_ID: pane };
		const f = fixture(env);
		env.HERDR_PANE_ID = "wOther:p9";
		expect(f.port?.paneId).toBe(pane);
		expect(f.calls).toEqual([]);
	});
	it("reads only its own visible pane with ANSI and bounded shell-free execution", async () => {
		const env = { HERDR_PANE_ID: "own-pane", HERDR_BIN_PATH: "C:\\Program Files\\Herdr\\herdr.exe", HERDR_SOCKET_PATH: "socket" };
		const f = fixture(env);
		expect(await f.port?.screen()).toEqual({ ok: true, value: "\u001b[32mvisible" });
		expect(f.calls).toEqual([{ file: env.HERDR_BIN_PATH, args: ["pane", "read", "own-pane", "--source", "visible", "--format", "ansi"], options: { env, shell: false, encoding: "utf8", timeout: 3000, maxBuffer: 1024 * 1024 } }]);
	});
	it("types text without Enter as one literal argument", async () => {
		const f = fixture();
		const text = "--help; $(touch nope) & | `cmd` \"quoted\"\nsecond line";
		expect(await f.port?.text(text, false)).toEqual({ ok: true, value: undefined });
		expect(f.calls.map(({ file, args }) => ({ file, args }))).toEqual([{ file: "herdr", args: ["pane", "send-text", "pane-123", text] }]);
	});
	it("types text with Enter in one `pane run`, which honors the pane's bracketed paste so several lines arrive as one paste", async () => {
		const f = fixture();
		const text = "line 1\n--line 2 $(nope)";
		expect(await f.port?.text(text, true)).toEqual({ ok: true, value: undefined });
		expect(f.calls.map(({ file, args }) => ({ file, args }))).toEqual([{ file: "herdr", args: ["pane", "run", "pane-123", text] }]);
	});
	it.each(["--help", "-h", "--", "--timeout 1"])("hands text that starts with a dash to `pane run` after the pane id, as the text: %j", async (text) => {
		const f = fixture();
		await f.port?.text(text, true);
		expect(f.calls[0]?.args).toEqual(["pane", "run", "pane-123", text]);
	});
	it("passes validated keys through unchanged", async () => {
		const f = fixture();
		await f.port?.keys(["esc", "enter", "ctrl+c", "up"]);
		expect(f.calls[0]?.args).toEqual(["pane", "send-keys", "pane-123", "esc", "enter", "ctrl+c", "up"]);
	});
	it("reports a failed text input and hides subprocess errors", async () => {
		const f = fixture();
		f.fail(1);
		expect(await f.port?.text("hello", true)).toEqual({ ok: false, message: "Herdr did not complete the terminal operation." });
		expect(f.calls).toHaveLength(1);
	});
});
