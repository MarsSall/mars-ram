import { beforeEach, describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { decodeResponse, StateResponse, Subagents } from "@workspace/protocol";
import { BridgeSession } from "../../src/core/bridge-session.ts";
import type { EventBusPort, PiSessionPort } from "../../src/core/ports.ts";
import { SubagentTracker, TASKS_CHANNEL, TASKS_REQUEST_CHANNEL } from "../../src/core/subagents.ts";

/** Synchronous like Pi's bus: handlers run inside emit. */
class FakeBus implements EventBusPort {
	readonly handlers = new Map<string, Set<(data: unknown) => void>>();
	readonly emitted: { channel: string; data: unknown }[] = [];
	emit(channel: string, data: unknown) {
		this.emitted.push({ channel, data });
		for (const handler of this.handlers.get(channel) ?? []) handler(data);
	}
	on(channel: string, handler: (data: unknown) => void) {
		const set = this.handlers.get(channel) ?? new Set();
		set.add(handler);
		this.handlers.set(channel, set);
		return () => set.delete(handler);
	}
	listeners(channel: string) {
		return this.handlers.get(channel)?.size ?? 0;
	}
}

const pi: PiSessionPort = {
	sessionId: () => "sess-1",
	isIdle: () => true,
	hasPendingMessages: () => false,
	model: () => null,
	imagesBlocked: () => false,
	history: () => [],
	send: () => {},
	abort: () => {},
};

const task = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
	id, agent: "sdd-apply", label: `Task ${id}`, status, pendingQuery: false, ...extra,
});
const snapshot = (tasks: unknown[], sessionId = "sess-1") => ({ sessionId, tasks });

let now: number;
let bus: FakeBus;
let tracker: SubagentTracker;
let bridge: BridgeSession;
let disconnect: () => void;
const state = () => JSON.parse(JSON.stringify(bridge.state()));

beforeEach(() => {
	now = 1_000;
	bus = new FakeBus();
	tracker = new SubagentTracker(() => now);
	bridge = new BridgeSession({ pi, instanceId: "inst-1", capacity: 10, clock: () => now, subagents: tracker });
	disconnect = tracker.connect(bus, "sess-1");
});

