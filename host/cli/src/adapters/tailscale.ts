// Reads this computer's Tailscale address, the only address pairing listens on.
import { execFileSync } from "node:child_process";

export type TailscaleSelf = { ok: true; address: string; dnsName?: string; hostName: string } | { ok: false; message: string };

export function parseTailscaleStatus(status: unknown): TailscaleSelf {
	const s = status as { BackendState?: string; Self?: { HostName?: string; DNSName?: string; TailscaleIPs?: string[] } } | null;
	if (!s || typeof s !== "object" || s.BackendState !== "Running") {
		return { ok: false, message: "Tailscale is not connected on this computer. Connect it and try again." };
	}
	const address = s.Self?.TailscaleIPs?.find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
	if (!address) return { ok: false, message: "This computer has no Tailscale IPv4 address." };
	const dnsName = s.Self?.DNSName?.replace(/\.$/, "");
	const self: TailscaleSelf = { ok: true, address, hostName: s.Self?.HostName ?? address };
	if (dnsName) self.dnsName = dnsName;
	return self;
}

export type ReadOnlyRunner = (command: string, args: string[]) => string;

/** Doctor needs only the address, without fetching or exposing other tailnet metadata. */
export function readTailscaleIp(run: ReadOnlyRunner): string {
	const address = run("tailscale", ["ip", "-4"]).trim();
	if (!/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.(?:\d{1,3})\.(?:\d{1,3})$/.test(address) || address.split(".").some((part) => Number(part) > 255)) throw new Error("Tailscale IPv4 unavailable");
	return address;
}

export function readTailscale(): TailscaleSelf {
	try {
		const output = execFileSync("tailscale", ["status", "--json"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
		return parseTailscaleStatus(JSON.parse(output));
	} catch {
		return { ok: false, message: "Tailscale is not installed or not running on this computer." };
	}
}
