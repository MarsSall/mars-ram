import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTranscriptLine } from "../../src/core/claude-transcript.ts";

// Invented content in Claude Code's transcript shape (user/assistant lines with content parts, plus other line types).
const lines = readFileSync(join(import.meta.dirname, "fixtures/claude-transcript.jsonl"), "utf8").split("\n").filter(Boolean);

describe("Claude Code transcript lines", () => {
	it("keeps user and assistant text, tool calls and results, and the interrupt marker, in order", () => {
		expect(lines.flatMap(parseTranscriptLine)).toEqual([
			{ type: "user", id: "u-1", text: "Count the lemons in basket.txt", images: 0 },
			{ type: "assistant", id: "a-2", text: "I will look at the basket.", toolCalls: 0, model: "claude-invented-1" },
			{ type: "assistant", id: "a-3", text: "", toolCalls: 1, model: "claude-invented-1" },
			{ type: "tool_use", id: "toolu_inv1", toolName: "Read" },
			{ type: "tool_result", id: "u-2", toolUseId: "toolu_inv1", text: "lemon\nlemon\nlime", isError: false },
			{ type: "assistant", id: "a-4", text: "There are 2 lemons and 1 lime.", toolCalls: 0, model: "claude-invented-1" },
			{ type: "user", id: "u-3", text: "Now this picture", images: 1 },
			{ type: "assistant", id: "a-5", text: "", toolCalls: 1, model: "claude-invented-1" },
			{ type: "tool_use", id: "toolu_inv2", toolName: "Bash" },
			{ type: "tool_result", id: "u-4", toolUseId: "toolu_inv2", text: "ls: cannot access", isError: true },
			{ type: "interrupt" },
		]);
	});

	it("never passes on thinking text", () => {
		expect(JSON.stringify(lines.flatMap(parseTranscriptLine))).not.toContain("secret pondering");
	});

	it.each([
		["meta lines", '{"type":"user","uuid":"m","isMeta":true,"message":{"role":"user","content":"hidden"}}'],
		["subagent lines", '{"type":"assistant","uuid":"s","isSidechain":true,"message":{"content":[{"type":"text","text":"x"}]}}'],
		["slash-command wrappers", '{"type":"user","uuid":"c","message":{"content":"<local-command-stdout>done</local-command-stdout>"}}'],
		["other line types", '{"type":"cost-state","uuid":"k","message":{"content":"x"}}'],
		["lines without an id", '{"type":"user","message":{"content":"x"}}'],
		["an over-long id", JSON.stringify({ type: "user", uuid: "u".repeat(129), message: { content: "x" } })],
		["empty user text", '{"type":"user","uuid":"e","message":{"content":"   "}}'],
		["a message that is not an object", '{"type":"user","uuid":"e","message":"x"}'],
		["invalid JSON", "{not json"],
		["a JSON array", "[1,2]"],
		["null", "null"],
	])("drops %s", (_name, line) => {
		expect(parseTranscriptLine(line)).toEqual([]);
	});

	it("drops tool calls without a usable id or name, and a synthetic model name", () => {
		expect(parseTranscriptLine(JSON.stringify({ type: "assistant", uuid: "a", message: { model: "<synthetic>", content: [{ type: "text", text: "hi" }, { type: "tool_use", name: "Read" }, { type: "tool_use", id: 7, name: "Read" }] } })))
			.toEqual([{ type: "assistant", id: "a", text: "hi", toolCalls: 0 }]);
	});
});
