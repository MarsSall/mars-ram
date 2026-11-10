import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import {
	checkCompatibility,
	EVENT_SCHEMAS,
	decodeEvent,
	decodeRegistryEntry,
	decodeResponse,
	PROTOCOL_VERSION,
	StateResponse,
} from "../src/index.ts";

const envelope = { protocolVersion: PROTOCOL_VERSION, bridgeInstanceId: "inst-1", sessionId: "sess-1" };

describe("checkCompatibility", () => {
	it("accepts the same version", () => {
		expect(checkCompatibility(PROTOCOL_VERSION)).toEqual({ ok: true });
	});

	it("accepts another minor version of the same major, because changes within a major are additive", () => {
		expect(checkCompatibility("1.0")).toEqual({ ok: true });
		expect(checkCompatibility("1.7")).toEqual({ ok: true });
	});

	it("rejects a different major version with a clear message", () => {
		expect(checkCompatibility("2.0")).toEqual({
			ok: false,
			message: "The bridge speaks protocol 2.0, but this app supports protocol 1.x. Update the app or the bridge so both use the same major version.",
		});
	});

	it("rejects a malformed version with a clear message", () => {
		expect(checkCompatibility("one")).toEqual({
			ok: false,
			message: 'The bridge reported an invalid protocol version "one".',
		});
	});
});

describe("decodeResponse", () => {
	const state = {
		...envelope,
		idle: true,
		pendingMessages: false,
		pendingPrompt: null,
		model: { id: "m", provider: "p", acceptsImages: true },
		lastSeq: 3,
		oldestSeq: 1,
		lastActivityAt: 1000,
	};

	it("preserves the optional captured pane and accepts older snapshots", () => {
		expect(PROTOCOL_VERSION).toBe("1.7");
		const snapshot = { ...state, terminal: true, terminalPane: "w2G:p2" };
		expect(decodeResponse(StateResponse, snapshot)).toEqual({ ok: true, value: snapshot });
		expect(decodeResponse(StateResponse, { ...state, protocolVersion: "1.4" }).ok).toBe(true);
		expect(decodeResponse(StateResponse, { ...state, terminalPane: 42 }).ok).toBe(false);
	});

	it.each([null, "exploring", "future-phase", "a".repeat(32)])("accepts activity %s", (activity) => {
		const snapshot = { ...state, activity };
		expect(decodeResponse(StateResponse, snapshot)).toEqual({ ok: true, value: snapshot });
	});

	it("accepts a 1.3 snapshot without activity (absence means null to clients)", () => {
		expect(decodeResponse(StateResponse, { ...state, protocolVersion: "1.3" }).ok).toBe(true);
	});

	it.each(["", "Exploring", "read file", "a".repeat(33), "exploring\n", 3, {}])("rejects invalid activity %s", (activity) => {
		expect(decodeResponse(StateResponse, { ...state, activity }).ok).toBe(false);
	});

	it("accepts a valid response", () => {
		expect(decodeResponse(StateResponse, state)).toEqual({ ok: true, value: state });
	});

	it.each(["protocolVersion", "bridgeInstanceId", "sessionId"])("rejects a response without %s", (field) => {
		const { [field as keyof typeof state]: _removed, ...incomplete } = state;
		const result = decodeResponse(StateResponse, incomplete);
		expect(result.ok).toBe(false);
	});

	it("ignores unknown fields, so a newer minor version can add them", () => {
		const result = decodeResponse(StateResponse, { ...state, addedLater: 1 });
		expect(result.ok).toBe(true);
	});
});

