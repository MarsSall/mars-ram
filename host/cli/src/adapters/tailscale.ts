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

/** The macOS app keeps its CLI inside the bundle and does not put `tailscale` on PATH. */
export const MAC_APP_TAILSCALE = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

// TAILSCALE_BE_CLI makes the macOS app binary act as the CLI instead of opening its window.
const runTailscale: ReadOnlyRunner = (command, args) => execFileSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 10_000, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, TAILSCALE_BE_CLI: "1" } });

/** Runs the first Tailscale CLI that exists: `tailscale` on PATH, then the macOS app bundle. */
function runFirstTailscale(run: ReadOnlyRunner, args: string[], platform: NodeJS.Platform): string {
	const commands = platform === "darwin" ? ["tailscale", MAC_APP_TAILSCALE] : ["tailscale"];
	for (const [index, command] of commands.entries()) {
		try {
			return run(command, args);
		} catch (error) {
			if ((error as { code?: string }).code !== "ENOENT" || index === commands.length - 1) throw error;
		}
	}
	throw new Error("unreachable");
}

/** Doctor needs only the address, without fetching or exposing other tailnet metadata. */
export function readTailscaleIp(run: ReadOnlyRunner, platform: NodeJS.Platform = process.platform): string {
	const address = runFirstTailscale(run, ["ip", "-4"], platform).trim();
	if (!/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.(?:\d{1,3})\.(?:\d{1,3})$/.test(address) || address.split(".").some((part) => Number(part) > 255)) throw new Error("Tailscale IPv4 unavailable");
	return address;
}

export function readTailscale(run: ReadOnlyRunner = runTailscale, platform: NodeJS.Platform = process.platform): TailscaleSelf {
	let output: string;
	try {
		output = runFirstTailscale(run, ["status", "--json"], platform);
	} catch (error) {
		return { ok: false, message: tailscaleFailure(error, platform) };
	}
	try {
		return parseTailscaleStatus(JSON.parse(output));
	} catch {
		return { ok: false, message: "Tailscale did not answer: its status could not be read." };
	}
}

function tailscaleFailure(error: unknown, platform: NodeJS.Platform): string {
	const { code, stderr, message } = error as { code?: string; stderr?: string | Buffer; message?: string };
	if (code === "ENOENT") {
		const where = platform === "darwin" ? "no tailscale command and no /Applications/Tailscale.app" : "no tailscale command";
		return `Tailscale was not found on this computer (${where}). Install Tailscale and try again.`;
	}
	if (code === "ETIMEDOUT") return "Tailscale did not answer: it took longer than 10 seconds.";
	const reason = String(stderr ?? "").trim().split("\n")[0] || message || "unknown error";
	return `Tailscale did not answer: ${reason.slice(0, 200)}`;
}
