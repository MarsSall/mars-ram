import { beforeEach, describe, expect, it } from "vitest";
import { PAIRING_VERSION } from "@workspace/protocol";
import { PairingSession } from "../../src/core/pairing-session.ts";
import type { PairingPorts } from "../../src/core/ports.ts";

const CODE = "q7Hn2vJk9sLp4xWc8bZr5t";
const KEY = "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTY phone-app";
const host = { name: "devbox", address: "100.64.0.10", sshPort: 22, user: "mars", hostKey: `SHA256:${"A".repeat(43)}`, pairPort: 47123 };

let now: number;
let answers: boolean[];
let confirmations: { deviceName: string; keyFingerprint: string }[];
let authorized: { publicKey: string; deviceName: string }[];
let authorizeResult: { ok: true } | { ok: false; message: string };
let session: PairingSession;

const ports = (): PairingPorts => ({
	clock: () => now,
	randomCode: () => CODE,
	keyFingerprint: () => "SHA256:phonekey",
	confirm: async (device) => {
		confirmations.push(device);
		return answers.shift() ?? false;
	},
	authorizeKey: async (publicKey, deviceName) => {
		authorized.push({ publicKey, deviceName });
		return authorizeResult;
	},
});

const request = (overrides: Record<string, unknown> = {}) => ({ code: CODE, publicKey: KEY, deviceName: "Galaxy S24 Ultra", ...overrides });

beforeEach(() => {
	now = 1_000;
	answers = [true];
	confirmations = [];
	authorized = [];
	authorizeResult = { ok: true };
	session = new PairingSession({ host, ports: ports(), ttlMs: 5 * 60_000, maxBadAttempts: 5 });
});

describe("offer", () => {
	it("carries the host, a fresh code, and the expiry", () => {
		expect(session.offer()).toEqual({ v: PAIRING_VERSION, ...host, code: CODE, expiresAt: 1_000 + 5 * 60_000 });
	});
});

describe("pairing", () => {
	it("authorizes the key after the user confirms on the computer, then closes", async () => {
		expect(await session.handle(request())).toEqual({ ok: true, user: "mars", hostKey: host.hostKey });
		expect(confirmations).toEqual([{ deviceName: "Galaxy S24 Ultra", keyFingerprint: "SHA256:phonekey" }]);
		expect(authorized).toEqual([{ publicKey: KEY, deviceName: "Galaxy S24 Ultra" }]);
		expect(session.state).toBe("paired");
		expect(await session.handle(request())).toMatchObject({ ok: false, error: "closed" });
		expect(authorized).toHaveLength(1);
	});

	it("authorizes nothing and closes when the user declines", async () => {
		answers = [false];
		expect(await session.handle(request())).toMatchObject({ ok: false, error: "rejected" });
		expect(authorized).toEqual([]);
		expect(session.state).toBe("closed");
	});

	it("rejects a wrong code without asking the user, and closes after the maximum of wrong attempts", async () => {
		for (let i = 1; i <= 4; i++) {
			expect(await session.handle(request({ code: "x".repeat(22) }))).toMatchObject({ ok: false, error: "bad_code" });
			expect(session.state).toBe("open");
		}
		expect(await session.handle(request({ code: "x".repeat(22) }))).toMatchObject({ ok: false, error: "bad_code" });
		expect(session.state).toBe("closed");
		expect(await session.handle(request())).toMatchObject({ ok: false, error: "closed" });
		expect(confirmations).toEqual([]);
		expect(authorized).toEqual([]);
	});

	it("counts a malformed request as a wrong attempt", async () => {
		expect(await session.handle({ code: CODE, publicKey: `command="sh" ${KEY}`, deviceName: "x" })).toMatchObject({ ok: false, error: "bad_request" });
		expect(session.badAttempts).toBe(1);
		expect(confirmations).toEqual([]);
	});

	it("rejects and closes once the offer expired", async () => {
		now = 1_000 + 5 * 60_000 + 1;
		expect(await session.handle(request())).toMatchObject({ ok: false, error: "expired" });
		expect(session.state).toBe("closed");
		expect(confirmations).toEqual([]);
	});

	it("rejects a second phone while the user is still confirming the first", async () => {
		let release: (value: boolean) => void = () => {};
		session = new PairingSession({
			host,
			ports: { ...ports(), confirm: () => new Promise<boolean>((resolve) => (release = resolve)) },
			ttlMs: 60_000,
			maxBadAttempts: 5,
		});
		const first = session.handle(request());
		expect(await session.handle(request({ deviceName: "Other phone" }))).toMatchObject({ ok: false, error: "closed" });
		release(true);
		expect(await first).toMatchObject({ ok: true });
	});

	it("authorizes nothing when pairing was cancelled while the user was confirming", async () => {
		let release: (value: boolean) => void = () => {};
		session = new PairingSession({
			host,
			ports: { ...ports(), confirm: () => new Promise<boolean>((resolve) => (release = resolve)) },
			ttlMs: 60_000,
			maxBadAttempts: 5,
		});
		const pending = session.handle(request());
		session.close();
		release(true);
		expect(await pending).toMatchObject({ ok: false, error: "closed" });
		expect(authorized).toEqual([]);
		expect(session.state).toBe("closed");
	});

	it("authorizes nothing when the code expired while the user was confirming", async () => {
		let release: (value: boolean) => void = () => {};
		session = new PairingSession({
			host,
			ports: { ...ports(), confirm: () => new Promise<boolean>((resolve) => (release = resolve)) },
			ttlMs: 60_000,
			maxBadAttempts: 5,
		});
		const pending = session.handle(request());
		now += 60_001;
		release(true);
		expect(await pending).toMatchObject({ ok: false, error: "expired" });
		expect(authorized).toEqual([]);
		expect(session.state).toBe("closed");
	});

	it("authorizes nothing when the phone stopped waiting before the user confirmed", async () => {
		expect(await session.handle(request(), () => false)).toMatchObject({ ok: false, error: "closed" });
		expect(confirmations).toHaveLength(1);
		expect(authorized).toEqual([]);
		expect(session.state).toBe("closed");
	});

	it("counts requests the endpoint rejects before reading them as wrong attempts", () => {
		for (let i = 0; i < 4; i++) session.countBadAttempt();
		expect(session.state).toBe("open");
		session.countBadAttempt();
		expect(session.state).toBe("closed");
	});

	it("reports a failure to write the key and closes", async () => {
		authorizeResult = { ok: false, message: "Permission denied" };
		expect(await session.handle(request())).toEqual({ ok: false, error: "internal", message: "The computer could not authorize the key: Permission denied" });
		expect(session.state).toBe("closed");
	});
});
