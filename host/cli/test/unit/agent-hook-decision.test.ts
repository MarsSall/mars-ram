// The PermissionRequest hook prints only an output it builds itself from a plain decision, and only when the answer
// comes from the bridge instance named in the session's control record. Temporary agents folder only.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ControlRecord } from "../../src/adapters/agent-bridge.ts";
import { type HookIO, runClaudeHook } from "../../src/adapters/claude-hook-client.ts";
import { type CodexHookIO, runCodexHook } from "../../src/adapters/codex-hook-client.ts";

const SESSION = "5f0c2a8e-1111-4c3b-9d2e-000000000009";
const INSTANCE = "0b6f6a8e-2222-4c3b-9d2e-0000000000aa";
const control: ControlRecord = { version: 1, pid: 4242, port: 50001, hookToken: "h".repeat(64), bridgeInstanceId: INSTANCE };

/** A live bridge's control record, as the bridge publishes it: inside its session lock's marker. */
function writeControl(agentsDir: string, prefix: string, session: string, control: { pid: number }): string {
	const lock = join(agentsDir, `${prefix}-${session}.lock`);
	mkdirSync(lock, { recursive: true });
	writeFileSync(join(lock, `${control.pid}-${"a".repeat(16)}`), JSON.stringify(control));
	return lock;
}

async function run(agent: "claude" | "codex", answer: unknown): Promise<{ stdout: string[] }> {
	const dir = mkdtempSync(join(tmpdir(), "mr-decision-"));
	const stdout: string[] = [];
	try {
		const agentsDir = join(dir, "agents");
		mkdirSync(agentsDir);
		writeControl(agentsDir, agent, SESSION, control);
		const base = {
			stdin: async () => JSON.stringify({ session_id: SESSION, tool_name: "Bash", tool_input: { command: "ls" } }),
			stdout: async (text: string) => { stdout.push(text); },
			paths: { registryDir: join(dir, "bridges"), agentsDir },
			alive: () => true,
			hostConfig: () => undefined,
			spawnBridge: () => {},
			post: async () => answer,
			sleep: async () => {},
		};
		if (agent === "claude") await runClaudeHook("PermissionRequest", { ...base, claudePid: () => undefined } satisfies HookIO);
		else await runCodexHook("PermissionRequest", { ...base, codexPid: async () => undefined } satisfies CodexHookIO);
	} finally { rmSync(dir, { recursive: true, force: true }); }
	return { stdout };
}

const out = (decision: Record<string, unknown>) => JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision } });

describe.each(["claude", "codex"] as const)("hook %s PermissionRequest output", (agent) => {
	it("builds allow and deny locally from the bridge's decision", async () => {
		expect(await run(agent, { bridgeInstanceId: INSTANCE, decision: { behavior: "allow" } })).toEqual({ stdout: [out({ behavior: "allow" })] });
		expect(await run(agent, { bridgeInstanceId: INSTANCE, decision: { behavior: "deny", message: "Declined from the mars-ram app." } })).toEqual({ stdout: [out({ behavior: "deny", message: "Declined from the mars-ram app." })] });
		expect(await run(agent, { bridgeInstanceId: INSTANCE, decision: { behavior: "deny" } })).toEqual({ stdout: [out({ behavior: "deny" })] });
	});

	it("never prints what else the bridge returns: updatedInput, updatedPermissions, interrupt or a ready-made output", async () => {
		const answer = {
			bridgeInstanceId: INSTANCE,
			decision: { behavior: "allow", updatedInput: { command: "rm -rf /" }, updatedPermissions: [{ type: "addRules" }], interrupt: true },
			output: { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow", updatedInput: { command: "rm -rf /" } } } },
			updatedInput: { command: "rm -rf /" },
		};
		const { stdout } = await run(agent, answer);
		expect(stdout).toEqual([out({ behavior: "allow" })]);
		expect(stdout.join("")).not.toMatch(/updatedInput|updatedPermissions|interrupt|rm -rf/);
	});

	it.each([
		["a ready-made output only (the old answer shape)", { bridgeInstanceId: INSTANCE, output: { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } } }],
		["another bridge instance", { bridgeInstanceId: "someone-else", decision: { behavior: "allow" }, output: { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } } }],
		["no bridge instance", { decision: { behavior: "allow" }, output: { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } } }],
		["an unknown behavior", { bridgeInstanceId: INSTANCE, decision: { behavior: "ask" } }],
		["a decision that is a string", { bridgeInstanceId: INSTANCE, decision: "allow" }],
		["a message that is not a string", { bridgeInstanceId: INSTANCE, decision: { behavior: "deny", message: { text: "x" } } }],
		["an overlong message", { bridgeInstanceId: INSTANCE, decision: { behavior: "deny", message: "x".repeat(1000) } }],
		["a list", [{ bridgeInstanceId: INSTANCE, decision: { behavior: "allow" } }]],
		["nothing", undefined],
		["text", "allow"],
	])("prints nothing for %s", async (_name, answer) => {
		expect(await run(agent, answer)).toEqual({ stdout: [] });
	});
});
