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
/** The macOS app keeps its CLI inside the bundle and does not put `tailscale` on PATH. */
export const MAC_APP_TAILSCALE = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

type Runner = (command: string, args: string[]) => Promise<string>;

// TAILSCALE_BE_CLI makes the macOS app binary act as the CLI instead of opening its window.
const runTailscale: Runner = async (command, args) => (await promisify(execFile)(command, args, { timeout: 10000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: { ...process.env, TAILSCALE_BE_CLI: "1" } })).stdout;

export function createTailscale(run: Runner = runTailscale, platform: NodeJS.Platform = process.platform) {
	const commands = platform === "darwin" ? ["tailscale", MAC_APP_TAILSCALE] : ["tailscale"];
	return {
		async address(): Promise<TailnetAddress> {
			for (const command of commands) {
				let stdout: string;
				try {
					stdout = await run(command, ["status", "--json"]);
				} catch (error) {
					if ((error as { code?: string }).code === "ENOENT") continue;
					break;
				}
				try { return parseTailscale(JSON.parse(stdout)); } catch { break; }
			}
			throw new Error("Tailscale is down or unavailable. Connect Tailscale before serving links.");
		},
	};
}
export const tailscale = createTailscale();
