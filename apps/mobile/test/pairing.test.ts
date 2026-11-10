import { beforeEach, describe, expect, it } from "vitest";
import { encodePairingUri, PAIRING_VERSION, type PairingOffer } from "@workspace/protocol";
import { pairWithComputer, type PairingDeps } from "../src/core/pairing";
import type { HostConnection, HostTarget } from "../src/core/ports";
import type { SavedHost } from "../src/core/host-catalog";

const offer: PairingOffer = {
	v: PAIRING_VERSION,
	name: "devbox",
	address: "100.64.0.10",
	dnsName: "devbox.example-tailnet.ts.net",
	sshPort: 22,
	user: "mars",
	hostKey: `SHA256:${"B".repeat(43)}`,
	pairPort: 47123,
	code: "q7Hn2vJk9sLp4xWc8bZr5t",
	expiresAt: 10_000,
};
const PUBLIC_KEY = "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTY app";

let probes: { address: string; port: number }[];
let probeAnswer: boolean;
let nameProbeAnswer: boolean;
let posts: { url: string; body: unknown; timeoutMs: number }[];
let postReply: { status: number; json: unknown } | Error;
let connects: HostTarget[];
let connectReply: Awaited<ReturnType<HostConnection["connect"]>>;
let disconnects: string[];
let saved: SavedHost[];
let unlocks: number;
let unlockAnswer: boolean;
let deps: PairingDeps;

beforeEach(() => {
	probes = [];
	probeAnswer = true;
	nameProbeAnswer = true;
	posts = [];
	postReply = { status: 200, json: { ok: true, user: "mars", hostKey: offer.hostKey } };
	connects = [];
	connectReply = { ok: true, connectionId: "c1", fingerprint: offer.hostKey, address: offer.dnsName! };
	disconnects = [];
	saved = [];
	unlocks = 0;
	unlockAnswer = true;
	deps = {
		clock: () => 1_000,
		deviceName: "Galaxy S24 Ultra",
		keyAlias: "app-key",
		appKey: { ensure: async () => ({ publicKey: PUBLIC_KEY }) },
		probe: async (address, port) => {
			probes.push({ address, port });
			return address === offer.address ? probeAnswer : nameProbeAnswer;
		},
		http: {
			postJson: async (url, body, timeoutMs) => {
				posts.push({ url, body, timeoutMs });
				if (postReply instanceof Error) throw postReply;
				return postReply;
			},
		},
		host: {
			connect: async (target: HostTarget) => {
				connects.push(target);
				return connectReply;
			},
			disconnect: async (id: string) => void disconnects.push(id),
		} as unknown as HostConnection,
		catalog: {
			list: async () => saved,
			save: async (host) => void saved.push(host),
			remove: async () => {},
		},
		newId: () => "host-1",
		unlock: async () => {
			unlocks++;
			return unlockAnswer;
		},
	};
});

