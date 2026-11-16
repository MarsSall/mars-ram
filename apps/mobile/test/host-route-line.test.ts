import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";
import { hostRouteLine } from "../src/ui/host-route-line";

const base = { name: "devbox", user: "mars" };

describe("host route line", () => {
	it("tells apart the same computer paired over ZeroTier and over Tailscale", () => {
		const zerotier = hostRouteLine(es, { ...base, network: "zerotier", address: "10.147.17.5" });
		const tailscale = hostRouteLine(es, { ...base, network: "tailscale", address: "100.64.0.5", dnsName: "devbox.tail1234.ts.net" });
		expect(zerotier).toBe("ZeroTier · mars@10.147.17.5");
		expect(tailscale).toBe("Tailscale · mars@devbox.tail1234.ts.net");
		expect(zerotier).not.toBe(tailscale);
	});
	it("treats a computer saved before networks existed as Tailscale and falls back to the address", () => {
		expect(hostRouteLine(en, { ...base, address: "100.64.0.5" })).toBe("Tailscale · mars@100.64.0.5");
	});
	it("is shown under each computer row and in the opener step header", () => {
		const source = readFileSync(new URL("../src/app/open-terminal/index.tsx", import.meta.url), "utf8");
		expect(source.match(/hostRouteLine\(/g)?.length).toBeGreaterThanOrEqual(2);
	});
});
