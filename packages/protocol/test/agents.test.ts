import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
	APPROVAL_DETAIL_MAX_LENGTH,
	APPROVAL_TITLE_MAX_LENGTH,
	APPROVALS_MAX_ITEMS,
	ApprovalAnswer,
	ApprovalAnswerResponse,
	ApprovalRequest,
	boundApproval,
	boundApprovals,
	Capabilities,
	checkCompatibility,
	decodeApprovalAnswer,
	decodeEvent,
	decodeRegistryEntry,
	decodeResponse,
	LEGACY_PI_CAPABILITIES,
	NO_CAPABILITIES,
	PROTOCOL_VERSION,
	RegistryEntry,
	sessionCapabilities,
	StateResponse,
	supportsAttachments,
	supportsTempUploads,
} from "../src/index.ts";

const envelope = { protocolVersion: PROTOCOL_VERSION, bridgeInstanceId: "inst-1", sessionId: "sess-1" };
const state = { ...envelope, idle: false, pendingMessages: false, pendingPrompt: null, model: null, lastSeq: 3, oldestSeq: 1, lastActivityAt: 1000 };
const entry = { ...envelope, port: 40000, token: "t".repeat(64), pid: 42, cwd: "/work", startedAt: 1 };
const all = (value: boolean): Capabilities => ({ message: value, steer: value, abort: value, attachments: value, terminal: value, approvals: value });
const approval = (over: Record<string, unknown> = {}) => ({
	id: "req-1",
	kind: "command",
	title: "Run pnpm test",
	detail: "pnpm test\nin /work",
	choices: ["accept", "acceptForSession", "decline", "cancel"],
	...over,
});

describe("protocol 1.9", () => {
	it("is a minor, additive bump that 1.8 and 1.9 peers accept from each other", () => {
		expect(PROTOCOL_VERSION).toBe("1.9");
		expect(checkCompatibility("1.8")).toEqual({ ok: true });
		expect(checkCompatibility("1.9")).toEqual({ ok: true });
		expect(supportsAttachments("1.9")).toBe(true);
		expect(supportsTempUploads("1.9")).toBe(true);
	});

	it("decodes a 1.8 state and registry entry without the new fields, which read as legacy Pi", () => {
		const oldState = { ...state, protocolVersion: "1.8" };
		const oldEntry = { ...entry, protocolVersion: "1.8" };
		const decodedState = decodeResponse(StateResponse, oldState);
		const decodedEntry = decodeRegistryEntry(oldEntry);
		expect(decodedState).toEqual({ ok: true, value: oldState });
		expect(decodedEntry).toEqual({ ok: true, value: oldEntry });
		expect(sessionCapabilities(decodedState.ok ? decodedState.value : undefined)).toEqual({ agent: "pi", capabilities: LEGACY_PI_CAPABILITIES });
		expect(sessionCapabilities(decodedEntry.ok ? decodedEntry.value : undefined)).toEqual({ agent: "pi", capabilities: LEGACY_PI_CAPABILITIES });
		expect(boundApprovals(decodedState.ok ? decodedState.value.approvals : undefined)).toEqual([]);
	});

	it("lets a 1.8 app schema ignore the new state and registry fields", () => {
		const oldState = Type.Omit(StateResponse, ["agent", "capabilities", "approvals"]);
		const oldEntry = Type.Omit(RegistryEntry, ["agent", "capabilities"]);
		const codex = { agent: "codex", capabilities: all(true) };
		expect(decodeResponse(oldState, { ...state, ...codex, approvals: [approval()] }).ok).toBe(true);
		expect(decodeResponse(oldEntry, { ...entry, ...codex }).ok).toBe(true);
	});

	it("keeps the new approval events unknown, not invalid, for a decoder that does not know them", () => {
		// An older app's decoder has no schema for these types, exactly like any later addition.
		expect(decodeEvent({ seq: 4, at: 1, type: "approval_later", ...approval() })).toEqual({ kind: "unknown", seq: 4, type: "approval_later" });
	});
});

