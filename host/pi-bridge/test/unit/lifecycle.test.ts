import { describe, expect, it } from "vitest";
import { stopInstance } from "../../src/adapters/lifecycle.ts";

describe("stopInstance", () => {
	it("closes the server even when removing the registry entry fails", async () => {
		let closed = 0;
		const server = { close: async () => void closed++ };
		await expect(
			stopInstance({ entryPath: "/x", server }, () => {
				throw new Error("EISDIR");
			}),
		).rejects.toThrow("EISDIR");
		expect(closed).toBe(1);
	});

	it("removes the entry and closes the server", async () => {
		const removed: string[] = [];
		let closed = 0;
		await stopInstance({ entryPath: "/x", server: { close: async () => void closed++ } }, (p) => removed.push(p));
		expect(removed).toEqual(["/x"]);
		expect(closed).toBe(1);
	});
});
