import { beforeEach, describe, expect, it } from "vitest";
import type { HostConnection, HostTarget } from "../src/core/ports";
import type { SavedHost } from "../src/core/host-catalog";
import { confirmManualHost, discoverIdentity, type ManualHostDeps, validateManualHost } from "../src/core/manual-host";

const FINGERPRINT = `SHA256:${"C".repeat(43)}`;
const input = { name: "Linux de casa", address: "devbox", user: "mars", sshPort: "22" };

let connects: HostTarget[];
let replies: Awaited<ReturnType<HostConnection["connect"]>>[];
let saved: SavedHost[];
let unlockAnswer: boolean;
let deps: ManualHostDeps;

beforeEach(() => {
	connects = [];
	replies = [];
	saved = [];
	unlockAnswer = true;
	deps = {
		clock: () => 5,
		keyAlias: "app-key",
		newId: () => "host-9",
		unlock: async () => unlockAnswer,
		host: {
			connect: async (target: HostTarget) => {
				connects.push(target);
				return replies.shift()!;
			},
			disconnect: async () => {},
		} as unknown as HostConnection,
		catalog: { list: async () => saved, save: async (h) => void saved.push(h), remove: async () => {} },
	};
});

describe("validateManualHost", () => {
	it("accepts valid details and trims them", () => {
		expect(validateManualHost({ name: " Linux ", address: " devbox ", user: " mars ", sshPort: " 2222 " })).toEqual({
			ok: true,
			value: { name: "Linux", address: "devbox", user: "mars", sshPort: 2222 },
		});
	});

	it("uses the address as the name when no name is given", () => {
		expect(validateManualHost({ ...input, name: "" })).toMatchObject({ ok: true, value: { name: "devbox" } });
	});

	it("reports every invalid field at once", () => {
		expect(validateManualHost({ name: "", address: " ", user: "", sshPort: "70000" })).toEqual({
			ok: false,
			errors: { address: "required", user: "required", sshPort: "invalid" },
		});
	});
});

describe("discoverIdentity", () => {
	it("connects without trusting anything and returns the identity the computer showed", async () => {
		replies = [{ ok: false, code: "HOST_KEY_UNKNOWN", message: "unknown", fingerprint: FINGERPRINT }];
		expect(await discoverIdentity(deps, { name: "Linux de casa", address: "devbox", user: "mars", sshPort: 22 })).toEqual({
			ok: true,
			fingerprint: FINGERPRINT,
		});
		expect(connects).toEqual([
			{ host: "devbox", fallbackHost: null, port: 22, username: "mars", keyAlias: "app-key", expectedFingerprint: null },
		]);
	});

	it("passes on a connection failure, such as an unreachable computer", async () => {
		replies = [{ ok: false, code: "UNREACHABLE", message: "Cannot reach devbox:22." }];
		expect(await discoverIdentity(deps, { name: "x", address: "devbox", user: "mars", sshPort: 22 })).toEqual({
			ok: false,
			code: "UNREACHABLE",
			message: "Cannot reach devbox:22.",
		});
	});
});

describe("confirmManualHost", () => {
	const details = { name: "Linux de casa", address: "devbox", user: "mars", sshPort: 22 };

	it("unlocks, connects with the identity the user confirmed, and saves the computer", async () => {
		replies = [{ ok: true, connectionId: "c1", fingerprint: FINGERPRINT, address: "devbox" }];
		const host: SavedHost = { keyAlias: "app-key", rotation: { phase: "done" }, id: "host-9", name: "Linux de casa", address: "devbox", sshPort: 22, user: "mars", hostKey: FINGERPRINT, addedAt: 5 };
		expect(await confirmManualHost(deps, details, FINGERPRINT)).toEqual({ ok: true, host });
		expect(connects[0]).toMatchObject({ expectedFingerprint: FINGERPRINT });
		expect(saved).toEqual([host]);
	});

	it("saves nothing when the key is not yet authorized on the computer", async () => {
		replies = [{ ok: false, code: "AUTH_FAILED", message: "The host did not accept the app's key for mars." }];
		expect(await confirmManualHost(deps, details, FINGERPRINT)).toEqual({
			ok: false,
			code: "AUTH_FAILED",
			message: "The host did not accept the app's key for mars.",
		});
		expect(saved).toEqual([]);
	});

	it("saves nothing when the unlock is cancelled", async () => {
		unlockAnswer = false;
		expect(await confirmManualHost(deps, details, FINGERPRINT)).toMatchObject({ ok: false, code: "UNLOCK_REQUIRED" });
		expect(connects).toEqual([]);
		expect(saved).toEqual([]);
	});
});
