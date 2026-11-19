import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BridgeSession } from "../../src/core/bridge-session.ts";
import { TASKS_CHANNEL, TASKS_REQUEST_CHANNEL } from "../../src/core/subagents.ts";
import extension from "../../src/extension.ts";

const fake = vi.hoisted(() => ({ session: undefined as BridgeSession | undefined, publishes: true }));
vi.mock("../../src/adapters/http-server.ts", () => ({
	startHttpServer: async ({ session }: { session: BridgeSession }) => {
		fake.session = session;
		return { port: 12345, close: async () => {} };
	},
}));
vi.mock("../../src/adapters/registry.ts", () => ({ pruneStaleEntries: () => {}, publishEntry: () => "unused" }));
vi.mock("../../src/adapters/lifecycle.ts", () => ({ stopInstance: async () => {} }));
vi.mock("../../src/adapters/herdr-terminal.ts", () => ({ createHerdrTerminal: () => undefined }));
vi.mock("../../src/core/publish-policy.ts", () => ({ publishesSession: () => fake.publishes }));

const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
const bus = {
	handlers: new Map<string, Set<(data: unknown) => void>>(),
	requests: [] as unknown[],
	emit(channel: string, data: unknown) {
		if (channel === TASKS_REQUEST_CHANNEL) this.requests.push(data);
		for (const handler of this.handlers.get(channel) ?? []) handler(data);
	},
	on(channel: string, handler: (data: unknown) => void) {
		const set = this.handlers.get(channel) ?? new Set();
		set.add(handler);
		this.handlers.set(channel, set);
		return () => set.delete(handler);
	},
};
let sessionId = "s1";
const ctx = {
	cwd: "/work/project", isIdle: () => true, hasPendingMessages: () => false,
	sessionManager: { getSessionId: () => sessionId },
} as unknown as ExtensionContext;
const emit = (type: string, event: object = {}) => handlers.get(type)!({ type, ...event }, ctx);
const tasks = (owner: string) => ({ sessionId: owner, tasks: [{ id: "t1", agent: "explore", label: "Look", status: "running", pendingQuery: false }] });
const listeners = () => bus.handlers.get(TASKS_CHANNEL)?.size ?? 0;

beforeEach(() => {
	handlers.clear();
	bus.handlers.clear();
	bus.requests = [];
	sessionId = "s1";
	fake.publishes = true;
	fake.session = undefined;
	extension({ events: bus, on: (type: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) => handlers.set(type, handler) } as unknown as ExtensionAPI);
});

describe("extension subagents wiring (no Pi or sockets)", () => {
	it("requests this session's snapshot on start and serves it in state", async () => {
		await emit("session_start", { reason: "startup" });
		expect(bus.requests).toEqual([{ sessionId: "s1" }]);
		expect(fake.session!.state()).not.toHaveProperty("subagents");
		bus.emit(TASKS_CHANNEL, tasks("s1"));
		expect(fake.session!.state().subagents).toMatchObject({ available: true, items: [{ id: "t1", status: "running" }] });
	});

	it("starts over for a replaced session and filters the old one out", async () => {
		await emit("session_start", { reason: "startup" });
		bus.emit(TASKS_CHANNEL, tasks("s1"));
		await emit("session_shutdown");
		expect(listeners()).toBe(0);
		sessionId = "s2";
		await emit("session_start", { reason: "new" });
		expect(listeners()).toBe(1);
		expect(bus.requests.at(-1)).toEqual({ sessionId: "s2" });
		expect(fake.session!.state()).not.toHaveProperty("subagents");
		bus.emit(TASKS_CHANNEL, tasks("s1"));
		expect(fake.session!.state()).not.toHaveProperty("subagents");
		bus.emit(TASKS_CHANNEL, tasks("s2"));
		expect((fake.session!.state().subagents as { items: unknown[] }).items).toHaveLength(1);
	});

	it("does not listen for unpublished background sessions", async () => {
		fake.publishes = false;
		await emit("session_start", { reason: "startup" });
		expect(bus.requests).toEqual([]);
		expect(listeners()).toBe(0);
	});

	it("keeps one listener across repeated starts", async () => {
		await emit("session_start", { reason: "startup" });
		await emit("session_start", { reason: "reload" });
		expect(listeners()).toBe(1);
	});
});
