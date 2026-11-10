import { describe, expect, it } from "vitest";
import { inSubnet, ipv4Prefix, isIpv4, zeroTierEntries } from "../src/private-network.ts";

const v4 = (address: string, netmask = "255.255.255.0", internal = false) => ({ address, family: "IPv4", internal, netmask });

describe("literal IPv4", () => {
	it.each(["10.147.20.49", "0.0.0.0", "255.255.255.255", "100.64.1.2"])("accepts %s", (address) => expect(isIpv4(address)).toBe(true));
	it.each(["", "10.1.1", "10.1.1.1.1", "010.1.1.1", "10.1.1.256", "10.1.1.1 ", " 10.1.1.1", "10.1.1.1\n", "::1", "fd7a:115c:a1e0::1", "a.b.c.d", "1e1.1.1.1", "10.1.1.-1"])("rejects %j", (address) => expect(isIpv4(address)).toBe(false));
	it("reads prefixes only from contiguous masks", () => {
		expect(ipv4Prefix("255.255.255.0")).toBe(24);
		expect(ipv4Prefix("255.255.0.0")).toBe(16);
		expect(ipv4Prefix("255.255.255.255")).toBe(32);
		expect(ipv4Prefix("0.0.0.0")).toBe(0);
		expect(ipv4Prefix("255.0.255.0")).toBeNull();
		expect(ipv4Prefix("garbage")).toBeNull();
	});
	it("checks subnet membership by prefix", () => {
		expect(inSubnet("10.147.20.20", "10.147.20.49", 24)).toBe(true);
		expect(inSubnet("10.147.172.20", "10.147.20.49", 24)).toBe(false);
		expect(inSubnet("10.147.172.20", "10.147.20.49", 16)).toBe(true);
		expect(inSubnet("10.147.20.49", "10.147.20.49", 32)).toBe(true);
		expect(inSubnet("10.147.20.50", "10.147.20.49", 32)).toBe(false);
		expect(inSubnet("bad", "10.147.20.49", 24)).toBe(false);
	});
});

describe("ZeroTier interface entries", () => {
	it("keeps the platform name rules and adds each interface prefix", () => {
		const table = { lo: [v4("127.0.0.1", "255.0.0.0", true)], eth0: [v4("192.168.1.20")], ztexample0: [v4("10.147.20.49"), { address: "fd80::5", family: "IPv6", internal: false, netmask: "ffff::" }], zt3: [v4("169.254.3.4")], zt1: [v4("10.144.0.2", "255.255.0.0")] };
		expect(zeroTierEntries(table, "linux")).toEqual([{ name: "ztexample0", address: "10.147.20.49", prefix: 24 }, { name: "zt1", address: "10.144.0.2", prefix: 16 }]);
		expect(zeroTierEntries({ feth1: [v4("10.1.1.1")] }, "darwin")).toEqual([{ name: "feth1", address: "10.1.1.1", prefix: 24 }]);
		expect(zeroTierEntries({ feth1: [v4("10.1.1.1")] }, "linux")).toEqual([]);
		expect(zeroTierEntries({ "ZeroTier One [8056c2e21c000001]": [v4("172.24.0.9")] }, "win32")).toEqual([{ name: "ZeroTier One [8056c2e21c000001]", address: "172.24.0.9", prefix: 24 }]);
	});
	it("reports an unreadable mask as no prefix rather than guessing", () => {
		expect(zeroTierEntries({ zt0: [v4("10.1.1.1", "255.0.255.0")] }, "linux")).toEqual([{ name: "zt0", address: "10.1.1.1", prefix: null }]);
	});
});
