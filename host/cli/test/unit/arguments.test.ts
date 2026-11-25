import { describe, expect, it } from "vitest";
import { parseArguments } from "../../src/arguments.ts";

describe("parseArguments", () => {
	it.each([
		[["pair"], { ok: true, command: "pair", sshPort: 22 }],
		[["install"], { ok: true, command: "install" }],
		[["uninstall"], { ok: true, command: "uninstall" }],
		[["uploads-dir", "--json"], { ok: true, command: "uploads-dir" }],
		[["doctor"], { ok: true, command: "doctor" }],
		[["update"], { ok: true, command: "update" }],
		[["hook", "claude", "Stop"], { ok: true, command: "hook", args: ["claude", "Stop"] }],
		[["bridge", "claude", "e30"], { ok: true, command: "bridge", args: ["claude", "e30"] }],
		[["version", "--json"], { ok: true, command: "version", json: true }],
		[["pair", "--ssh-port", "2222"], { ok: true, command: "pair", sshPort: 2222 }],
		[["pair-zt"], { ok: true, command: "pair", sshPort: 22, network: "zerotier" }],
		[["pair-zt", "--address", "10.147.17.5"], { ok: true, command: "pair", sshPort: 22, network: "zerotier", address: "10.147.17.5" }],
		[["pair-zt", "--address", "10.147.17.5", "--ssh-port", "2222"], { ok: true, command: "pair", sshPort: 2222, network: "zerotier", address: "10.147.17.5" }],
		[["pair", "--network", "tailscale"], { ok: true, command: "pair", sshPort: 22, network: "tailscale" }],
		[["pair", "--network", "zerotier"], { ok: true, command: "pair", sshPort: 22, network: "zerotier" }],
		[["pair", "--network", "zerotier", "--address", "10.147.17.5"], { ok: true, command: "pair", sshPort: 22, network: "zerotier", address: "10.147.17.5" }],
		[["pair", "--address", "10.147.17.5"], { ok: true, command: "pair", sshPort: 22, network: "zerotier", address: "10.147.17.5" }],
		[["pair", "--ssh-port", "2222", "--network", "zerotier"], { ok: true, command: "pair", sshPort: 2222, network: "zerotier" }],
		[["doctor"], { ok: true, command: "doctor" }],
		[["version", "--json"], { ok: true, command: "version", json: true }],
		[["servers", "list"], { ok: true, command: "servers", args: ["list"] }],
	])("accepts %j", (args, expected) => {
		expect(parseArguments(args)).toEqual(expected);
	});

	it.each([
		[[]],
		[["unpair"]],
		[["install", "--yes"]],
		[["uninstall", "extra"]],
		[["uploads-dir"]],
		[["uploads-dir", "--json", "--json"]],
		[["uploads-dir", "--path"]],
		[["uploads-dir", "--json", "extra"]],
		[["pair", "extra"]],
		[["pair", "--unknown"]],
		[["pair", "--ssh-port"]],
		[["pair", "--ssh-port", "0"]],
		[["pair", "--ssh-port", "22x"]],
		[["pair", "--ssh-port", "22", "--ssh-port", "2222"]],
		[["pair", "--network"]],
		[["pair", "--network", "wifi"]],
		[["pair", "--network", "Tailscale"]],
		[["pair", "--network", "zerotier", "--network", "tailscale"]],
		[["pair", "--network", "tailscale", "--address", "10.147.17.5"]],
		[["pair", "--address", "zt.example.com"]],
		[["pairZT"]],
		[["pair-zt", "extra"]],
		[["pair-zt", "--network", "zerotier"]],
		[["pair-zt", "--address"]],
		[["pair-zt", "--address", "10.147.17.5", "--address", "10.147.17.6"]],
		[["pair-zt", "--address", "zt.example.com"]],
		[["pair-zt", "--address", "10.147.17.256"]],
		[["pair-zt", "--address", "fd00::5"]],
		[["doctor", "--address", "10.147.17.5"]],
		[["update", "--yes"]],
		[["update", "extra"]],
		[["update", "install"]],
	])("refuses %j", (args) => {
		expect(parseArguments(args)).toEqual({ ok: false });
	});
});

describe("usage", () => {
	it("lists update next to install, uninstall and doctor (S8)", async () => {
		const { text } = await import("../../src/adapters/terminal.ts");
		expect(text.usage).toMatch(/\| install \| uninstall \| doctor \| update$/);
	});
});
