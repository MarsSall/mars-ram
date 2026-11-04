import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TailnetAddress } from "../core/ports.ts";

export function parseTailscale(status: unknown): TailnetAddress {
	const value = status as { BackendState?: string; Self?: { TailscaleIPs?: unknown[]; DNSName?: string } } | null;
	const ip = value?.Self?.TailscaleIPs?.find((entry): entry is string => typeof entry === "string" && /^100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.(?:\d{1,3})\.(?:\d{1,3})$/.test(entry) && entry.split(".").every(part => Number(part) <= 255));
	const dnsName = value?.Self?.DNSName?.replace(/\.$/, "");
	if (value?.BackendState !== "Running" || !ip || !dnsName || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(dnsName)) throw new Error("Tailscale is down or has no usable IPv4 address and DNS name.");
	return { ip, dnsName };
}
export const tailscale = {
	async address(): Promise<TailnetAddress> {
		try {
			const { stdout } = await promisify(execFile)("tailscale", ["status", "--json"], { timeout: 10000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
			return parseTailscale(JSON.parse(stdout));
		} catch { throw new Error("Tailscale is down or unavailable. Connect Tailscale before serving links."); }
	},
};