describe("sessionCapabilities", () => {
	it("reads absent agent and capabilities as legacy Pi: everything Pi does today, no approvals", () => {
		expect(LEGACY_PI_CAPABILITIES).toEqual({ message: true, steer: true, abort: true, attachments: true, terminal: true, approvals: false });
		expect(sessionCapabilities({})).toEqual({ agent: "pi", capabilities: LEGACY_PI_CAPABILITIES });
		expect(sessionCapabilities(undefined)).toEqual({ agent: "pi", capabilities: LEGACY_PI_CAPABILITIES });
		expect(sessionCapabilities(null)).toEqual({ agent: "pi", capabilities: LEGACY_PI_CAPABILITIES });
	});

	it("reads an explicit Pi like an absent one, letting declared booleans override", () => {
		expect(sessionCapabilities({ agent: "pi" })).toEqual({ agent: "pi", capabilities: LEGACY_PI_CAPABILITIES });
		expect(sessionCapabilities({ agent: "pi", capabilities: { terminal: false } }).capabilities).toEqual({ ...LEGACY_PI_CAPABILITIES, terminal: false });
	});

	it("reads Codex with its declared capabilities", () => {
		const codex = { message: true, steer: true, abort: true, attachments: false, terminal: true, approvals: true };
		expect(sessionCapabilities({ agent: "codex", capabilities: codex })).toEqual({ agent: "codex", capabilities: codex });
	});

	it("reads Claude Code with its declared capabilities, and nothing undeclared", () => {
		const claude = { message: true, steer: false, abort: true, attachments: true, terminal: true, approvals: false };
		expect(sessionCapabilities({ agent: "claude-code", capabilities: claude })).toEqual({ agent: "claude-code", capabilities: claude });
		expect(sessionCapabilities({ agent: "claude-code", capabilities: { message: true } })).toEqual({
			agent: "claude-code",
			capabilities: { ...NO_CAPABILITIES, message: true },
		});
		expect(sessionCapabilities({ agent: "claude-code" })).toEqual({ agent: "claude-code", capabilities: NO_CAPABILITIES });
	});

	it("ignores unknown capability keys", () => {
		const result = sessionCapabilities({ agent: "codex", capabilities: { ...all(false), message: true, voice: true, __proto__: { steer: true } } });
		expect(result.capabilities).toEqual({ ...NO_CAPABILITIES, message: true });
		expect(Object.keys(result.capabilities).sort()).toEqual(["abort", "approvals", "attachments", "message", "steer", "terminal"]);
	});

	it.each([7, "", "Codex", "gemini", null, true, {}])("reads agent %j as unknown with no capabilities beyond the declared ones", (agent) => {
		expect(sessionCapabilities({ agent })).toEqual({ agent: "unknown", capabilities: NO_CAPABILITIES });
		expect(sessionCapabilities({ agent, capabilities: { message: true } }).capabilities).toEqual({ ...NO_CAPABILITIES, message: true });
	});

	it.each([null, 3, "all", [true, true], { message: "yes", steer: 1, abort: null }])(
		"never makes the state or registry entry undecodable for invalid capabilities %j, falling back to the agent's defaults",
		(capabilities) => {
			expect(decodeResponse(StateResponse, { ...state, agent: "codex", capabilities }).ok).toBe(true);
			expect(decodeRegistryEntry({ ...entry, agent: "codex", capabilities }).ok).toBe(true);
			expect(sessionCapabilities({ agent: "codex", capabilities })).toEqual({ agent: "codex", capabilities: NO_CAPABILITIES });
			expect(sessionCapabilities({ capabilities })).toEqual({ agent: "pi", capabilities: LEGACY_PI_CAPABILITIES });
		},
	);

	it("never makes a state or registry entry undecodable for an unknown agent", () => {
		expect(decodeResponse(StateResponse, { ...state, agent: "gemini" }).ok).toBe(true);
		expect(decodeRegistryEntry({ ...entry, agent: { name: "x" } }).ok).toBe(true);
	});

	it("always yields a value the schema accepts", () => {
		for (const raw of [{}, { agent: "codex", capabilities: { message: 1 } }, { agent: 9 }]) {
			expect(Value.Check(Capabilities, sessionCapabilities(raw).capabilities)).toBe(true);
		}
	});

	it("returns a copy, so the shared defaults cannot be changed through a result", () => {
		const result = sessionCapabilities({});
		result.capabilities.message = false;
		expect(LEGACY_PI_CAPABILITIES.message).toBe(true);
	});
});

