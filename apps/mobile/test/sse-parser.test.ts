import { describe, expect, it } from "vitest";
import { SseParser, type SseMessage } from "../src/adapters/sse-parser";

function parse(...chunks: string[]): SseMessage[] {
	const seen: SseMessage[] = [];
	const parser = new SseParser((m) => seen.push(m));
	for (const chunk of chunks) parser.push(chunk);
	return seen;
}

describe("SseParser", () => {
	it("reads the replay header and numbered events", () => {
		expect(parse('event: replay\ndata: {"since":3}\n\nid: 4\ndata: {"seq":4}\n\n')).toEqual([
			{ event: "replay", data: '{"since":3}', id: null },
			{ event: "message", data: '{"seq":4}', id: "4" },
		]);
	});

	it("waits for the end of a message split across chunks", () => {
		expect(parse("id: 5\nda", 'ta: {"seq"', ":5}\n", "\n")).toEqual([{ event: "message", data: '{"seq":5}', id: "5" }]);
		expect(parse('data: {"seq":6}\n')).toEqual([]);
	});

	it("ignores heartbeat comments", () => {
		expect(parse(": ping\n\n: ping\n\n")).toEqual([]);
	});

	it("accepts CRLF line endings and joins several data lines", () => {
		expect(parse("data: one\r\ndata: two\r\n\r\n")).toEqual([{ event: "message", data: "one\ntwo", id: null }]);
	});

	it("keeps the text after the first colon and one leading space", () => {
		expect(parse("data:  a: b\n\n")).toEqual([{ event: "message", data: " a: b", id: null }]);
	});
});
