import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { zeroTierAddresses, zeroTierInterfaces, zeroTierNetworks } from "../../src/adapters/zerotier.ts";
import { networkFromAnswer, resolvePairingTarget, type PairingNetworkPorts } from "../../src/core/pairing-network.ts";

const v4 = (address: string, internal = false): NetworkInterfaceInfo => ({ address, family: "IPv4", internal, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: `${address}/24` });
const v6 = (address: string): NetworkInterfaceInfo => ({ address, family: "IPv6", internal: false, netmask: "ffff:ffff:ffff:ffff::", mac: "00:00:00:00:00:00", cidr: `${address}/64`, scopeid: 0 });

describe("zeroTierAddresses", () => {
	it("reads IPv4 addresses of zt interfaces on Linux, skipping other interfaces, IPv6 and link-local", () => {
		const interfaces = {
			lo: [v4("127.0.0.1", true)],
			eth0: [v4("192.168.1.20")],
			tailscale0: [v4("100.64.0.10")],
			ztabcdef12: [v4("10.147.17.5"), v6("fd80::5")],
			zt3jnkd: [v4("169.254.3.4")],
		};
		expect(zeroTierAddresses(() => interfaces, "linux")).toEqual(["10.147.17.5"]);
	});

	it("reads feth interfaces on macOS", () => {
		const interfaces = { en0: [v4("192.168.1.20")], feth2779: [v4("10.147.17.7")], feth7779: [v6("fe80::1")], utun4: [v4("100.64.0.10")] };
		expect(zeroTierAddresses(() => interfaces, "darwin")).toEqual(["10.147.17.7"]);
	});

	it("reads ZeroTier adapters by name on Windows", () => {
		const interfaces = { Ethernet: [v4("192.168.1.20")], "ZeroTier One [8056c2e21c000001]": [v4("172.24.0.9")], Tailscale: [v4("100.64.0.10")] };
		expect(zeroTierAddresses(() => interfaces, "win32")).toEqual(["172.24.0.9"]);
	});

	it("does not take a feth interface for ZeroTier on Linux, nor a zt one on Windows", () => {
		expect(zeroTierAddresses(() => ({ feth0: [v4("10.1.1.1")] }), "linux")).toEqual([]);
		expect(zeroTierAddresses(() => ({ zt0: [v4("10.1.1.1")] }), "win32")).toEqual([]);
	});

	it("lists each address once", () => {
		expect(zeroTierAddresses(() => ({ zt0: [v4("10.147.17.5"), v4("10.147.17.5")], zt1: [v4("10.144.0.2")] }), "linux")).toEqual(["10.147.17.5", "10.144.0.2"]);
	});
});

describe("zeroTierInterfaces", () => {
	it("pairs each ZeroTier IPv4 address with its interface name, for the firewall hint", () => {
		const interfaces = { eth0: [v4("192.168.1.20")], ztexample0: [v4("10.147.20.49"), v6("fd80::5")], zt3jnkd: [v4("169.254.3.4")], zt1: [v4("10.144.0.2")] };
		expect(zeroTierInterfaces(() => interfaces, "linux")).toEqual([{ name: "ztexample0", address: "10.147.20.49" }, { name: "zt1", address: "10.144.0.2" }]);
	});
});

describe("zeroTierNetworks", () => {
	it("gives each ZeroTier address with its subnet prefix, for checking where Siempre atento registrations come from", () => {
		const interfaces = { eth0: [v4("192.168.1.20")], ztexample0: [v4("10.147.20.49")], zt1: [{ ...v4("10.144.0.2"), netmask: "255.255.0.0" }] };
		expect(zeroTierNetworks(() => interfaces, "linux")).toEqual([{ address: "10.147.20.49", prefix: 24 }, { address: "10.144.0.2", prefix: 16 }]);
	});
});

