// Reads whether ufw or firewalld is on without root: ufw.conf is world-readable, its rules are not.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { FirewallState, FirewallStatus } from "../core/firewall.ts";
import type { ReadOnlyRunner } from "./tailscale.ts";

export type FirewallIO = {
	/** File contents; undefined when the file does not exist, throws when it cannot be read. */
	read(path: string): string | undefined;
	/** Output of `systemctl is-active <unit>`; throws when systemctl cannot run. */
	isActive(unit: string): string;
};

const UFW_CONF = "/etc/ufw/ufw.conf";

/** `ENABLED=yes|no` in /etc/ufw/ufw.conf, which ufw itself sources as shell. */
export function parseUfwConf(config: string): FirewallStatus {
	let status: FirewallStatus = "unknown";
	for (const raw of config.split(/\r?\n/)) {
		const match = raw.replace(/#.*$/, "").match(/^\s*ENABLED\s*=\s*(["']?)(\w*)\1\s*$/);
		if (match) status = match[2]!.toLowerCase() === "yes" ? "active" : match[2]!.toLowerCase() === "no" ? "inactive" : "unknown";
	}
	return status;
}

export function parseSystemdState(output: string): FirewallStatus {
	const state = output.trim().split(/\s+/)[0];
	if (state === "active" || state === "reloading" || state === "activating") return "active";
	if (state === "inactive" || state === "failed" || state === "deactivating") return "inactive";
	return "unknown";
}

/** systemctl is-active exits non-zero for inactive units but still prints the state. */
export function systemdIsActive(run: ReadOnlyRunner): FirewallIO["isActive"] {
	return (unit) => {
		try { return run("systemctl", ["is-active", unit]); } catch (error) {
			const stdout = (error as { stdout?: unknown }).stdout;
			if (typeof stdout === "string" && (error as { status?: unknown }).status !== undefined) return stdout;
			throw error;
		}
	};
}

const unit = (io: FirewallIO, name: string): FirewallStatus => { try { return parseSystemdState(io.isActive(name)); } catch { return "unknown"; } };

function ufw(io: FirewallIO): FirewallStatus {
	let config: string | undefined;
	try {
		config = io.read(UFW_CONF);
		if (config === undefined) return "inactive";
	} catch { /* Unreadable: fall back to systemd. */ }
	const status = config === undefined ? "unknown" : parseUfwConf(config);
	// ufw.service stays active even with ENABLED=no, so systemd is only a fallback.
	return status === "unknown" ? unit(io, "ufw") : status;
}

const defaultIO: FirewallIO = {
	read(path) {
		try { return readFileSync(path, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
	},
	isActive: systemdIsActive((command, args) => execFileSync(command, args, { encoding: "utf8", shell: false, timeout: 5_000, stdio: ["ignore", "pipe", "pipe"] })),
};

/** macOS and Windows firewalls are not inspected: no hint there. */
export function readFirewall(io: FirewallIO = defaultIO, platform: NodeJS.Platform = process.platform): FirewallState {
	if (platform !== "linux") return { ufw: "unknown", firewalld: "unknown" };
	return { ufw: ufw(io), firewalld: unit(io, "firewalld") };
}
