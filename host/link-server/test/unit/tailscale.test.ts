import { describe, expect, it } from "vitest";
import { createTailscale, MAC_APP_TAILSCALE } from "../../src/adapters/tailscale.ts";

const running = JSON.stringify({ BackendState: "Running", Self: { TailscaleIPs: ["100.64.1.2"], DNSName: "mac.tail.ts.net." } });
function missing(): never {
	throw Object.assign(new Error("spawn tailscale ENOENT"), { code: "ENOENT" });
}

describe("tailscale adapter", () => {
	it("falls back to the CLI inside Tailscale.app on macOS", async () => {
		const calls: string[] = [];
		const tailscale = createTailscale(async (command, args) => { calls.push(`${command} ${args.join(" ")}`); if (command === "tailscale") missing(); return running; }, "darwin");
		await expect(tailscale.address()).resolves.toEqual({ ip: "100.64.1.2", dnsName: "mac.tail.ts.net" });
		expect(calls).toEqual(["tailscale status --json", `${MAC_APP_TAILSCALE} status --json`]);
	});

	it("looks only on PATH on Linux and Windows", async () => {
		for (const platform of ["linux", "win32"] as const) {
			const calls: string[] = [];
			const tailscale = createTailscale(async (command) => { calls.push(command); missing(); }, platform);
			await expect(tailscale.address()).rejects.toThrow("Tailscale is down or unavailable. Connect Tailscale before serving links.");
			expect(calls).toEqual(["tailscale"]);
		}
	});
});
