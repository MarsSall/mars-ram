import { describe, expect, it } from "vitest";
import { publishesSession } from "../../src/core/publish-policy.ts";

describe("which Pi sessions the bridge publishes", () => {
	it("publishes interactive terminal sessions", () => {
		expect(publishesSession("tui", {})).toBe(true);
	});
	it("publishes when an older Pi does not report its mode", () => {
		expect(publishesSession(undefined, {})).toBe(true);
	});
	it.each(["rpc", "json", "print"])("hides %s sessions, such as background subagents", (mode) => {
		expect(publishesSession(mode, {})).toBe(false);
	});
	it("publishes headless sessions only when PI_BRIDGE_HEADLESS is exactly 1", () => {
		expect(publishesSession("rpc", { PI_BRIDGE_HEADLESS: "1" })).toBe(true);
		expect(publishesSession("rpc", { PI_BRIDGE_HEADLESS: "true" })).toBe(false);
		expect(publishesSession("rpc", { PI_BRIDGE_HEADLESS: "" })).toBe(false);
	});
});
