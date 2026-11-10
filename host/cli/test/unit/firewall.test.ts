import { describe, expect, it } from "vitest";
import { parseSystemdState, parseUfwConf, readFirewall, systemdIsActive, type FirewallIO } from "../../src/adapters/firewall.ts";
import { firewallFixes, pairingFirewallHints, type FirewallState, type PairingFirewallPorts } from "../../src/core/firewall.ts";

const UFW_CONF = "# /etc/ufw/ufw.conf\n#\n\n# Set to yes to start on boot.\nENABLED=yes\n\nLOGLEVEL=low\n";

/** Files and `systemctl is-active` answers; a missing file is undefined, an unreadable one throws. */
function io(files: Record<string, string | Error | undefined>, units: Record<string, string | Error> = {}): FirewallIO & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		read(path) {
			calls.push(`read ${path}`);
			const value = files[path];
			if (value instanceof Error) throw value;
			return value;
		},
		isActive(unit) {
			calls.push(`systemctl is-active ${unit}`);
			const value = units[unit];
			if (value instanceof Error) throw value;
			return value ?? "inactive\n";
		},
	};
}
const denied = Object.assign(new Error("EACCES"), { code: "EACCES" });

describe("parseUfwConf", () => {
	it("reads ENABLED=yes as active and ENABLED=no as inactive", () => {
		expect(parseUfwConf(UFW_CONF)).toBe("active");
		expect(parseUfwConf(UFW_CONF.replace("ENABLED=yes", "ENABLED=no"))).toBe("inactive");
	});
	it("accepts quotes and spaces the way ufw's shell parsing does", () => {
		expect(parseUfwConf('ENABLED="yes"\n')).toBe("active");
		expect(parseUfwConf("  ENABLED = 'no'  \n")).toBe("inactive");
	});
	it("ignores comments and reports unknown without an ENABLED line", () => {
		expect(parseUfwConf("# ENABLED=yes\nLOGLEVEL=low\n")).toBe("unknown");
		expect(parseUfwConf("ENABLED=maybe\n")).toBe("unknown");
	});
});

describe("parseSystemdState", () => {
	it("maps systemctl is-active states", () => {
		expect(parseSystemdState("active\n")).toBe("active");
		expect(parseSystemdState("reloading\n")).toBe("active");
		expect(parseSystemdState("inactive\n")).toBe("inactive");
		expect(parseSystemdState("failed\n")).toBe("inactive");
		expect(parseSystemdState("")).toBe("unknown");
		expect(parseSystemdState("garbage")).toBe("unknown");
	});
});

describe("systemdIsActive", () => {
	it("runs systemctl is-active read-only and keeps its answer when it exits non-zero", () => {
		const calls: string[][] = [];
		const isActive = systemdIsActive((command, args) => {
			calls.push([command, ...args]);
			if (args[1] === "firewalld") throw Object.assign(new Error("exit 3"), { status: 3, stdout: "inactive\n" });
			return "active\n";
		});
		expect(isActive("ufw")).toBe("active\n");
		expect(isActive("firewalld")).toBe("inactive\n");
		expect(calls).toEqual([["systemctl", "is-active", "ufw"], ["systemctl", "is-active", "firewalld"]]);
	});
	it("rethrows when systemctl itself cannot run", () => {
		const isActive = systemdIsActive(() => { throw Object.assign(new Error("spawn systemctl ENOENT"), { code: "ENOENT" }); });
		expect(() => isActive("ufw")).toThrow("ENOENT");
	});
});

describe("readFirewall", () => {
	it("trusts ufw.conf over systemd, which reports ufw.service active even when ufw is disabled", () => {
		const fake = io({ "/etc/ufw/ufw.conf": UFW_CONF.replace("ENABLED=yes", "ENABLED=no") }, { ufw: "active\n", firewalld: "inactive\n" });
		expect(readFirewall(fake, "linux")).toEqual({ ufw: "inactive", firewalld: "inactive" });
		expect(fake.calls).not.toContain("systemctl is-active ufw");
	});
	it("reports ufw active from ufw.conf and firewalld from systemd", () => {
		expect(readFirewall(io({ "/etc/ufw/ufw.conf": UFW_CONF }, { firewalld: "active\n" }), "linux")).toEqual({ ufw: "active", firewalld: "active" });
	});
	it("treats a missing ufw.conf as no ufw", () => {
		const fake = io({}, { ufw: "active\n" });
		expect(readFirewall(fake, "linux").ufw).toBe("inactive");
		expect(fake.calls).not.toContain("systemctl is-active ufw");
	});
	it("falls back to systemd when ufw.conf cannot be read", () => {
		expect(readFirewall(io({ "/etc/ufw/ufw.conf": denied }, { ufw: "active\n" }), "linux").ufw).toBe("active");
		expect(readFirewall(io({ "/etc/ufw/ufw.conf": denied }, { ufw: "inactive\n" }), "linux").ufw).toBe("inactive");
		expect(readFirewall(io({ "/etc/ufw/ufw.conf": "LOGLEVEL=low\n" }, { ufw: "active\n" }), "linux").ufw).toBe("active");
	});
	it("reports unknown when systemctl cannot run", () => {
		const missing = Object.assign(new Error("spawn systemctl ENOENT"), { code: "ENOENT" });
		expect(readFirewall(io({ "/etc/ufw/ufw.conf": denied }, { ufw: missing, firewalld: missing }), "linux")).toEqual({ ufw: "unknown", firewalld: "unknown" });
	});
	it("does not look for Linux firewalls on macOS or Windows", () => {
		for (const platform of ["darwin", "win32"] as const) {
			const fake = io({ "/etc/ufw/ufw.conf": UFW_CONF }, { ufw: "active\n", firewalld: "active\n" });
			expect(readFirewall(fake, platform)).toEqual({ ufw: "unknown", firewalld: "unknown" });
			expect(fake.calls).toEqual([]);
		}
	});
});

