import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
	boundSubagents,
	checkCompatibility,
	decodeResponse,
	PROTOCOL_VERSION,
	StateResponse,
	SUBAGENTS_MAX_ITEMS,
	SubagentItem,
	Subagents,
} from "../src/index.ts";

const envelope = { protocolVersion: PROTOCOL_VERSION, bridgeInstanceId: "inst-1", sessionId: "sess-1" };
const state = { ...envelope, idle: false, pendingMessages: false, pendingPrompt: null, model: null, lastSeq: 3, oldestSeq: 1, lastActivityAt: 1000 };
const item = (over: Record<string, unknown> = {}) => ({ id: "t1", agent: "sdd-apply", label: "Write the tests", status: "running", question: false, since: 1000, ...over });

describe("subagents on the session state (1.8)", () => {
	it("is a minor, additive bump that 1.7 and 1.8 peers accept from each other", () => {
		expect(PROTOCOL_VERSION).toBe("1.8");
		expect(checkCompatibility("1.7")).toEqual({ ok: true });
		expect(checkCompatibility("1.8")).toEqual({ ok: true });
	});

	it("decodes a state with subagents and keeps them", () => {
		const snapshot = { ...state, subagents: { available: true, items: [item(), item({ id: "t2", status: "waiting", question: true })] } };
		expect(decodeResponse(StateResponse, snapshot)).toEqual({ ok: true, value: snapshot });
		expect(Value.Check(Subagents, snapshot.subagents)).toBe(true);
		expect(boundSubagents(snapshot.subagents).items.map((i) => i.id)).toEqual(["t2", "t1"]);
	});

	it("decodes a 1.7 state without subagents, which reads as not available", () => {
		const old = { ...state, protocolVersion: "1.7" };
		const decoded = decodeResponse(StateResponse, old);
		expect(decoded).toEqual({ ok: true, value: old });
		expect(boundSubagents(decoded.ok ? decoded.value.subagents : undefined)).toEqual({ available: false, items: [] });
	});

	it("lets a 1.7 app schema ignore the new field", () => {
		const oldState = Type.Omit(StateResponse, ["subagents"]);
		expect(decodeResponse(oldState, { ...state, subagents: { available: true, items: [item()] } }).ok).toBe(true);
	});

	it.each([null, 3, "x", [], { available: "yes" }, { available: true, items: "no" }, { available: true, items: [{ id: 5 }] }])(
		"never makes the state undecodable for invalid subagents %j, and reads them through boundSubagents",
		(subagents) => {
			const decoded = decodeResponse(StateResponse, { ...state, subagents });
			expect(decoded.ok).toBe(true);
			const bounded = boundSubagents(subagents);
			expect(Value.Check(Subagents, bounded)).toBe(true);
			expect(bounded.items).toEqual([]);
		},
	);
});

describe("boundSubagents", () => {
	it.each([undefined, null, 0, "running", [], {}, { available: false, items: [item()] }, { available: 1, items: [item()] }])(
		"is not available for %j",
		(raw) => {
			expect(boundSubagents(raw)).toEqual({ available: false, items: [] });
		},
	);

	it("keeps available with no items when items are missing or not a list", () => {
		expect(boundSubagents({ available: true })).toEqual({ available: true, items: [] });
		expect(boundSubagents({ available: true, items: {} })).toEqual({ available: true, items: [] });
	});

	it("keeps a valid item as it is", () => {
		expect(boundSubagents({ available: true, items: [item()] })).toEqual({ available: true, items: [item()] });
	});

	it.each([
		["a missing id", { id: undefined }],
		["an empty id", { id: "" }],
		["a numeric id", { id: 7 }],
		["an id over 64 characters", { id: "i".repeat(65) }],
		["an unknown status", { status: "done" }],
		["a missing status", { status: undefined }],
		["a missing agent", { agent: undefined }],
		["a blank agent", { agent: "  \n " }],
		["a missing since", { since: undefined }],
		["a negative since", { since: -1 }],
		["a non-finite since", { since: Number.POSITIVE_INFINITY }],
		["a text since", { since: "1000" }],
	])("drops an item with %s", (_name, over) => {
		expect(boundSubagents({ available: true, items: [item(over), item({ id: "ok" })] }).items.map((i) => i.id)).toEqual(["ok"]);
	});

	it("drops entries that are not objects and repeated ids, keeping the first", () => {
		const result = boundSubagents({ available: true, items: [null, "t", 3, item({ label: "first" }), item({ label: "second" })] });
		expect(result.items).toEqual([item({ label: "first" })]);
	});

	it("cuts agent to 24 and label to 60 code points, as one line", () => {
		const result = boundSubagents({ available: true, items: [item({ agent: "a".repeat(30), label: `  ${"😀".repeat(70)}\nmore ` })] });
		const [only] = result.items;
		expect(only?.agent).toBe("a".repeat(24));
		expect(only?.label).toBe("😀".repeat(60));
		expect(boundSubagents({ available: true, items: [item({ label: " Fix\n\tthe   bug " })] }).items[0]?.label).toBe("Fix the bug");
		expect(Value.Check(Subagents, result)).toBe(true);
	});

	it("reads a missing or non-text label as empty, a non-true question as false, and floors since", () => {
		const [only] = boundSubagents({ available: true, items: [item({ label: undefined, question: "yes", since: 1500.9 })] }).items;
		expect(only).toEqual(item({ label: "", question: false, since: 1500 }));
	});

	it("puts questions first, then the oldest, then by id", () => {
		const items = [
			item({ id: "c", since: 300 }),
			item({ id: "b", since: 100 }),
			item({ id: "q2", since: 400, question: true, status: "waiting" }),
			item({ id: "a", since: 100 }),
			item({ id: "q1", since: 200, question: true }),
		];
		expect(boundSubagents({ available: true, items }).items.map((i) => i.id)).toEqual(["q1", "q2", "a", "b", "c"]);
	});

	it("keeps at most 8, choosing after sorting so a question is never cut", () => {
		const many = Array.from({ length: 12 }, (_, i) => item({ id: `t${i}`, since: i }));
		many.push(item({ id: "late-question", since: 99, question: true }));
		const result = boundSubagents({ available: true, items: many });
		expect(result.items).toHaveLength(SUBAGENTS_MAX_ITEMS);
		expect(result.items[0]?.id).toBe("late-question");
		expect(result.items.map((i) => i.id).slice(1)).toEqual(["t0", "t1", "t2", "t3", "t4", "t5", "t6"]);
	});

	it("always yields a value the schema accepts", () => {
		const raw = { available: true, items: [item({ agent: "x".repeat(99), label: "y".repeat(99) }), ...Array.from({ length: 20 }, (_, i) => item({ id: `i${i}` }))] };
		expect(Value.Check(Subagents, boundSubagents(raw))).toBe(true);
		expect(Value.Check(SubagentItem, boundSubagents(raw).items[0])).toBe(true);
	});
});
