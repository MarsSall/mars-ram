import { describe, expect, it } from "vitest";
import { inferActivity } from "../../src/core/activity.ts";
import { readActivity } from "../../src/adapters/activity-registry.ts";

describe("activity inference", () => {
	it.each(["read", "grep", "find", "ls"])("infers exploring from %s", (name) => {
		expect(inferActivity("checking", name, {})).toBe("exploring");
	});
	it.each(["edit", "write"])("infers implementing from %s", (name) => {
		expect(inferActivity(null, name, {})).toBe("implementing");
	});
	it.each(["pnpm test", "pnpm typecheck", "npm run build", "npx vitest run", "tsc --noEmit", "cargo test", "pytest -q"])("infers checking from %s", (command) => {
		expect(inferActivity(null, "bash", { command })).toBe("checking");
	});
	it.each(["git status", "echo testing", "cat latest.txt", "echo build", "ls test"])("does not infer checking from %s", (command) => {
		expect(inferActivity("implementing", "bash", { command })).toBe("implementing");
	});
	it.each([null, {}, { command: 42 }])("tolerates missing/malformed bash args %s", (args) => {
		expect(inferActivity(null, "bash", args)).toBeNull();
	});
	it("preserves previous activity for unknown tools", () => {
		expect(inferActivity("researching", "gentle_odd_phase", {})).toBe("researching");
	});
});

describe("untrusted phase registry adapter", () => {
	it("uses the session manager id unchanged and preserves the registry receiver", () => {
		const registry = { phase: "deciding", get(id: string) { return id === "session-id" ? this.phase : undefined; } };
		expect(readActivity("session-id", { [Symbol.for("gentle-pi.odd-phase-registry")]: registry })).toBe("deciding");
	});
	it.each([undefined, null, {}, { get: 1 }, { get: () => undefined }, { get: () => "Checking" }, { get: () => "x".repeat(33) }, { get: () => "checking\n" }, { get: () => { throw Error("bad"); } }])("ignores absent/malformed registry %s", (registry) => {
		expect(readActivity("s", { [Symbol.for("gentle-pi.odd-phase-registry")]: registry })).toBeNull();
	});
	it("catches hostile property access", () => {
		expect(readActivity("s", new Proxy({}, { get() { throw Error("bad"); } }))).toBeNull();
		const registry = new Proxy({}, { get() { throw Error("bad"); } });
		expect(readActivity("s", { [Symbol.for("gentle-pi.odd-phase-registry")]: registry })).toBeNull();
	});
});