describe("pairWithComputer", () => {
	it("sends only the public key and code, connects expecting the QR's identity, and saves the computer", async () => {
		const result = await pairWithComputer(deps, encodePairingUri(offer));
		expect(posts).toEqual([
			// The computer answers only after its user confirms, so the phone waits until the code expires.
			{ url: "http://devbox.example-tailnet.ts.net:47123/pair", body: { code: offer.code, publicKey: PUBLIC_KEY, deviceName: "Galaxy S24 Ultra" }, timeoutMs: 9_000 },
		]);
		expect(connects).toEqual([
			{ host: "devbox.example-tailnet.ts.net", fallbackHost: "100.64.0.10", port: 22, username: "mars", keyAlias: "app-key", expectedFingerprint: offer.hostKey },
		]);
		expect(disconnects).toEqual(["c1"]);
		const host: SavedHost = {
			keyAlias: "app-key",
			rotation: { phase: "done" },
			id: "host-1",
			name: "devbox",
			address: "100.64.0.10",
			dnsName: "devbox.example-tailnet.ts.net",
			sshPort: 22,
			user: "mars",
			hostKey: offer.hostKey,
			addedAt: 1_000,
		};
		expect(saved).toEqual([host]);
		expect(result).toEqual({ ok: true, host });
	});

	it("asks to unlock the key after the computer accepts it, so the unlock is fresh when connecting", async () => {
		await pairWithComputer(deps, encodePairingUri(offer));
		expect(unlocks).toBe(1);
	});

	it("does not ask to unlock when the computer refused", async () => {
		postReply = { status: 403, json: { ok: false, error: "rejected", message: "The computer did not authorize this phone." } };
		await pairWithComputer(deps, encodePairingUri(offer));
		expect(unlocks).toBe(0);
	});

	it("saves nothing when the user cancels the unlock", async () => {
		unlockAnswer = false;
		expect(await pairWithComputer(deps, encodePairingUri(offer))).toEqual({
			ok: false,
			step: "connect",
			code: "UNLOCK_REQUIRED",
			message: "The phone was not unlocked, so the computer was not saved. Show a new code on the computer and try again.",
		});
		expect(connects).toEqual([]);
		expect(saved).toEqual([]);
	});

	it.each([
		["a QR from another app", "otherapp://pair?p=x", "This QR is not a pairing code for this app."],
	])("refuses %s before contacting anything", async (_name, uri, message) => {
		expect(await pairWithComputer(deps, uri)).toEqual({ ok: false, step: "scan", code: "INVALID_QR", message });
		expect(posts).toEqual([]);
	});

	it("refuses an expired code before contacting the computer", async () => {
		deps.clock = () => 20_000;
		expect(await pairWithComputer(deps, encodePairingUri(offer))).toEqual({
			ok: false,
			step: "scan",
			code: "CODE_EXPIRED",
			message: "This pairing code expired. Show a new one on the computer.",
		});
		expect(posts).toEqual([]);
	});

	it("sends the key to the computer's MagicDNS name, lowercase and without the trailing dot", async () => {
		await pairWithComputer(deps, encodePairingUri({ ...offer, dnsName: "Mars.Tail1234.ts.net." }));
		expect(posts.map((post) => post.url)).toEqual(["http://mars.tail1234.ts.net:47123/pair"]);
	});

	it.each([
		["no MagicDNS name", undefined],
		["an empty name", ""],
		["a name outside ts.net", "evil.example.com"],
		["an IP address", "100.64.1.2"],
		["an empty label", "a..ts.net"],
		["ts.net itself", "ts.net"],
		["a name that only ends like ts.net", "evilts.net"],
		["a label with other characters", "mars_1.tail1234.ts.net"],
		["a port", "mars.tail1234.ts.net:80"],
		["a path", "mars.tail1234.ts.net/x"],
		["two trailing dots", "mars.tail1234.ts.net.."],
		["a label starting with a hyphen", "-mars.tail1234.ts.net"],
		["a label ending with a hyphen", "mars-.tail1234.ts.net"],
		["an all-hyphen label", "mars.---.ts.net"],
	])("asks to turn on MagicDNS, before any network request, for %s", async (_name, dnsName) => {
		const { dnsName: _drop, ...withoutName } = offer;
		const scanned: PairingOffer = dnsName === undefined ? withoutName : { ...offer, dnsName };
		expect(await pairWithComputer(deps, encodePairingUri(scanned))).toEqual({
			ok: false,
			step: "scan",
			code: "MAGICDNS_REQUIRED",
			message: "Turn on MagicDNS in Tailscale (admin console › DNS) and run mars-ram pair again.",
		});
		expect(probes).toEqual([]);
		expect(posts).toEqual([]);
		expect(unlocks).toBe(0);
		expect(saved).toEqual([]);
	});

	it("names what went wrong when the computer answers something unexpected", async () => {
		postReply = { status: 200, json: { hello: "world" } };
		expect(await pairWithComputer(deps, encodePairingUri(offer))).toEqual({
			ok: false,
			step: "send-key",
			code: "UNEXPECTED_ANSWER",
			message: "The computer answered something unexpected.",
		});
	});

	it.each([
		["expired", "CODE_EXPIRED"],
		["closed", "PAIRING_CLOSED"],
		["bad_code", "PAIRING_CLOSED"],
		["bad_request", "PAIRING_CLOSED"],
		["internal", "PAIRING_CLOSED"],
	] as const)("names the computer's %s refusal so the screen can explain it", async (error, code) => {
		postReply = { status: 409, json: { ok: false, error, message: "From the computer." } };
		expect(await pairWithComputer(deps, encodePairingUri(offer))).toEqual({ ok: false, step: "send-key", code, message: "From the computer." });
	});

	it("checks that the computer answers, first at its address and then by its name, before sending the key", async () => {
		await pairWithComputer(deps, encodePairingUri(offer));
		expect(probes).toEqual([
			{ address: "100.64.0.10", port: 22 },
			{ address: "devbox.example-tailnet.ts.net", port: 22 },
		]);
		expect(posts).toHaveLength(1);
	});

	it("stops right away when the phone cannot find the computer by its name, and asks to turn off Private DNS", async () => {
		nameProbeAnswer = false;
		expect(await pairWithComputer(deps, encodePairingUri(offer))).toEqual({
			ok: false,
			step: "send-key",
			code: "PRIVATE_DNS",
			message: "Your phone can't find the computer by its Tailscale name. Turn off Private DNS: Settings › Connections › More connection settings › Private DNS › Off.",
		});
		expect(probes).toEqual([
			{ address: "100.64.0.10", port: 22 },
			{ address: "devbox.example-tailnet.ts.net", port: 22 },
		]);
		expect(posts).toEqual([]);
		expect(unlocks).toBe(0);
		expect(saved).toEqual([]);
	});

	it("tells when it starts looking for the computer and when the computer answered and waits for its user", async () => {
		const stages: unknown[] = [];
		deps.onProgress = (stage) => {
			stages.push(stage);
			// The confirmation stage starts only after both probes and before the key request.
			if (stage.stage === "confirming") expect({ probes: probes.length, posts: posts.length }).toEqual({ probes: 2, posts: 0 });
		};
		await pairWithComputer(deps, encodePairingUri(offer));
		expect(stages).toEqual([
			{ stage: "reaching", computerName: "devbox", deviceName: "Galaxy S24 Ultra" },
			{ stage: "confirming", computerName: "devbox", deviceName: "Galaxy S24 Ultra" },
		]);
	});

	it("never says the computer answered when it could not be reached", async () => {
		const stages: string[] = [];
		deps.onProgress = (stage) => void stages.push(stage.stage);
		probeAnswer = false;
		await pairWithComputer(deps, encodePairingUri(offer));
		nameProbeAnswer = false;
		probeAnswer = true;
		await pairWithComputer(deps, encodePairingUri(offer));
		expect(stages).toEqual(["reaching", "reaching"]);
	});

	it("stops right away when the computer does not answer, instead of waiting for the code to expire", async () => {
		probeAnswer = false;
		expect(await pairWithComputer(deps, encodePairingUri(offer))).toEqual({
			ok: false,
			step: "send-key",
			code: "UNREACHABLE",
			message: "Cannot reach the computer. Check that Tailscale is on in this phone and the computer is on, then scan again.",
		});
		// The name is not checked when the address already does not answer.
		expect(probes).toEqual([{ address: "100.64.0.10", port: 22 }]);
		expect(posts).toEqual([]);
		expect(unlocks).toBe(0);
		expect(saved).toEqual([]);
	});

	it("explains when the computer cannot be reached over the tailnet", async () => {
		postReply = new Error("Network request failed");
		expect(await pairWithComputer(deps, encodePairingUri(offer))).toEqual({
			ok: false,
			step: "send-key",
			code: "SEND_FAILED",
			message: "Cannot reach the computer. Check that the phone is on the tailnet and the pairing code is still on screen.",
		});
		expect(saved).toEqual([]);
	});

	it("passes on the computer's reason when it refuses, and saves nothing", async () => {
		postReply = { status: 403, json: { ok: false, error: "rejected", message: "The computer did not authorize this phone." } };
		expect(await pairWithComputer(deps, encodePairingUri(offer))).toEqual({
			ok: false,
			step: "send-key",
			code: "REFUSED",
			message: "The computer did not authorize this phone.",
		});
		expect(connects).toEqual([]);
		expect(saved).toEqual([]);
	});

	it("refuses to save when the identity seen differs from the QR's", async () => {
		connectReply = { ok: false, code: "HOST_KEY_CHANGED", message: "The host identity is SHA256:x.", fingerprint: "SHA256:x", expected: offer.hostKey };
		expect(await pairWithComputer(deps, encodePairingUri(offer))).toEqual({
			ok: false,
			step: "connect",
			code: "HOST_KEY_CHANGED",
			message: "The computer that answered is not the one in the QR. It was not saved.",
		});
		expect(saved).toEqual([]);
	});

	it("reports a connection failure after pairing with its own code, and saves nothing", async () => {
		connectReply = { ok: false, code: "UNLOCK_REQUIRED", message: "Unlock the phone to use the SSH key." };
		expect(await pairWithComputer(deps, encodePairingUri(offer))).toEqual({
			ok: false,
			step: "connect",
			code: "UNLOCK_REQUIRED",
			message: "Unlock the phone to use the SSH key.",
		});
		expect(saved).toEqual([]);
	});
});
