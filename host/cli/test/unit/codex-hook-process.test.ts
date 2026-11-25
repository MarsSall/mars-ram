// The real command line, as Codex runs it on Linux: `$SHELL -lc "'node' … main.ts hook codex <event>"` with the hook
// JSON on stdin, in a temporary HOME and without Herdr variables. SessionStart must leave a detached bridge running
// after the hook exits; SessionEnd must stop it within Codex's limit.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeRegistryEntry, sessionCapabilities } from "@workspace/protocol";
import { codexHookHandler } from "../../src/core/codex-hooks.ts";

const main = resolve(import.meta.dirname, "../../src/main.ts");
const SESSION = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
let home: string;

const env = () => {
	const clean: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) if (!key.startsWith("HERDR_") && !key.startsWith("PI_BRIDGE_") && key !== "CODEX_HOME") clean[key] = value;
	return { ...clean, HOME: home, USERPROFILE: home };
};
/** Runs the exact command install writes, through sh -c as a stand-in for Codex's login shell. */
const hook = (event: Parameters<typeof codexHookHandler>[1], payload: Record<string, unknown>) => {
	const { command } = codexHookHandler({ node: process.execPath, main, platform: "linux" }, event);
	return spawnSync("/bin/sh", ["-c", command], { input: JSON.stringify({ session_id: SESSION, hook_event_name: event, cwd: home, model: "gpt-x", transcript_path: null, ...payload }), env: env(), encoding: "utf8", timeout: 20_000 });
};
const registry = () => { try { return readdirSync(join(home, ".mars-ram/bridges")).filter((name) => name.endsWith(".json")); } catch { return []; } };
const wait = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 50)); return check(); };

beforeEach(() => { home = realpathSync(mkdtempSync(join(tmpdir(), "mr-codex-proc-"))); });
afterEach(async () => {
	hook("SessionEnd", { reason: "other" });
	await wait(() => registry().length === 0);
	rmSync(home, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32" || /['\\]/.test(process.execPath + main))("mars-ram hook codex (real processes, temporary HOME)", () => {
	it("SessionStart starts one detached bridge with no rollout; later hooks reach it; SessionEnd stops it; all print nothing", async () => {
		expect(hook("SessionStart", { source: "startup", permission_mode: "default" })).toMatchObject({ status: 0, stdout: "" });
		expect(await wait(() => registry().length === 1)).toBe(true);
		const entry = decodeRegistryEntry(JSON.parse(readFileSync(join(home, ".mars-ram/bridges", registry()[0]!), "utf8")));
		if (!entry.ok) throw new Error(entry.errors.join("; "));
		expect(sessionCapabilities(entry.value)).toMatchObject({ agent: "codex", capabilities: { message: false, approvals: true } });
		expect(hook("SessionStart", { source: "resume" })).toMatchObject({ status: 0, stdout: "" });
		expect(registry()).toHaveLength(1);
		expect(hook("UserPromptSubmit", { prompt: "hola zorro", turn_id: "t1" })).toMatchObject({ status: 0, stdout: "" });
		const get = async (path: string) => (await fetch(`http://127.0.0.1:${entry.value.port}${path}`, { headers: { authorization: `Bearer ${entry.value.token}` } })).json();
		expect(await get("/state")).toMatchObject({ idle: false, sessionId: SESSION, agent: "codex" });
		expect((await get("/history")).messages).toMatchObject([{ role: "user", text: "hola zorro" }]);
		const started = Date.now();
		expect(hook("SessionEnd", { reason: "other" })).toMatchObject({ status: 0, stdout: "" });
		expect(Date.now() - started).toBeLessThan(3000);
		expect(await wait(() => registry().length === 0)).toBe(true);
		expect(await wait(() => readdirSync(join(home, ".mars-ram/agents")).length === 0)).toBe(true);
	}, 30_000);

	it("without a bridge every hook exits 0 at once and prints nothing", () => {
		for (const event of ["UserPromptSubmit", "PermissionRequest", "Stop", "Interrupt", "SessionEnd"] as const) {
			expect(hook(event, {})).toMatchObject({ status: 0, stdout: "" });
		}
		expect(registry()).toEqual([]);
	});
});
