// The real command line, as Claude Code runs it: `node main.ts hook claude <event>` with the hook JSON on stdin, in a
// temporary HOME and without Herdr variables. SessionStart must leave a detached bridge running after the hook exits;
// SessionEnd must stop it. If a test fails, the bridge still exits within seconds of this test process (its parent).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeRegistryEntry, sessionCapabilities } from "@workspace/protocol";

const main = resolve(import.meta.dirname, "../../src/main.ts");
const SESSION = "c1d2e3f4-3333-4a5b-8c7d-000000000003";
let home: string;

const env = () => {
	const clean: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) if (!key.startsWith("HERDR_") && !key.startsWith("PI_BRIDGE_") && key !== "CLAUDE_CONFIG_DIR") clean[key] = value;
	return { ...clean, HOME: home, USERPROFILE: home };
};
const hook = (event: string, payload: Record<string, unknown>) => spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", main, "hook", "claude", event], {
	input: JSON.stringify({ session_id: SESSION, hook_event_name: event, ...payload }), env: env(), encoding: "utf8", timeout: 20_000,
});
const registry = () => { try { return readdirSync(join(home, ".mars-ram/bridges")).filter((name) => name.endsWith(".json")); } catch { return []; } };
const wait = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 50)); return check(); };

beforeEach(() => { home = realpathSync(mkdtempSync(join(tmpdir(), "mr-claude-proc-"))); });
afterEach(async () => {
	hook("SessionEnd", { reason: "other" });
	await wait(() => registry().length === 0);
	rmSync(home, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("mars-ram hook claude (real processes, temporary HOME)", () => {
	it("SessionStart starts one detached bridge; later hooks reach it; SessionEnd stops it; all print nothing", async () => {
		const transcript = join(home, "t.jsonl");
		writeFileSync(transcript, `${JSON.stringify({ type: "user", uuid: "u1", message: { content: "hola zorro" } })}\n`);
		const start = hook("SessionStart", { transcript_path: transcript, cwd: home, source: "startup" });
		expect(start).toMatchObject({ status: 0, stdout: "" });
		expect(await wait(() => registry().length === 1)).toBe(true);
		const entry = decodeRegistryEntry(JSON.parse(readFileSync(join(home, ".mars-ram/bridges", registry()[0]!), "utf8")));
		if (!entry.ok) throw new Error(entry.errors.join("; "));
		expect(sessionCapabilities(entry.value)).toMatchObject({ agent: "claude-code", capabilities: { message: false, approvals: true } });
		expect(entry.value.pid).not.toBe(process.pid);
		expect(hook("SessionStart", { transcript_path: transcript, cwd: home, source: "resume" })).toMatchObject({ status: 0, stdout: "" });
		expect(registry()).toHaveLength(1);
		expect(hook("UserPromptSubmit", { prompt: "x" })).toMatchObject({ status: 0, stdout: "" });
		const state = await (await fetch(`http://127.0.0.1:${entry.value.port}/state`, { headers: { authorization: `Bearer ${entry.value.token}` } })).json();
		expect(state).toMatchObject({ idle: false, sessionId: SESSION });
		const history = await (await fetch(`http://127.0.0.1:${entry.value.port}/history`, { headers: { authorization: `Bearer ${entry.value.token}` } })).json();
		expect(history.messages).toMatchObject([{ role: "user", text: "hola zorro" }]);
		expect(hook("SessionEnd", { reason: "exit" })).toMatchObject({ status: 0, stdout: "" });
		expect(await wait(() => registry().length === 0)).toBe(true);
		expect(await wait(() => readdirSync(join(home, ".mars-ram/agents")).length === 0)).toBe(true);
	}, 30_000);

	it("without a bridge every hook exits 0 at once and prints nothing", () => {
		for (const event of ["UserPromptSubmit", "Stop", "Notification", "PermissionRequest", "SessionEnd", "Unknown"]) {
			expect(hook(event, {})).toMatchObject({ status: 0, stdout: "" });
		}
		expect(registry()).toEqual([]);
	});
});
