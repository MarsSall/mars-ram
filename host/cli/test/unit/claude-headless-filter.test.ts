// Claude Code started through the Agent SDK or `claude -p` (e.g. Gentle Shell / Pi using Claude as its model engine)
// reads the same ~/.claude/settings.json and runs the hooks, but it is not a session the user opened in a terminal.
import { describe, expect, it } from "vitest";
import { isInteractiveClaude } from "../../src/hook-command.ts";

describe("which Claude Code processes get a bridge", () => {
	it("bridges the interactive terminal CLI and a Claude Code that does not say", () => {
		expect(isInteractiveClaude({ CLAUDE_CODE_ENTRYPOINT: "cli" })).toBe(true);
		expect(isInteractiveClaude({})).toBe(true);
	});

	it("ignores Agent SDK and print-mode processes", () => {
		for (const entrypoint of ["sdk-ts", "sdk-py", "sdk-cli", "claude-vscode-sdk", "anything-else"]) {
			expect(isInteractiveClaude({ CLAUDE_CODE_ENTRYPOINT: entrypoint })).toBe(false);
		}
	});
});
