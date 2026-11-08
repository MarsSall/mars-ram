import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { latestRequestGate } from "../src/core/latest-request";

describe("latest request gate", () => {
	it("only the newest started request may publish, whatever order they finish in", () => {
		const gate = latestRequestGate();
		const a = gate.begin();
		const b = gate.begin();
		expect(gate.isLatest(b)).toBe(true);
		expect(gate.isLatest(a)).toBe(false);
		const c = gate.begin();
		expect(gate.isLatest(b)).toBe(false);
		expect(gate.isLatest(c)).toBe(true);
	});
	it("Inicio publishes a sessions load only when it is the newest one", () => {
		const source = readFileSync(join(import.meta.dirname, "../src/ui/use-sessions.ts"), "utf8");
		expect(source).toMatch(/latestRequestGate\(\)/);
		expect(source).toMatch(/isLatest\(/);
	});
});
