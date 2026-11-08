import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

// The app sends no notifications yet; Settings must not claim it does.
describe("notification promise", () => {
	it("Settings shows no notifications setting", () => {
		const source = readFileSync(join(import.meta.dirname, "../src/app/(tabs)/settings.tsx"), "utf8");
		expect(source).not.toMatch(/notifications|backgroundNotices/);
	});
	it("no translation offers background notices", () => {
		for (const t of [en, es]) {
			expect(t.settings).not.toHaveProperty("notifications");
			expect(t.settings).not.toHaveProperty("backgroundNotices");
		}
	});
});