describe("settle outcome contract (1.6)", () => {
	const state = { ...envelope, idle: true, pendingMessages: false, pendingPrompt: null, model: null, lastSeq: 5, oldestSeq: 1, lastActivityAt: 1000 };
	it.each(["completed", "failed", "aborted"])("carries %s on events and snapshots", (outcome) => {
		const event = { type: "agent_settled", seq: 5, at: 1000, aborted: outcome === "aborted", pendingMessages: false, outcome };
		expect(decodeEvent(event)).toEqual({ kind: "known", event });
		const snapshot = { ...state, lastOutcome: { outcome, seq: 5 } };
		expect(decodeResponse(StateResponse, snapshot)).toEqual({ ok: true, value: snapshot });
	});
	it("keeps 1.5 app schemas compatible with the new additive fields", () => {
		const oldState = Type.Omit(StateResponse, ["lastOutcome"]);
		const oldSettle = Type.Omit(EVENT_SCHEMAS.agent_settled, ["outcome"]);
		expect(decodeResponse(oldState, { ...state, lastOutcome: { outcome: "failed", seq: 5 } }).ok).toBe(true);
		expect(decodeResponse(oldSettle, { type: "agent_settled", seq: 5, at: 1000, aborted: false, pendingMessages: false, outcome: "failed" }).ok).toBe(true);
	});
	it("accepts older payloads without claiming an outcome", () => {
		const event = { type: "agent_settled", seq: 5, at: 1000, aborted: false, pendingMessages: false };
		expect(decodeEvent(event)).toEqual({ kind: "known", event });
		expect(decodeResponse(StateResponse, { ...state, protocolVersion: "1.5" })).toEqual({ ok: true, value: { ...state, protocolVersion: "1.5" } });
	});
	it.each(["error", "unknown", null, 1])("rejects invalid outcome %s", (outcome) => {
		expect(decodeEvent({ type: "agent_settled", seq: 5, at: 1000, aborted: false, pendingMessages: false, outcome }).kind).toBe("invalid");
		expect(decodeResponse(StateResponse, { ...state, lastOutcome: { outcome, seq: 5 } }).ok).toBe(false);
	});
	it.each([0, -1, 1.5, "5", undefined])("rejects invalid outcome cursor %s", (seq) => {
		expect(decodeResponse(StateResponse, { ...state, lastOutcome: { outcome: "completed", seq } }).ok).toBe(false);
	});
});

describe("decodeEvent", () => {
	it.each([null, "checking", "future-phase"])("decodes activity %s", (activity) => {
		const event = { seq: 1, at: 1000, type: "activity", activity };
		expect(decodeEvent(event)).toEqual({ kind: "known", event });
	});

	it.each([undefined, "", "Checking", "x".repeat(33), "checking\n", 42])("rejects invalid activity event %s", (activity) => {
		expect(decodeEvent({ seq: 1, at: 1000, type: "activity", activity }).kind).toBe("invalid");
	});

	it("decodes a known event", () => {
		const event = { seq: 4, at: 1, type: "agent_settled", aborted: true, pendingMessages: false };
		expect(decodeEvent(event)).toEqual({ kind: "known", event });
	});

	it("keeps an unknown event type as unknown instead of failing, so older apps tolerate newer bridges", () => {
		expect(decodeEvent({ seq: 5, at: 1, type: "added_later", x: 1 })).toEqual({ kind: "unknown", seq: 5, type: "added_later" });
	});

	it("rejects a known event type with invalid fields", () => {
		expect(decodeEvent({ seq: 6, at: 1, type: "agent_settled", aborted: "yes" }).kind).toBe("invalid");
	});

	it("rejects data that is not an event", () => {
		expect(decodeEvent({ type: "agent_start" }).kind).toBe("invalid");
	});
});

describe("decodeRegistryEntry", () => {
	const entry = {
		...envelope,
		port: 40123,
		token: "a".repeat(64),
		pid: 77,
		cwd: "/home/u/project",
		startedAt: 1,
	};

	it("accepts a valid registry entry", () => {
		expect(decodeRegistryEntry(entry)).toEqual({ ok: true, value: entry });
	});

	it("rejects a port outside the valid range", () => {
		expect(decodeRegistryEntry({ ...entry, port: 70000 }).ok).toBe(false);
	});
});

describe("registry location", () => {
	it("derives the registry directory from the app id", async () => {
		const { APP_ID, REGISTRY_DIRECTORY } = await import("../src/index.ts");
		expect(REGISTRY_DIRECTORY).toBe(`.${APP_ID}/bridges`);
	});

	it("names the host folder and the pairing links after Mars-RAM", async () => {
		const { APP_ID, REGISTRY_DIRECTORY } = await import("../src/index.ts");
		expect(APP_ID).toBe("mars-ram");
		expect(REGISTRY_DIRECTORY).toBe(".mars-ram/bridges");
	});
});
