import { describe, expect, it } from "vitest";
import {
	decodeResponse,
	PROTOCOL_VERSION,
	StateResponse,
	TERMINAL_TEXT_MAX_LENGTH,
	TerminalInputRequest,
	TerminalFocusResponse,
	TerminalInputResponse,
	TerminalScreenResponse,
} from "../src/index.ts";

const envelope = { protocolVersion: PROTOCOL_VERSION, bridgeInstanceId: "inst-1", sessionId: "sess-1" };
const state = {
	...envelope,
	idle: true,
	pendingMessages: false,
	pendingPrompt: null,
	model: null,
	lastSeq: 0,
	oldestSeq: null,
	lastActivityAt: null,
};
const check = (schema: Parameters<typeof decodeResponse>[0], data: unknown) => decodeResponse(schema, data).ok;

describe("state terminal flag", () => {
	it("accepts state with and without the terminal flag, so 1.0 bridges still decode", () => {
		expect(check(StateResponse, state)).toBe(true);
		expect(check(StateResponse, { ...state, terminal: true })).toBe(true);
		expect(check(StateResponse, { ...state, terminal: false })).toBe(true);
	});

	it("rejects a terminal flag that is not a boolean", () => {
		expect(check(StateResponse, { ...state, terminal: "yes" })).toBe(false);
	});
});

describe("TerminalScreenResponse", () => {
	it("accepts the pane's visible screen with its colors", () => {
		expect(check(TerminalScreenResponse, { ...envelope, screen: "\u001b[32mok\u001b[0m\nline 2" })).toBe(true);
	});

	it("requires the envelope", () => {
		expect(check(TerminalScreenResponse, { screen: "x" })).toBe(false);
	});
});

describe("TerminalInputRequest", () => {
	it("accepts text to type, with or without Enter after it", () => {
		expect(check(TerminalInputRequest, { kind: "text", text: "yes, go on", enter: true })).toBe(true);
		expect(check(TerminalInputRequest, { kind: "text", text: "line 1\nline 2", enter: false })).toBe(true);
	});

	it.each([
		["empty text", { kind: "text", text: "", enter: true }],
		["text over the limit", { kind: "text", text: "x".repeat(TERMINAL_TEXT_MAX_LENGTH + 1), enter: true }],
		["text without the enter choice", { kind: "text", text: "hi" }],
	])("rejects %s", (_name, body) => {
		expect(check(TerminalInputRequest, body)).toBe(false);
	});

	it("accepts text exactly at the limit", () => {
		expect(check(TerminalInputRequest, { kind: "text", text: "x".repeat(TERMINAL_TEXT_MAX_LENGTH), enter: false })).toBe(true);
	});

	it("accepts the toolbar and D-pad keys", () => {
		const keys = ["enter", "backspace", "esc", "tab", "up", "down", "left", "right", "ctrl+c", "ctrl+z"];
		expect(check(TerminalInputRequest, { kind: "keys", keys })).toBe(true);
	});

	it.each([
		["no keys", []],
		["an unknown key name", ["f13"]],
		["a key name with a command in it", ["enter; rm -rf ~"]],
		["ctrl with something other than one lowercase letter", ["ctrl+alt+del"]],
		["ctrl with an uppercase letter", ["ctrl+C"]],
		["more than 32 keys", Array.from({ length: 33 }, () => "up")],
	])("rejects %s", (_name, keys) => {
		expect(check(TerminalInputRequest, { kind: "keys", keys })).toBe(false);
	});

	it("rejects an unknown input kind", () => {
		expect(check(TerminalInputRequest, { kind: "command", command: "ls" })).toBe(false);
	});
});

describe("TerminalFocusResponse", () => {
	it("requires the envelope and a confirmed focused status", () => {
		expect(check(TerminalFocusResponse, { ...envelope, status: "focused" })).toBe(true);
		expect(check(TerminalFocusResponse, { status: "focused" })).toBe(false);
		expect(check(TerminalFocusResponse, { ...envelope, status: "sent" })).toBe(false);
	});
});

describe("TerminalInputResponse", () => {
	it("acknowledges input that was handed to the pane", () => {
		expect(check(TerminalInputResponse, { ...envelope, status: "sent" })).toBe(true);
		expect(check(TerminalInputResponse, { ...envelope, status: "done" })).toBe(false);
	});
});
