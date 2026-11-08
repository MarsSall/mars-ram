import { describe, expect, it } from "vitest";
import { RunOutcome } from "../../src/core/run-outcome.ts";

const toolError = { role: "toolResult", isError: true };

describe("Pi run outcome", () => {
	it.each([
		["stop", "completed"], ["end_turn", "completed"], ["error", "failed"],
		["aborted", "aborted"], ["length", undefined], ["toolUse", undefined],
		["pending", undefined], ["deferred", undefined], ["future", undefined], [undefined, undefined],
	])("maps final assistant stopReason %s to %s", (stopReason, expected) => {
		const run = new RunOutcome();
		run.ended([{ role: "assistant", stopReason }, toolError]);
		expect(run.settled(false)).toBe(expected);
	});

	it("uses the last assistant, never an individual tool error or an earlier failed attempt", () => {
		const run = new RunOutcome();
		run.ended([{ role: "assistant", stopReason: "error" }, toolError, { role: "assistant", stopReason: "stop" }]);
		expect(run.settled(false)).toBe("completed");
	});

	it("lets the settled abort flag override an earlier successful message", () => {
		const run = new RunOutcome();
		run.ended([{ role: "assistant", stopReason: "stop" }]);
		expect(run.settled(true)).toBe("aborted");
	});

	it("replaces the preceding agent end after automatic retry or continuation", () => {
		const run = new RunOutcome();
		run.ended([{ role: "assistant", stopReason: "error" }]);
		run.ended([{ role: "assistant", stopReason: "stop" }]);
		expect(run.settled(false)).toBe("completed");
	});

	it("does not reuse evidence after settle, a new run, or session replacement", () => {
		const run = new RunOutcome();
		expect(run.settled(false)).toBeUndefined();
		run.ended([{ role: "assistant", stopReason: "stop" }]);
		run.reset();
		expect(run.settled(false)).toBeUndefined();
		run.ended([toolError]);
		expect(run.settled(false)).toBeUndefined();
		run.ended([{ role: "assistant", stopReason: "error" }]);
		expect(run.settled(false)).toBe("failed");
		expect(run.settled(false)).toBeUndefined();
	});
});