describe("resolvePairingTarget", () => {
	const ports = (zerotier: string[], tailscale: ReturnType<PairingNetworkPorts["tailscale"]> = { ok: true, address: "100.64.0.10", dnsName: "devbox.example-tailnet.ts.net" }) => {
		const calls: string[] = [];
		const value: PairingNetworkPorts = {
			tailscale: () => (calls.push("tailscale"), tailscale),
			zeroTierAddresses: () => (calls.push("zerotier"), zerotier),
		};
		return { value, calls };
	};

	it("pairs over Tailscale when asked, with its MagicDNS name, without looking at ZeroTier", () => {
		const { value, calls } = ports(["10.147.17.5"]);
		expect(resolvePairingTarget({ network: "tailscale" }, value)).toEqual({ ok: true, network: "tailscale", address: "100.64.0.10", dnsName: "devbox.example-tailnet.ts.net" });
		expect(calls).toEqual(["tailscale"]);
	});

	it("keeps the Tailscale failure message unchanged when Tailscale is asked for", () => {
		const { value } = ports(["10.147.17.5"], { ok: false, message: "Tailscale is not connected on this computer. Connect it and try again." });
		expect(resolvePairingTarget({ network: "tailscale" }, value)).toEqual({ ok: false, message: "Tailscale is not connected on this computer. Connect it and try again." });
	});

	it("finds Tailscale on its own when it is the only network connected", () => {
		const { value } = ports([]);
		expect(resolvePairingTarget({}, value)).toEqual({ ok: true, network: "tailscale", address: "100.64.0.10", dnsName: "devbox.example-tailnet.ts.net" });
	});

	it("finds ZeroTier on its own when it is the only network connected", () => {
		const { value } = ports(["10.147.17.5"], { ok: false, message: "Tailscale is not connected on this computer. Connect it and try again." });
		expect(resolvePairingTarget({}, value)).toEqual({ ok: true, network: "zerotier", address: "10.147.17.5" });
	});

	it("asks for --address when only ZeroTier is connected with several addresses", () => {
		const { value } = ports(["10.147.17.5", "10.144.0.2"], { ok: false, message: "Tailscale is not connected on this computer. Connect it and try again." });
		expect(resolvePairingTarget({}, value)).toEqual({
			ok: false,
			message: "This computer has several ZeroTier addresses: 10.147.17.5, 10.144.0.2. Choose one with --address <ipv4>, for example mars-ram pair --address 10.147.17.5",
		});
	});

	it("asks which network to use when Tailscale and ZeroTier are both connected", () => {
		const { value } = ports(["10.147.17.5"]);
		expect(resolvePairingTarget({}, value)).toEqual({
			ok: false,
			choose: true,
			message: "Tailscale and ZeroTier are both connected on this computer. Choose the one your phone uses with --network tailscale or --network zerotier.",
		});
	});

	it("names both networks when neither is connected", () => {
		const { value } = ports([], { ok: false, message: "Tailscale was not found on this computer (no tailscale command). Install Tailscale and try again." });
		expect(resolvePairingTarget({}, value)).toEqual({
			ok: false,
			message: "No private network is connected on this computer. Tailscale: Tailscale was not found on this computer (no tailscale command). Install Tailscale and try again. ZeroTier: no ZeroTier network address found. Connect Tailscale, or join a ZeroTier network and authorize this computer, then try again.",
		});
	});

	it("explains that ZeroTier is not connected when there is no ZeroTier address", () => {
		const { value, calls } = ports([]);
		expect(resolvePairingTarget({ network: "zerotier" }, value)).toEqual({
			ok: false,
			message: "ZeroTier is not connected on this computer: no ZeroTier network address found. Join a network and authorize this computer, then try again.",
		});
		expect(calls).toEqual(["zerotier"]);
	});

	it("uses the only ZeroTier address", () => {
		const { value } = ports(["10.147.17.5"]);
		expect(resolvePairingTarget({ network: "zerotier" }, value)).toEqual({ ok: true, network: "zerotier", address: "10.147.17.5" });
	});

	it("asks to choose with --address when there are several ZeroTier addresses", () => {
		const { value } = ports(["10.147.17.5", "10.144.0.2"]);
		expect(resolvePairingTarget({ network: "zerotier" }, value)).toEqual({
			ok: false,
			message: "This computer has several ZeroTier addresses: 10.147.17.5, 10.144.0.2. Choose one with --address <ipv4>, for example mars-ram pair --address 10.147.17.5",
		});
	});

	it("uses the ZeroTier address chosen with --address", () => {
		const { value } = ports(["10.147.17.5", "10.144.0.2"]);
		expect(resolvePairingTarget({ network: "zerotier", address: "10.144.0.2" }, value)).toEqual({ ok: true, network: "zerotier", address: "10.144.0.2" });
		expect(resolvePairingTarget({ network: "zerotier", address: "10.147.17.5" }, ports(["10.147.17.5"]).value)).toEqual({ ok: true, network: "zerotier", address: "10.147.17.5" });
	});

	it("refuses an --address that is not on a ZeroTier interface", () => {
		const { value } = ports(["10.147.17.5", "10.144.0.2"]);
		expect(resolvePairingTarget({ network: "zerotier", address: "192.168.1.20" }, value)).toEqual({
			ok: false,
			message: "192.168.1.20 is not a ZeroTier address of this computer. Its ZeroTier addresses: 10.147.17.5, 10.144.0.2.",
		});
	});

	it("explains that ZeroTier is not connected when --address is given but there is no ZeroTier address", () => {
		const { value } = ports([]);
		expect(resolvePairingTarget({ network: "zerotier", address: "10.147.17.5" }, value)).toMatchObject({ ok: false, message: expect.stringContaining("ZeroTier is not connected on this computer") });
	});
});

describe("networkFromAnswer", () => {
	it.each([
		["1", "tailscale"],
		["2", "zerotier"],
		[" 2 ", "zerotier"],
		["tailscale", "tailscale"],
		["ZeroTier", "zerotier"],
	] as const)("reads %j as %s", (answer, network) => {
		expect(networkFromAnswer(answer)).toBe(network);
	});

	it.each([[""], ["3"], ["zt"], ["s"]])("does not guess from %j", (answer) => {
		expect(networkFromAnswer(answer)).toBeNull();
	});

	it("treats Ctrl+C or the end of input as no answer", () => {
		expect(networkFromAnswer(null)).toBeNull();
	});
});
