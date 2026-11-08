import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { decodeEvent, decodeResponse, StateResponse } from "@workspace/protocol";
import type { BridgeSession } from "../../src/core/bridge-session.ts";
import extension from "../../src/extension.ts";

const fake = vi.hoisted(() => ({ session: undefined as BridgeSession | undefined }));
vi.mock("../../src/adapters/http-server.ts", () => ({
	startHttpServer: async ({ session }: { session: BridgeSession }) => {
		fake.session = session;
		return { port: 12345, close: async () => {} };
	},
}));
vi.mock("../../src/adapters/registry.ts", () => ({ pruneStaleEntries: () => {}, publishEntry: () => "unused" }));
vi.mock("../../src/adapters/lifecycle.ts", () => ({ stopInstance: async () => {} }));
vi.mock("../../src/adapters/herdr-terminal.ts", () => ({ createHerdrTerminal: () => undefined }));
vi.mock("../../src/core/publish-policy.ts", () => ({ publishesSession: () => true }));

const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
const ctx = {
	cwd: "/work/project", isIdle: () => true, hasPendingMessages: () => false,
	sessionManager: { getSessionId: () => "s" },
} as unknown as ExtensionContext;
async function emit(type: string, event: object = {}) {
	await handlers.get(type)!({ type, ...event }, ctx);
}
const snapshot = () => JSON.parse(JSON.stringify(fake.session!.state()));
const latest = () => JSON.parse(JSON.stringify(fake.session!.eventsSince(0).events.at(-1)));

beforeEach(async () => {
	handlers.clear();
	extension({ on: (type: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) => handlers.set(type, handler) } as unknown as ExtensionAPI);
	await emit("session_start", { reason: "startup" });
});

describe("extension settle wire contract (no Pi or sockets)", () => {
	it.each([
		["stop", false, "completed"], ["error", false, "failed"],
		["aborted", false, "aborted"], ["stop", true, "aborted"],
	])("emits %s / aborted=%s as %s", async (stopReason, aborted, outcome) => {
		await emit("agent_start");
		await emit("agent_end", { messages: [{ role: "assistant", stopReason }, { role: "toolResult", isError: true }] });
		// Agent end is not settlement: retries/compaction may still follow.
		expect(snapshot()).not.toHaveProperty("lastOutcome");
		await emit("agent_settled", { aborted });
		const event = latest();
		expect(event).toMatchObject({ type: "agent_settled", aborted, outcome });
		expect(decodeEvent(event)).toEqual({ kind: "known", event });
		const state = snapshot();
		expect(state.lastOutcome).toEqual({ outcome, seq: event.seq });
		expect(decodeResponse(StateResponse, state)).toEqual({ ok: true, value: state });
	});

	it("omits unsupported evidence and does not reuse the previous session's message", async () => {
		await emit("agent_end", { messages: [{ role: "assistant", stopReason: "length" }] });
		await emit("agent_settled", { aborted: false });
		expect(latest()).not.toHaveProperty("outcome");
		expect(snapshot()).not.toHaveProperty("lastOutcome");
		await emit("agent_end", { messages: [{ role: "assistant", stopReason: "error" }] });
		await emit("session_start", { reason: "new" });
		await emit("agent_settled", { aborted: false });
		expect(latest()).not.toHaveProperty("outcome");
		expect(snapshot()).not.toHaveProperty("lastOutcome");
	});
});