describe("approval schemas", () => {
	it("accepts a full request and every kind", () => {
		expect(Value.Check(ApprovalRequest, approval())).toBe(true);
		for (const kind of ["command", "file-change", "permission"]) expect(Value.Check(ApprovalRequest, approval({ kind }))).toBe(true);
	});

	it.each([
		["an empty id", { id: "" }],
		["an id over 128 characters", { id: "i".repeat(129) }],
		["an id with a newline", { id: "a\nb" }],
		["an unknown kind", { kind: "network" }],
		["a title over 120 characters", { title: "t".repeat(APPROVAL_TITLE_MAX_LENGTH + 1) }],
		["a detail over 2000 characters", { detail: "d".repeat(APPROVAL_DETAIL_MAX_LENGTH + 1) }],
		["no choices", { choices: [] }],
		["more than 4 choices", { choices: ["accept", "decline", "cancel", "acceptForSession", "accept"] }],
		["repeated choices", { choices: ["accept", "accept"] }],
		["an unknown choice", { choices: ["accept", "maybe"] }],
	])("refuses a request with %s", (_name, over) => {
		expect(Value.Check(ApprovalRequest, approval(over))).toBe(false);
	});

	it("decodes the POST /approval body and refuses anything else", () => {
		expect(decodeApprovalAnswer({ id: "req-1", decision: "acceptForSession" })).toEqual({ ok: true, value: { id: "req-1", decision: "acceptForSession" } });
		for (const bad of [{}, { id: "req-1" }, { id: "", decision: "accept" }, { id: "req-1", decision: "yes" }, { id: 1, decision: "accept" }, null]) {
			expect(decodeApprovalAnswer(bad).ok).toBe(false);
		}
		expect(Value.Check(ApprovalAnswer, { id: "i".repeat(128), decision: "cancel" })).toBe(true);
	});

	it("decodes the POST /approval response", () => {
		expect(decodeResponse(ApprovalAnswerResponse, { ...envelope, status: "answered" }).ok).toBe(true);
		expect(decodeResponse(ApprovalAnswerResponse, { ...envelope, status: "queued" }).ok).toBe(false);
	});

	it("decodes approval_request and approval_resolved events", () => {
		const request = { seq: 7, at: 2, type: "approval_request", ...approval() };
		const resolved = { seq: 8, at: 3, type: "approval_resolved", id: "req-1", decision: "decline" };
		expect(decodeEvent(request)).toEqual({ kind: "known", event: request });
		expect(decodeEvent(resolved)).toEqual({ kind: "known", event: resolved });
		expect(decodeEvent({ ...request, choices: [] })).toEqual({ kind: "invalid" });
		expect(decodeEvent({ ...resolved, decision: "maybe" })).toEqual({ kind: "invalid" });
	});

	it("decodes a state with pending approvals and keeps them", () => {
		const snapshot = { ...state, agent: "codex", capabilities: all(true), approvals: [approval(), approval({ id: "req-2", kind: "file-change" })] };
		expect(decodeResponse(StateResponse, snapshot)).toEqual({ ok: true, value: snapshot });
		expect(boundApprovals(snapshot.approvals).map((a) => a.id)).toEqual(["req-1", "req-2"]);
	});

	it.each([null, 3, "x", {}, [null], [{ id: 5 }], [approval({ choices: "accept" })]])(
		"never makes the state undecodable for invalid approvals %j, and reads them through boundApprovals",
		(approvals) => {
			expect(decodeResponse(StateResponse, { ...state, approvals }).ok).toBe(true);
			expect(boundApprovals(approvals)).toEqual([]);
		},
	);
});

