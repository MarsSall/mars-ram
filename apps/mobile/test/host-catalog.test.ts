import { describe, expect, it } from "vitest";
import { connectTarget, hasTailscaleFeatures, hostNetwork, parseSavedHosts, serializeSavedHosts, type SavedHost } from "../src/core/host-catalog";

const host: SavedHost = {
	id: "h1",
	keyAlias: "app-ssh-key",
	rotation: { phase: "done" },
	name: "devbox",
	address: "100.64.0.10",
	dnsName: "devbox.example-tailnet.ts.net",
	sshPort: 22,
	user: "mars",
	hostKey: `SHA256:${"B".repeat(43)}`,
	addedAt: 1,
};

describe("parseSavedHosts", () => {
	it("reads the saved computers", () => {
		expect(parseSavedHosts(JSON.stringify({ version: 1, hosts: [host] }))).toEqual({ hosts: [host], dropped: 0 });
	});

	it("starts empty when nothing was saved yet", () => {
		expect(parseSavedHosts(null)).toEqual({ hosts: [], dropped: 0 });
	});

	it("starts empty instead of crashing when the file is damaged", () => {
		expect(parseSavedHosts("{not json")).toEqual({ hosts: [], dropped: 0 });
	});

	it("drops entries that are not valid computers and says how many", () => {
		const broken = { ...host, id: "h2", hostKey: "MD5:aa" };
		expect(parseSavedHosts(JSON.stringify({ version: 1, hosts: [host, broken, "x"] }))).toEqual({ hosts: [host], dropped: 2 });
	});

	it("keeps a ZeroTier computer's network, and reads a computer saved before networks as Tailscale", () => {
		const { dnsName: _, ...rest } = host;
		const zeroTier: SavedHost = { ...rest, id: "h2", address: "10.147.17.5", network: "zerotier" };
		const { hosts } = parseSavedHosts(serializeSavedHosts([host, zeroTier]));
		expect(hosts).toEqual([host, zeroTier]);
		expect(hosts.map(hostNetwork)).toEqual(["tailscale", "zerotier"]);
		expect(hosts[0]).not.toHaveProperty("network");
		expect(connectTarget(zeroTier, "k")).toMatchObject({ host: "10.147.17.5", fallbackHost: null });
	});

	it("offers private links and Siempre atento only for Tailscale computers", () => {
		expect(hasTailscaleFeatures(host)).toBe(true);
		expect(hasTailscaleFeatures({ ...host, network: "tailscale" })).toBe(true);
		expect(hasTailscaleFeatures({ ...host, network: "zerotier" })).toBe(false);
	});

	it("drops a computer with an unknown network", () => {
		expect(parseSavedHosts(JSON.stringify({ version: 2, hosts: [{ ...host, network: "wireguard" }] }))).toEqual({ hosts: [], dropped: 1 });
	});
});
