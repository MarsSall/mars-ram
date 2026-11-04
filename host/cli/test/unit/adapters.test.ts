import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorizeKey, buildKeyLine, keyTarget, parseWindowsPrivileges } from "../../src/adapters/authorized-keys.ts";
import { fingerprintOfPublicKey } from "../../src/adapters/host-identity.ts";
import { startPairingEndpoint } from "../../src/adapters/pairing-endpoint.ts";
import { parseTailscaleStatus } from "../../src/adapters/tailscale.ts";
import { PairingSession } from "../../src/core/pairing-session.ts";

// A throwaway key generated for these tests; its private half was discarded.
const FIXTURE_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIP3OV620MF72A54sBJnVxLXg5A9k3Lp6/yL7jXn9x/9z fixture";
const FIXTURE_FINGERPRINT = "SHA256:vKeRrfKOg22BpmHtIvKB+EQcJ6nQmagdac2yv/dCwQc";

const roots: string[] = [];
const freshDir = () => {
	const dir = mkdtempSync(join(tmpdir(), "host-cli-test-"));
	roots.push(dir);
	return dir;
};
afterEach(() => {
	for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("parseTailscaleStatus", () => {
	it("reads the IPv4 address and the name without the trailing dot", () => {
		const status = { BackendState: "Running", Self: { HostName: "devbox", DNSName: "devbox.example-tailnet.ts.net.", TailscaleIPs: ["100.64.0.10", "fd7a:115c:a1e0::7439:ba1a"] } };
		expect(parseTailscaleStatus(status)).toEqual({ ok: true, address: "100.64.0.10", dnsName: "devbox.example-tailnet.ts.net", hostName: "devbox" });
	});

	it.each([
		["Tailscale is stopped", { BackendState: "Stopped", Self: { TailscaleIPs: [] } }],
		["there is no IPv4 address", { BackendState: "Running", Self: { HostName: "x", TailscaleIPs: ["fd7a::1"] } }],
		["the status is not an object", "nonsense"],
	])("refuses when %s", (_name, status) => {
		expect(parseTailscaleStatus(status)).toMatchObject({ ok: false });
	});
});

describe("fingerprintOfPublicKey", () => {
	it("matches ssh-keygen's SHA256 fingerprint", () => {
		expect(fingerprintOfPublicKey(FIXTURE_KEY)).toBe(FIXTURE_FINGERPRINT);
	});
});

describe("buildKeyLine", () => {
	it("restricts the key to tunnels and a terminal and names the phone and the date", () => {
		expect(buildKeyLine(FIXTURE_KEY, "Galaxy S24 Ultra", new Date("2026-10-20T12:00:00Z"))).toBe(
			"restrict,port-forwarding,pty ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIP3OV620MF72A54sBJnVxLXg5A9k3Lp6/yL7jXn9x/9z mars-ram:Galaxy S24 Ultra:2026-10-20",
		);
	});
});

describe("keyTarget", () => {
	it("uses the user's file on Linux", () => {
		expect(keyTarget("linux", { home: "/home/u", programData: undefined, administrator: false })).toEqual({ path: "/home/u/.ssh/authorized_keys", kind: "user" });
	});

	it("uses the administrators file for a Windows administrator", () => {
		expect(keyTarget("win32", { home: "C:\\Users\\u", programData: "C:\\ProgramData", administrator: true })).toEqual({
			path: win32.join("C:\\ProgramData", "ssh", "administrators_authorized_keys"),
			kind: "windows-administrators",
		});
	});
});

describe("parseWindowsPrivileges", () => {
	const row = (name: string, sid: string, attributes: string) => `"${name}","Alias","${sid}","${attributes}"`;
	it("detects an elevated administrator", () => {
		const csv = [
			"\"Group Name\",\"Type\",\"SID\",\"Attributes\"",
			row("BUILTIN\\Administrators", "S-1-5-32-544", "Mandatory group, Enabled by default, Enabled group, Group owner"),
			row("Mandatory Label\\High Mandatory Level", "S-1-16-12288", "Group"),
		].join("\n");
		expect(parseWindowsPrivileges(csv)).toEqual({ administrator: true, elevated: true });
	});

	// Attribute texts are localized, so elevation comes from the integrity level SID.
	it.each([
		["English", "Group used for deny only"],
		["Spanish", "Grupo usado solo para denegar"],
	])("detects an unelevated administrator with %s attribute texts", (_language, denyOnly) => {
		const csv = [
			"\"Group Name\",\"Type\",\"SID\",\"Attributes\"",
			row("BUILTIN\\Administradores", "S-1-5-32-544", denyOnly),
			row("Etiqueta obligatoria\\Nivel obligatorio medio", "S-1-16-8192", "Grupo"),
		].join("\n");
		expect(parseWindowsPrivileges(csv)).toEqual({ administrator: true, elevated: false });
	});

	it("detects an elevated administrator by its high integrity level", () => {
		const csv = [
			"\"Group Name\",\"Type\",\"SID\",\"Attributes\"",
			row("BUILTIN\\Administradores", "S-1-5-32-544", "Grupo obligatorio, Habilitado de manera predeterminada"),
			row("Etiqueta obligatoria\\Nivel obligatorio alto", "S-1-16-12288", "Grupo"),
		].join("\n");
		expect(parseWindowsPrivileges(csv)).toEqual({ administrator: true, elevated: true });
	});

	it("detects an administrator in a terminal that is not elevated", () => {
		const csv = ["\"Group Name\",\"Type\",\"SID\",\"Attributes\"", row("BUILTIN\\Administradores", "S-1-5-32-544", "Group used for deny only")].join("\n");
		expect(parseWindowsPrivileges(csv)).toEqual({ administrator: true, elevated: false });
	});

	it("detects a regular user", () => {
		const csv = ["\"Group Name\",\"Type\",\"SID\",\"Attributes\"", row("BUILTIN\\Users", "S-1-5-32-545", "Mandatory group, Enabled by default, Enabled group")].join("\n");
		expect(parseWindowsPrivileges(csv)).toEqual({ administrator: false, elevated: false });
	});
});

describe.skipIf(process.platform === "win32")("authorizeKey on POSIX hosts", () => {
	const line = buildKeyLine(FIXTURE_KEY, "Phone", new Date("2026-10-20T00:00:00Z"));

	it("creates ~/.ssh and authorized_keys with owner-only permissions", () => {
		const path = join(freshDir(), ".ssh", "authorized_keys");
		expect(authorizeKey({ path, kind: "user" }, line)).toEqual({ ok: true });
		expect(readFileSync(path, "utf8")).toBe(`${line}\n`);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(statSync(join(path, "..")).mode & 0o777).toBe(0o700);
	});

	it("appends on a new line, keeps the existing keys, and leaves a backup of the previous file", () => {
		const dir = join(freshDir(), ".ssh");
		mkdirSync(dir, { mode: 0o700 });
		const path = join(dir, "authorized_keys");
		writeFileSync(path, "ssh-ed25519 AAAAexisting other", { mode: 0o600 });
		expect(authorizeKey({ path, kind: "user" }, line)).toEqual({ ok: true });
		expect(readFileSync(path, "utf8")).toBe(`ssh-ed25519 AAAAexisting other\n${line}\n`);
		expect(readFileSync(`${path}.bak-before-pairing`, "utf8")).toBe("ssh-ed25519 AAAAexisting other");
	});

	it("does not treat a commented-out key as authorized", () => {
		const dir = join(freshDir(), ".ssh");
		mkdirSync(dir, { mode: 0o700 });
		const path = join(dir, "authorized_keys");
		writeFileSync(path, `# ${FIXTURE_KEY}\n`, { mode: 0o600 });
		expect(authorizeKey({ path, kind: "user" }, line)).toEqual({ ok: true });
		expect(readFileSync(path, "utf8")).toBe(`# ${FIXTURE_KEY}\n${line}\n`);
	});

	it("recognizes an authorized key behind quoted options that mention another key type", () => {
		const dir = join(freshDir(), ".ssh");
		mkdirSync(dir, { mode: 0o700 });
		const path = join(dir, "authorized_keys");
		const existing = `command="echo ssh-ed25519 fake",no-pty ${FIXTURE_KEY}\n`;
		writeFileSync(path, existing, { mode: 0o600 });
		expect(authorizeKey({ path, kind: "user" }, line)).toEqual({ ok: true });
		expect(readFileSync(path, "utf8")).toBe(existing);
	});

	it("leaves no key behind when restricting a new administrators file fails", () => {
		// icacls does not exist here, so restricting the new file fails.
		const path = join(freshDir(), "ssh", "administrators_authorized_keys");
		expect(authorizeKey({ path, kind: "windows-administrators" }, line)).toMatchObject({ ok: false });
		expect(existsSync(path)).toBe(false);
		expect(readdirSync(join(path, ".."))).toEqual([]);
	});

	it("does not add a key that is already authorized, with any options or comment", () => {
		const dir = join(freshDir(), ".ssh");
		mkdirSync(dir, { mode: 0o700 });
		const path = join(dir, "authorized_keys");
		writeFileSync(path, `${FIXTURE_KEY}\n`, { mode: 0o600 });
		expect(authorizeKey({ path, kind: "user" }, line)).toEqual({ ok: true });
		expect(readFileSync(path, "utf8")).toBe(`${FIXTURE_KEY}\n`);
	});
});

describe("pairing endpoint", () => {
	const CODE = "q7Hn2vJk9sLp4xWc8bZr5t";
	const startSession = (confirm: boolean) =>
		new PairingSession({
			host: { name: "h", address: "127.0.0.1", sshPort: 22, user: "u", hostKey: FIXTURE_FINGERPRINT, pairPort: 0 },
			ports: {
				clock: () => Date.now(),
				randomCode: () => CODE,
				keyFingerprint: fingerprintOfPublicKey,
				confirm: async () => confirm,
				authorizeKey: async () => ({ ok: true }),
			},
			ttlMs: 60_000,
			maxBadAttempts: 5,
		});
	const post = (port: number, body: string) =>
		fetch(`http://127.0.0.1:${port}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body });

	it("pairs once, answers with the host user and identity, and then stops listening", async () => {
		const endpoint = await startPairingEndpoint({ session: startSession(true), address: "127.0.0.1", maxBodyBytes: 4096 });
		const res = await post(endpoint.port, JSON.stringify({ code: CODE, publicKey: FIXTURE_KEY, deviceName: "Phone" }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, user: "u", hostKey: FIXTURE_FINGERPRINT });
		expect(await endpoint.finished).toMatchObject({ ok: true });
		await expect(post(endpoint.port, "{}")).rejects.toThrow();
	});

	it("answers a wrong code with 403 and keeps listening", async () => {
		const endpoint = await startPairingEndpoint({ session: startSession(true), address: "127.0.0.1", maxBodyBytes: 4096 });
		const res = await post(endpoint.port, JSON.stringify({ code: "x".repeat(22), publicKey: FIXTURE_KEY, deviceName: "Phone" }));
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ ok: false, error: "bad_code" });
		expect((await post(endpoint.port, "not json")).status).toBe(400);
		await endpoint.close();
	});

	it("answers anything other than POST /pair with 404 and an oversized body with 413", async () => {
		const endpoint = await startPairingEndpoint({ session: startSession(true), address: "127.0.0.1", maxBodyBytes: 64 });
		expect((await fetch(`http://127.0.0.1:${endpoint.port}/pair`)).status).toBe(404);
		expect((await post(endpoint.port, JSON.stringify({ pad: "x".repeat(200) }))).status).toBe(413);
		await endpoint.close();
	});

	it("counts oversized and unknown requests as wrong attempts and closes after five", async () => {
		const endpoint = await startPairingEndpoint({ session: startSession(true), address: "127.0.0.1", maxBodyBytes: 64 });
		for (let i = 0; i < 4; i++) expect((await post(endpoint.port, JSON.stringify({ pad: "x".repeat(200) }))).status).toBe(413);
		expect((await fetch(`http://127.0.0.1:${endpoint.port}/other`)).status).toBe(404);
		expect(await endpoint.finished).toMatchObject({ ok: false, error: "closed" });
		await expect(post(endpoint.port, JSON.stringify({ code: CODE, publicKey: FIXTURE_KEY, deviceName: "Phone" }))).rejects.toThrow();
	});

	it("authorizes nothing when the phone disconnects while the user is confirming", async () => {
		let release: (value: boolean) => void = () => {};
		let writes = 0;
		const session = new PairingSession({
			host: { name: "h", address: "127.0.0.1", sshPort: 22, user: "u", hostKey: FIXTURE_FINGERPRINT, pairPort: 0 },
			ports: {
				clock: () => Date.now(),
				randomCode: () => CODE,
				keyFingerprint: fingerprintOfPublicKey,
				confirm: () => new Promise<boolean>((resolve) => (release = resolve)),
				authorizeKey: async () => {
					writes++;
					return { ok: true };
				},
			},
			ttlMs: 60_000,
			maxBadAttempts: 5,
		});
		const endpoint = await startPairingEndpoint({ session, address: "127.0.0.1", maxBodyBytes: 4096 });
		const controller = new AbortController();
		const pending = fetch(`http://127.0.0.1:${endpoint.port}/pair`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ code: CODE, publicKey: FIXTURE_KEY, deviceName: "Phone" }),
			signal: controller.signal,
		}).catch(() => "aborted");
		await new Promise((resolve) => setTimeout(resolve, 100));
		controller.abort();
		expect(await pending).toBe("aborted");
		await new Promise((resolve) => setTimeout(resolve, 100));
		release(true);
		expect(await endpoint.finished).toMatchObject({ ok: false, error: "closed" });
		expect(writes).toBe(0);
	});

	it("answers a refusal at the computer with 403 and stops", async () => {
		const endpoint = await startPairingEndpoint({ session: startSession(false), address: "127.0.0.1", maxBodyBytes: 4096 });
		const res = await post(endpoint.port, JSON.stringify({ code: CODE, publicKey: FIXTURE_KEY, deviceName: "Phone" }));
		expect(res.status).toBe(403);
		expect(await endpoint.finished).toMatchObject({ ok: false, error: "rejected" });
	});
});