describe("subagents from Gentle Agents' task snapshot", () => {
	it("asks for this session's snapshot on connect", () => {
		expect(bus.emitted).toEqual([{ channel: TASKS_REQUEST_CHANNEL, data: { sessionId: "sess-1" } }]);
		expect(bus.listeners(TASKS_CHANNEL)).toBe(1);
	});

	it("omits the field before any snapshot arrives", () => {
		expect(state()).not.toHaveProperty("subagents");
		expect(new BridgeSession({ pi, instanceId: "i", capacity: 1, clock: () => now }).state()).not.toHaveProperty("subagents");
	});

	it("maps active statuses and the pending question, and drops finished tasks", () => {
		bus.emit(TASKS_CHANNEL, snapshot([
			task("a", "running"),
			task("b", "queued", { label: "Line\none" }),
			task("c", "waiting", { pendingQuery: true }),
			task("d", "completed"), task("e", "failed"), task("f", "cancelled"), task("g", "timed_out"), task("h", "exploded"),
		]));
		const { subagents } = state();
		expect(Value.Check(Subagents, subagents)).toBe(true);
		expect(subagents).toEqual({
			available: true,
			items: [
				{ id: "c", agent: "sdd-apply", label: "Task c", status: "waiting", question: true, since: 1_000 },
				{ id: "a", agent: "sdd-apply", label: "Task a", status: "running", question: false, since: 1_000 },
				{ id: "b", agent: "sdd-apply", label: "Line one", status: "queued", question: false, since: 1_000 },
			],
		});
		expect(decodeResponse(StateResponse, state()).ok).toBe(true);
	});

	it("keeps the first-seen time across snapshots and status changes", () => {
		bus.emit(TASKS_CHANNEL, snapshot([task("a", "queued")]));
		now = 5_000;
		bus.emit(TASKS_CHANNEL, snapshot([task("a", "running"), task("b", "running")]));
		now = 9_000;
		bus.emit(TASKS_CHANNEL, snapshot([task("a", "waiting", { pendingQuery: true }), task("b", "running")]));
		expect(state().subagents.items).toEqual([
			expect.objectContaining({ id: "a", status: "waiting", question: true, since: 1_000 }),
			expect.objectContaining({ id: "b", status: "running", since: 5_000 }),
		]);
	});

	it("removes tasks once they finish, and stays available with no items", () => {
		bus.emit(TASKS_CHANNEL, snapshot([task("a", "running")]));
		bus.emit(TASKS_CHANNEL, snapshot([task("a", "completed")]));
		expect(state().subagents).toEqual({ available: true, items: [] });
		// A task seen again after it dropped out is new from that moment.
		now = 7_000;
		bus.emit(TASKS_CHANNEL, snapshot([task("a", "running")]));
		expect(state().subagents.items[0].since).toBe(7_000);
	});

	it("ignores snapshots of other sessions", () => {
		bus.emit(TASKS_CHANNEL, snapshot([task("x", "running")], "other"));
		expect(state()).not.toHaveProperty("subagents");
		bus.emit(TASKS_CHANNEL, snapshot([task("a", "running")]));
		bus.emit(TASKS_CHANNEL, snapshot([], "other"));
		expect(state().subagents.items.map((item: { id: string }) => item.id)).toEqual(["a"]);
	});

	it.each([
		["undefined", undefined], ["null", null], ["a string", "tasks"], ["no session", { tasks: [] }],
		["tasks not an array", { sessionId: "sess-1", tasks: {} }], ["numeric session", { sessionId: 1, tasks: [] }],
	])("ignores a malformed payload (%s) without throwing", (_name, payload) => {
		expect(() => bus.emit(TASKS_CHANNEL, payload)).not.toThrow();
		expect(state()).not.toHaveProperty("subagents");
	});

	it("drops malformed tasks and keeps the rest within the protocol bounds", () => {
		const many = Array.from({ length: 12 }, (_, i) => task(`t${String(i).padStart(2, "0")}`, "running", { agent: "a".repeat(40), label: "l".repeat(100) }));
		bus.emit(TASKS_CHANNEL, snapshot([null, 7, { id: "" , agent: "x", status: "running" }, { id: "n", status: "running" }, task("a", "running", { pendingQuery: "yes" }), ...many]));
		const { subagents } = state();
		expect(Value.Check(Subagents, subagents)).toBe(true);
		expect(subagents.items).toHaveLength(8);
		expect(subagents.items[0]).toMatchObject({ id: "a", question: false });
		expect(subagents.items[1].agent).toHaveLength(24);
		expect(subagents.items[1].label).toHaveLength(60);
	});

	it("survives a throwing getter in a hostile payload", () => {
		const hostile = { sessionId: "sess-1", get tasks() { throw new Error("boom"); } };
		expect(() => bus.emit(TASKS_CHANNEL, hostile)).not.toThrow();
		expect(state()).not.toHaveProperty("subagents");
	});

	it("stops listening on disconnect and starts over on reconnect", () => {
		bus.emit(TASKS_CHANNEL, snapshot([task("a", "running")]));
		disconnect();
		disconnect();
		expect(bus.listeners(TASKS_CHANNEL)).toBe(0);
		bus.emit(TASKS_CHANNEL, snapshot([task("b", "running")]));
		expect(state().subagents.items.map((item: { id: string }) => item.id)).toEqual(["a"]);
		tracker.reset();
		expect(state()).not.toHaveProperty("subagents");
		tracker.connect(bus, "sess-2");
		expect(bus.emitted.at(-1)).toEqual({ channel: TASKS_REQUEST_CHANNEL, data: { sessionId: "sess-2" } });
		bus.emit(TASKS_CHANNEL, snapshot([task("a", "running")]));
		expect(state()).not.toHaveProperty("subagents");
	});

	it("answers a request synchronously, like Gentle Agents does", () => {
		const answering = new FakeBus();
		answering.on(TASKS_REQUEST_CHANNEL, (data) => answering.emit(TASKS_CHANNEL, snapshot([task("a", "running")], (data as { sessionId: string }).sessionId)));
		tracker.connect(answering, "sess-1");
		expect(tracker.read()).toEqual({ available: true, items: [expect.objectContaining({ id: "a", since: 1_000 })] });
	});

	it("has no reading without a bus or with a failing one", () => {
		tracker.connect(undefined, "sess-1");
		expect(tracker.read()).toBeUndefined();
		const failing: EventBusPort = { on: () => { throw new Error("no bus"); }, emit: () => { throw new Error("no bus"); } };
		expect(() => tracker.connect(failing, "sess-1")()).not.toThrow();
		expect(tracker.read()).toBeUndefined();
	});
});
