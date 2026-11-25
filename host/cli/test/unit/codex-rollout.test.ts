import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRolloutReader } from "../../src/core/codex-rollout.ts";

// Invented content in the shape of Codex's rollout JSONL (RolloutLine {timestamp, type, payload} with ResponseItem
// payloads), including injected context, duplicate event_msg lines, unknown types and broken lines.
const lines = readFileSync(join(import.meta.dirname, "fixtures/codex-rollout.jsonl"), "utf8").split("\n").filter(Boolean);

describe("Codex rollout lines", () => {
	it("keeps the user prompt, tool calls and results, the assistant reply with its model, and the interrupt, in order", () => {
		const reader = createRolloutReader();
		expect(lines.flatMap((line) => reader.parse(line))).toEqual([
			{ type: "user", id: "rollout-1", text: "¿Cuántos zorros hay?", images: 1 },
			{ type: "tool_use", id: "call_rg1", toolName: "shell" },
			{ type: "tool_result", id: "rollout-2", toolUseId: "call_rg1", text: "3\n", isError: false },
			{ type: "tool_use", id: "call_patch1", toolName: "apply_patch" },
			{ type: "tool_result", id: "rollout-3", toolUseId: "call_patch1", text: "Done!", isError: false },
			{ type: "tool_use", id: "call_bad", toolName: "shell" },
			{ type: "tool_result", id: "rollout-4", toolUseId: "call_bad", text: "boom", isError: true },
			{ type: "assistant", id: "msg_a1", text: "Hay tres zorros.", toolCalls: 0, model: "gpt-invented-5" },
			{ type: "interrupt" },
		]);
	});

	it("drops injected context, developer messages, reasoning, duplicates and unknown or broken lines", () => {
		const reader = createRolloutReader();
		for (const line of [
			"", "{", "null", "42", "\"text\"", "[]",
			JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<user_instructions>x</user_instructions>" }] } }),
			JSON.stringify({ type: "response_item", payload: { type: "message", role: "system", content: [{ type: "input_text", text: "sys" }] } }),
			JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "  " }] } }),
			JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "shell", call_id: "x".repeat(200) } }),
			JSON.stringify({ type: "response_item", payload: { type: "function_call_output", output: "no call id" } }),
			JSON.stringify({ type: "response_item", payload: "not an object" }),
			JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "dup" } }),
			JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "dup" } }),
			JSON.stringify({ type: "turn_context", payload: { model: 7 } }),
		]) expect(reader.parse(line)).toEqual([]);
	});

	it("reads the older rollout shape, where the response item is the line itself", () => {
		const reader = createRolloutReader();
		expect([
			JSON.stringify({ id: "0199", timestamp: "2025-01-01T00:00:00Z", instructions: null }),
			JSON.stringify({ type: "message", role: "user", content: [{ type: "input_text", text: "hola" }] }),
			JSON.stringify({ type: "local_shell_call", call_id: "c1", status: "completed", action: { type: "exec", command: ["ls"] } }),
			JSON.stringify({ type: "function_call_output", call_id: "c1", output: { content: "a b", success: false } }),
			JSON.stringify({ type: "message", role: "assistant", content: [{ type: "output_text", text: "listo" }] }),
		].flatMap((line) => reader.parse(line))).toEqual([
			{ type: "user", id: "rollout-1", text: "hola", images: 0 },
			{ type: "tool_use", id: "c1", toolName: "shell" },
			{ type: "tool_result", id: "rollout-2", toolUseId: "c1", text: "a b", isError: true },
			{ type: "assistant", id: "rollout-3", text: "listo", toolCalls: 0 },
		]);
	});

	it("treats Codex's <turn_aborted> marker as an interrupt and never throws on odd values", () => {
		const reader = createRolloutReader();
		expect(reader.parse(JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<turn_aborted>\nThe user interrupted.\n</turn_aborted>" }] } }))).toEqual([{ type: "interrupt" }]);
		const odd = { type: "response_item", payload: { type: "message", role: "user", content: [null, 1, { type: "input_text", text: 5 }, { type: "input_text", text: "ok" }] } };
		expect(reader.parse(JSON.stringify(odd))).toEqual([{ type: "user", id: "rollout-1", text: "ok", images: 0 }]);
		expect(reader.parse(JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "c", output: { content: [{ type: "output_text", text: "x" }, { type: "input_image" }] } } }))).toEqual([{ type: "tool_result", id: "rollout-2", toolUseId: "c", text: "x", isError: false }]);
	});
});
