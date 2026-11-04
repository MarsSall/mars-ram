import { describe, expect, it } from "vitest";
import { withAttachedFiles, splitAttachedFiles } from "@workspace/protocol";
import { summarize } from "../../src/core/message-summary.ts";

const long = "x".repeat(2000);

describe("summarize", () => {
	it("round trips attachment-only camera history, with native images and long user text", () => {
		const name = "20261023-145846-ll1uf5-805f9232-03b2-405f-8a85-0d4b22a8821d.jpeg";
		for (const path of [`/home/me/.mars-ram/uploads/${name}`, `C:\\Users\\alex\\.mars-ram\\uploads\\${name}`]) {
			for (const text of ["", long]) {
				const built = withAttachedFiles(text, [path]);
				for (const content of [built, [{ type: "text", text: built }, { type: "image", data: "…", mimeType: "image/jpeg" }]]) {
					const history = summarize({ role: "user", content });
					expect(history.text).toBe(built);
					expect(splitAttachedFiles(history.text)).toEqual({ text, files: [name] });
				}
			}
		}
	});
	it("keeps the full text of the user's and the agent's messages, so the phone shows them whole", () => {
		expect(summarize({ role: "user", content: long }).text).toBe(long);
		expect(summarize({ role: "assistant", content: [{ type: "text", text: long }], stopReason: "stop" })).toEqual({
			role: "assistant",
			text: long,
			images: 0,
			toolCalls: 0,
			stopReason: "stop",
		});
	});

	it("shortens tool output to 500 characters", () => {
		expect(summarize({ role: "toolResult", content: [{ type: "text", text: long }] }).text).toBe(`${"x".repeat(500)}…`);
	});

	it("counts images and tool calls and joins the text parts", () => {
		const message = {
			role: "assistant",
			content: [
				{ type: "text", text: "Looking " },
				{ type: "toolCall", id: "1" },
				{ type: "text", text: "now" },
				{ type: "image", data: "…" },
			],
		};
		expect(summarize(message)).toEqual({ role: "assistant", text: "Looking now", images: 1, toolCalls: 1 });
	});

	it("names a message without a role as unknown", () => {
		expect(summarize({ content: "hi" }).role).toBe("unknown");
	});
});
