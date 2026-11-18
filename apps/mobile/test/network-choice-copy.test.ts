import { describe, expect, it } from "vitest";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

describe("network choice copy", () => {
	it("names each network on equal footing, with no recommendation or development note", () => {
		for (const t of [en, es]) {
			expect(t.wizard.choices).toEqual({ tailscale: { title: "Tailscale" }, zerotier: { title: "ZeroTier" } });
		}
	});
});
