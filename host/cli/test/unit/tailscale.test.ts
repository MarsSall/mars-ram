import { describe, expect, it } from "vitest";
import { MAC_APP_TAILSCALE, readTailscale, readTailscaleIp } from "../../src/adapters/tailscale.ts";

const running = JSON.stringify({ BackendState: "Running", Self: { HostName: "mac", TailscaleIPs: ["100.64.0.10"] } });
function missing(): never {
	throw Object.assign(new Error("spawnSync tailscale ENOENT"), { code: "ENOENT" });
}

describe("readTailscale", () => {
	it("uses tailscale on PATH first", () => {
		const calls: string[] = [];
		const result = readTailscale((command, args) => { calls.push(`${command} ${args.join(" ")}`); return running; }, "darwin");
		expect(result).toEqual({ ok: true, address: "100.64.0.10", hostName: "mac" });
		expect(calls).toEqual(["tailscale status --json"]);
	});

	it("falls back to the CLI inside Tailscale.app on macOS", () => {
		const calls: string[] = [];
		const result = readTailscale((command, args) => { calls.push(`${command} ${args.join(" ")}`); if (command === "tailscale") missing(); return running; }, "darwin");
		expect(result).toEqual({ ok: true, address: "100.64.0.10", hostName: "mac" });
		expect(calls).toEqual(["tailscale status --json", `${MAC_APP_TAILSCALE} status --json`]);
	});

	it("looks only on PATH on Linux and Windows", () => {
		for (const platform of ["linux", "win32"] as const) {
			const calls: string[] = [];
			const result = readTailscale((command) => { calls.push(command); missing(); }, platform);
			expect(calls).toEqual(["tailscale"]);
			expect(result).toEqual({ ok: false, message: "Tailscale was not found on this computer (no tailscale command). Install Tailscale and try again." });
		}
	});

	it("names Tailscale.app when nothing is found on macOS", () => {
		expect(readTailscale(() => missing(), "darwin")).toEqual({ ok: false, message: "Tailscale was not found on this computer (no tailscale command and no /Applications/Tailscale.app). Install Tailscale and try again." });
	});

	it("reports why Tailscale did not answer", () => {
		const failed = () => { throw Object.assign(new Error("Command failed: tailscale status --json"), { status: 1, stderr: "failed to connect to local tailscaled; it doesn't appear to be running\nmore\n" }); };
		expect(readTailscale(failed, "linux")).toEqual({ ok: false, message: "Tailscale did not answer: failed to connect to local tailscaled; it doesn't appear to be running" });
		const slow = () => { throw Object.assign(new Error("spawnSync tailscale ETIMEDOUT"), { code: "ETIMEDOUT" }); };
		expect(readTailscale(slow, "linux")).toEqual({ ok: false, message: "Tailscale did not answer: it took longer than 10 seconds." });
	});

	it("keeps the not-connected message when Tailscale answers but is stopped", () => {
		expect(readTailscale(() => JSON.stringify({ BackendState: "Stopped" }), "darwin")).toEqual({ ok: false, message: "Tailscale is not connected on this computer. Connect it and try again." });
	});
});

describe("readTailscaleIp", () => {
	it("falls back to the CLI inside Tailscale.app on macOS", () => {
		const calls: string[] = [];
		const ip = readTailscaleIp((command, args) => { calls.push(`${command} ${args.join(" ")}`); if (command === "tailscale") missing(); return "100.64.0.12\n"; }, "darwin");
		expect(ip).toBe("100.64.0.12");
		expect(calls).toEqual(["tailscale ip -4", `${MAC_APP_TAILSCALE} ip -4`]);
	});

	it("does not fall back on Linux", () => {
		expect(() => readTailscaleIp(() => missing(), "linux")).toThrow("ENOENT");
	});
});
