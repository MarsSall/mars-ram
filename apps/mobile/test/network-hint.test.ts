import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { HostNetwork } from "../src/core/host-catalog";
import { activePhoneVpn, type PhoneNetworkState } from "../src/core/phone-network";
import { unreachableHint } from "../src/core/network-hint";
import { networkHintText } from "../src/ui/network-hint";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

const base = { tailscaleInstalled: true, privateDnsActive: null, zerotierInstalled: true };
const phones: Record<"none" | "tailscale" | "zerotier" | "unknown", PhoneNetworkState | null> = {
	none: { ...base, tailscaleOn: false, vpnOn: false },
	tailscale: { ...base, tailscaleOn: true, vpnOn: true },
	zerotier: { ...base, tailscaleOn: false, vpnOn: true },
	unknown: null,
};

describe("phone VPN", () => {
	it("names the one active VPN, or none", () => {
		expect(activePhoneVpn(phones.none)).toBe("none");
		expect(activePhoneVpn(phones.tailscale)).toBe("tailscale");
		expect(activePhoneVpn(phones.zerotier)).toBe("zerotier");
	});
	it("is unknown when the phone could not tell", () => {
		expect(activePhoneVpn(null)).toBeNull();
		// The non-blocking fallback always claims Tailscale and gives no VPN fact.
		expect(activePhoneVpn({ tailscaleInstalled: true, tailscaleOn: true, privateDnsActive: null })).toBeNull();
		// Another VPN without ZeroTier installed is not ZeroTier.
		expect(activePhoneVpn({ ...base, zerotierInstalled: false, tailscaleOn: false, vpnOn: true })).toBeNull();
		expect(activePhoneVpn({ tailscaleInstalled: true, privateDnsActive: null, tailscaleOn: false, vpnOn: true })).toBeNull();
	});
});

describe("unreachable computer hint", () => {
	const networks: HostNetwork[] = ["tailscale", "zerotier"];
	it("never hints for a reachable computer", () => {
		for (const network of networks) for (const phone of Object.values(phones)) expect(unreachableHint(network, phone, true)).toBeNull();
	});
	it("asks to switch when the phone runs the other VPN", () => {
		expect(unreachableHint("tailscale", phones.zerotier, false)).toEqual({ kind: "switch", network: "tailscale", active: "zerotier" });
		expect(unreachableHint("zerotier", phones.tailscale, false)).toEqual({ kind: "switch", network: "zerotier", active: "tailscale" });
	});
	it("asks to turn on the computer's network when no VPN is on", () => {
		expect(unreachableHint("tailscale", phones.none, false)).toEqual({ kind: "turn-on", network: "tailscale" });
		expect(unreachableHint("zerotier", phones.none, false)).toEqual({ kind: "turn-on", network: "zerotier" });
	});
	it("keeps today's message on the computer's own network or when the phone could not tell", () => {
		expect(unreachableHint("tailscale", phones.tailscale, false)).toBeNull();
		expect(unreachableHint("zerotier", phones.zerotier, false)).toBeNull();
		for (const network of networks) expect(unreachableHint(network, phones.unknown, false)).toBeNull();
	});
});

describe("hint copy", () => {
	it("says the networks and the fix in Spanish (voseo) and English", () => {
		expect(networkHintText(es, { kind: "switch", network: "tailscale", active: "zerotier" })).toEqual({
			short: "Prendé Tailscale", full: "Vinculada por Tailscale; en el teléfono está prendido ZeroTier. Prendé Tailscale.",
		});
		expect(networkHintText(es, { kind: "switch", network: "zerotier", active: "tailscale" })).toEqual({
			short: "Prendé ZeroTier", full: "Vinculada por ZeroTier; en el teléfono está prendido Tailscale. Prendé ZeroTier.",
		});
		expect(networkHintText(en, { kind: "switch", network: "tailscale", active: "zerotier" })).toEqual({
			short: "Turn on Tailscale", full: "Paired over Tailscale; ZeroTier is on in this phone. Turn on Tailscale.",
		});
		expect(networkHintText(es, { kind: "turn-on", network: "zerotier" })).toEqual({
			short: "Prendé ZeroTier", full: "Prendé ZeroTier en el teléfono para llegar a esta computadora.",
		});
		expect(networkHintText(en, { kind: "turn-on", network: "tailscale" })).toEqual({
			short: "Turn on Tailscale", full: "Turn on Tailscale in this phone to reach this computer.",
		});
	});
	it("keeps the existing not-responding copy unchanged", () => {
		expect(es.home.computerStatus.unreachable).toBe("no responde");
		expect(es.sessions.unreachable).toBe("Esta computadora no responde.");
		expect(es.computers.unreachable).toBe("No responde");
	});
	it("is wired into Home and the Computers list", () => {
		for (const file of ["../src/app/(tabs)/computers.tsx", "../src/app/(tabs)/index.tsx"]) {
			const source = readFileSync(new URL(file, import.meta.url), "utf8");
			expect(source).toContain("unreachableHint(");
			expect(source).toContain("networkHintText(");
		}
	});
});