describe("boundApproval", () => {
	it("keeps a valid request as it is", () => {
		expect(boundApproval(approval())).toEqual(approval());
	});

	it.each([
		["not an object", "req"],
		["a missing id", { id: undefined }],
		["an empty id", { id: "" }],
		["a numeric id", { id: 3 }],
		["an id over 128 characters", { id: "i".repeat(129) }],
		["an id with a control character", { id: "a\u0007b" }],
		["an unknown kind", { kind: "network" }],
		["no choices", { choices: [] }],
		["choices that are not a list", { choices: "accept" }],
		["only unknown choices", { choices: ["maybe", 1] }],
	])("refuses a request with %s", (_name, over) => {
		expect(boundApproval(typeof over === "string" ? over : approval(over))).toBeNull();
	});

	it("drops unknown and repeated choices, keeping order", () => {
		expect(boundApproval(approval({ choices: ["decline", "maybe", "accept", "decline", null] }))?.choices).toEqual(["decline", "accept"]);
	});

	it("makes the title one trimmed line cut to 120 code points", () => {
		expect(boundApproval(approval({ title: "  Run\n\tthe   tests \u0000" }))?.title).toBe("Run the tests");
		expect(boundApproval(approval({ title: "😀".repeat(130) }))?.title).toBe("😀".repeat(APPROVAL_TITLE_MAX_LENGTH));
	});

	it("keeps newlines and tabs in the detail, drops other control characters, trims, and cuts to 2000 code points", () => {
		expect(boundApproval(approval({ detail: "\n  rm -rf build\r\n\techo done\u001b[31m  \n" }))?.detail).toBe("rm -rf build\n\techo done[31m");
		const long = boundApproval(approval({ detail: "😀".repeat(2100) }));
		expect(long?.detail).toBe("😀".repeat(APPROVAL_DETAIL_MAX_LENGTH));
	});

	it("marks a detail it cut with detailTruncated: true, and only then (additive, optional)", () => {
		const long = boundApproval(approval({ detail: "x".repeat(APPROVAL_DETAIL_MAX_LENGTH + 1) }));
		expect(long).toMatchObject({ detail: "x".repeat(APPROVAL_DETAIL_MAX_LENGTH), detailTruncated: true });
		const exact = boundApproval(approval({ detail: "x".repeat(APPROVAL_DETAIL_MAX_LENGTH) }));
		expect(exact).not.toHaveProperty("detailTruncated");
		expect(boundApproval(approval())).toEqual(approval());
		// A detail cut earlier (by the bridge's own source limit) stays marked; anything but true is ignored.
		expect(boundApproval(approval({ detailTruncated: true }))).toEqual({ ...approval(), detailTruncated: true });
		for (const value of [false, "true", 1, null]) expect(boundApproval(approval({ detailTruncated: value }))).toEqual(approval());
		expect(Value.Check(ApprovalRequest, long)).toBe(true);
		expect(Value.Check(ApprovalRequest, approval())).toBe(true);
		expect(Value.Check(ApprovalRequest, approval({ detailTruncated: false }))).toBe(false);
		const event = { seq: 9, at: 1, type: "approval_request", ...long };
		expect(decodeEvent(event)).toEqual({ kind: "known", event });
		expect(boundApprovals([long, approval({ id: "req-2" })]).map((a) => a.detailTruncated)).toEqual([true, undefined]);
	});

	it("reads a missing or non-text title or detail as empty", () => {
		expect(boundApproval(approval({ title: undefined, detail: 7 }))).toEqual(approval({ title: "", detail: "" }));
	});

	it("always yields a value the schema accepts", () => {
		const raw = approval({ title: "x".repeat(500), detail: "y\u0000".repeat(3000), choices: ["cancel", "accept", "decline", "acceptForSession", "accept"] });
		expect(Value.Check(ApprovalRequest, boundApproval(raw))).toBe(true);
	});
});

describe("boundApprovals", () => {
	it.each([undefined, null, 0, "x", {}, { 0: approval() }])("is empty for %j", (raw) => {
		expect(boundApprovals(raw)).toEqual([]);
	});

	it("drops invalid entries and repeated ids, keeping the first and the order", () => {
		const result = boundApprovals([approval({ id: "b" }), null, approval({ id: "bad", kind: "x" }), approval({ id: "a" }), approval({ id: "b", title: "second" })]);
		expect(result.map((a) => a.id)).toEqual(["b", "a"]);
		expect(result[0]?.title).toBe("Run pnpm test");
	});

	it("keeps at most 8, counting only valid entries", () => {
		const many = [null, approval({ kind: "x" }), ...Array.from({ length: 12 }, (_, i) => approval({ id: `r${i}` }))];
		const result = boundApprovals(many);
		expect(result).toHaveLength(APPROVALS_MAX_ITEMS);
		expect(result.map((a) => a.id)).toEqual(["r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7"]);
		for (const item of result) expect(Value.Check(ApprovalRequest, item)).toBe(true);
	});
});