describe("firewallFixes", () => {
	it("names the exact ZeroTier interface for each active firewall", () => {
		expect(firewallFixes({ ufw: "active", firewalld: "inactive" }, "ztexample0")).toEqual([{ firewall: "ufw", command: "sudo ufw allow in on ztexample0 comment 'ZeroTier'" }]);
		expect(firewallFixes({ ufw: "inactive", firewalld: "active" }, "ztexample0")).toEqual([{ firewall: "firewalld", command: "sudo firewall-cmd --permanent --zone=trusted --add-interface=ztexample0 && sudo firewall-cmd --reload" }]);
	});
	it("suggests nothing for inactive or unknown firewalls", () => {
		expect(firewallFixes({ ufw: "inactive", firewalld: "unknown" }, "zt0")).toEqual([]);
		expect(firewallFixes({ ufw: "unknown", firewalld: "inactive" }, "zt0")).toEqual([]);
	});
	it("never puts an interface name that is unsafe to paste into a shell command", () => {
		expect(firewallFixes({ ufw: "active", firewalld: "inactive" }, "zt0;reboot")).toEqual([{ firewall: "ufw", command: "sudo ufw allow in on <ZeroTier interface> comment 'ZeroTier'" }]);
	});
});

describe("pairingFirewallHints", () => {
	const ports = (state: FirewallState, iface: string | undefined = "ztexample0") => {
		const calls: string[] = [];
		const value: PairingFirewallPorts = {
			firewall: () => (calls.push("firewall"), state),
			zeroTierInterface: (address) => (calls.push(`interface ${address}`), iface),
		};
		return { value, calls };
	};
	const zerotier = { ok: true as const, network: "zerotier" as const, address: "10.147.20.49" };

	it("prints one line naming the interface when ufw is active", () => {
		const { value, calls } = ports({ ufw: "active", firewalld: "inactive" });
		expect(pairingFirewallHints(zerotier, value, false)).toEqual(["The firewall (ufw) is on and may block the phone over ZeroTier. If pairing does not connect, run: sudo ufw allow in on ztexample0 comment 'ZeroTier'"]);
		expect(calls).toEqual(["firewall", "interface 10.147.20.49"]);
	});
	it("explains it in Spanish, and for firewalld", () => {
		expect(pairingFirewallHints(zerotier, ports({ ufw: "inactive", firewalld: "active" }).value, true)).toEqual(["El firewall (firewalld) está activo y puede bloquear al teléfono por ZeroTier. Si el emparejamiento no conecta, ejecutá: sudo firewall-cmd --permanent --zone=trusted --add-interface=ztexample0 && sudo firewall-cmd --reload"]);
	});
	it("prints nothing when no firewall is active or the state is unknown", () => {
		expect(pairingFirewallHints(zerotier, ports({ ufw: "inactive", firewalld: "inactive" }).value, false)).toEqual([]);
		expect(pairingFirewallHints(zerotier, ports({ ufw: "unknown", firewalld: "unknown" }).value, false)).toEqual([]);
	});
	it("never reads the firewall for Tailscale pairing, which Tailscale lets through itself", () => {
		const { value, calls } = ports({ ufw: "active", firewalld: "active" });
		expect(pairingFirewallHints({ ok: true, network: "tailscale", address: "100.64.0.10", dnsName: "devbox.example.ts.net" }, value, false)).toEqual([]);
		expect(calls).toEqual([]);
	});
	it("prints nothing if reading the firewall fails", () => {
		const value: PairingFirewallPorts = { firewall: () => { throw new Error("boom"); }, zeroTierInterface: () => "zt0" };
		expect(pairingFirewallHints(zerotier, value, false)).toEqual([]);
	});
});
