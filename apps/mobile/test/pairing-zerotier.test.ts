import { beforeEach, describe, expect, it } from "vitest";
import { encodePairingUri, PAIRING_VERSION, ZEROTIER_PAIRING_VERSION, type PairingOffer, type ZeroTierPairingOffer } from "@workspace/protocol";
import { pairWithComputer, type PairingDeps, type VpnPairReply } from "../src/core/pairing";
import { pairingFailureMessage } from "../src/core/pair-link";
import { diagnose, diagnosisOffered } from "../src/core/connect-wizard";
import type { PhoneNetworkState } from "../src/core/phone-network";
import type { HostConnection, HostTarget } from "../src/core/ports";
import type { SavedHost } from "../src/core/host-catalog";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

const offer: ZeroTierPairingOffer = {
	v: ZEROTIER_PAIRING_VERSION,
	network: "zerotier",
	name: "devbox",
	address: "10.147.17.5",
	sshPort: 22,
	user: "mars",
	hostKey: `SHA256:${"B".repeat(43)}`,
	pairPort: 47123,
	code: "q7Hn2vJk9sLp4xWc8bZr5t",
	expiresAt: 10_000,
};
const tailscaleOffer: PairingOffer = {
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
let fetchPosts: string[];
let vpnPosts: { address: string; port: number; body: unknown; timeoutMs: number }[];
let vpnReply: VpnPairReply | Error;
let connects: HostTarget[];
let saved: SavedHost[];
let unlocks: number;
let deps: PairingDeps;

beforeEach(() => {
	probes = [];
	probeAnswer = true;
	fetchPosts = [];
	vpnPosts = [];
	vpnReply = { ok: true, status: 200, body: JSON.stringify({ ok: true, user: "mars", hostKey: offer.hostKey }) };
	connects = [];
	saved = [];
	unlocks = 0;
	deps = {
		clock: () => 1_000,
		deviceName: "Galaxy S24 Ultra",
		keyAlias: "app-key",
		appKey: { ensure: async () => ({ publicKey: PUBLIC_KEY }) },
		probe: async (address, port) => {
			probes.push({ address, port });
			return probeAnswer;
		},
		http: {
			postJson: async (url) => {
				fetchPosts.push(url);
				return { status: 200, json: { ok: true, user: "mars", hostKey: offer.hostKey } };
			},
		},
		vpnPost: async (address, port, body, timeoutMs) => {
			vpnPosts.push({ address, port, body: JSON.parse(body), timeoutMs });
			if (vpnReply instanceof Error) throw vpnReply;
			return vpnReply;
		},
		host: {
			connect: async (target: HostTarget) => {
				connects.push(target);
				return { ok: true, connectionId: "c1", fingerprint: offer.hostKey, address: offer.address };
			},
			disconnect: async () => {},
		} as unknown as HostConnection,
		catalog: { list: async () => saved, save: async (host) => void saved.push(host), remove: async () => {} },
		newId: () => "host-1",
		unlock: async () => {
			unlocks++;
			return true;
		},
	};
});

const pair = (scanned: ZeroTierPairingOffer = offer) => pairWithComputer(deps, encodePairingUri(scanned));

describe("pairing over ZeroTier", () => {
	it("probes only the offer's address, sends the key natively to exactly its address and pair port, and saves a ZeroTier computer", async () => {
		const result = await pair();
		expect(probes).toEqual([{ address: "10.147.17.5", port: 22 }]);
		expect(vpnPosts).toEqual([
			{ address: "10.147.17.5", port: 47123, body: { code: offer.code, publicKey: PUBLIC_KEY, deviceName: "Galaxy S24 Ultra" }, timeoutMs: 9_000 },
		]);
		// Never through fetch: Android's cleartext policy permits only ts.net names.
		expect(fetchPosts).toEqual([]);
		expect(connects).toEqual([
			{ host: "10.147.17.5", fallbackHost: null, port: 22, username: "mars", keyAlias: "app-key", expectedFingerprint: offer.hostKey },
		]);
		const host: SavedHost = {
			id: "host-1",
			keyAlias: "app-key",
			rotation: { phase: "done" },
			name: "devbox",
			address: "10.147.17.5",
			network: "zerotier",
			sshPort: 22,
			user: "mars",
			hostKey: offer.hostKey,
			addedAt: 1_000,
		};
		expect(saved).toEqual([host]);
		expect(result).toEqual({ ok: true, host });
	});

	it("never asks for MagicDNS or checks a Tailscale name", async () => {
		const result = await pair();
		expect(result.ok).toBe(true);
		expect(probes.map((probe) => probe.address)).toEqual(["10.147.17.5"]);
	});

	it("explains, for ZeroTier, when the computer does not answer, before sending anything", async () => {
		probeAnswer = false;
		expect(await pair()).toEqual({
			ok: false,
			step: "send-key",
			code: "UNREACHABLE",
			network: "zerotier",
			message: "Cannot reach the computer. Check that ZeroTier is on in this phone and joined to the computer's network, then scan again.",
		});
		expect(vpnPosts).toEqual([]);
		expect(unlocks).toBe(0);
	});

	it("asks to turn on ZeroTier when the computer's address is not routed through the phone's VPN", async () => {
		vpnReply = { ok: false, code: "NOT_ON_VPN" };
		expect(await pair()).toEqual({
			ok: false,
			step: "send-key",
			code: "NOT_ON_VPN",
			network: "zerotier",
			message: "This phone doesn't reach the computer over ZeroTier. Turn on ZeroTier on the phone and join the same network.",
		});
		expect(unlocks).toBe(0);
		expect(saved).toEqual([]);
	});

	it.each([
		["a failed native request", { ok: false, code: "SEND_FAILED" } as const],
		["a thrown native request", new Error("module missing")],
	])("reports %s as SEND_FAILED and saves nothing", async (_name, reply) => {
		vpnReply = reply;
		expect(await pair()).toEqual({
			ok: false,
			step: "send-key",
			code: "SEND_FAILED",
			network: "zerotier",
			message: "Cannot reach the computer. Check that ZeroTier is still on in this phone and the pairing code is still on screen.",
		});
		expect(saved).toEqual([]);
	});

	it("fails safely when this build has no native ZeroTier request", async () => {
		delete deps.vpnPost;
		expect(await pair()).toMatchObject({ ok: false, step: "send-key", code: "SEND_FAILED" });
		expect(fetchPosts).toEqual([]);
	});

	it.each([
		["not JSON", "<html>"],
		["another shape", JSON.stringify({ hello: "world" })],
	])("names an answer that is %s as unexpected", async (_name, body) => {
		vpnReply = { ok: true, status: 200, body };
		expect(await pair()).toEqual({ ok: false, step: "send-key", code: "UNEXPECTED_ANSWER", network: "zerotier", message: "The computer answered something unexpected." });
	});

	it("passes on the computer's refusal with its code", async () => {
		vpnReply = { ok: true, status: 403, body: JSON.stringify({ ok: false, error: "rejected", message: "Not authorized." }) };
		expect(await pair()).toEqual({ ok: false, step: "send-key", code: "REFUSED", network: "zerotier", message: "Not authorized." });
		expect(connects).toEqual([]);
	});

	it("keeps the QR's host identity pin", async () => {
		deps.host.connect = async () => ({ ok: false, code: "HOST_KEY_CHANGED", message: "x", fingerprint: "SHA256:x", expected: offer.hostKey });
		expect(await pair()).toMatchObject({ ok: false, step: "connect", code: "HOST_KEY_CHANGED" });
		expect(saved).toEqual([]);
	});

	it.each(["TIMEOUT", "UNREACHABLE", "HOST_NOT_FOUND"] as const)(
		"keeps the offer's network when the first SSH connection fails with %s, so the diagnosis talks about ZeroTier",
		async (code) => {
			deps.host.connect = async () => ({ ok: false, code, message: "x" });
			const result = await pair();
			expect(result).toEqual({ ok: false, step: "connect", code, network: "zerotier", message: "x" });
			expect(saved).toEqual([]);
			if (result.ok) throw new Error("expected a failure");
			expect(diagnosisOffered(result.code)).toBe(true);
			const ztOff: PhoneNetworkState = { tailscaleInstalled: true, tailscaleOn: true, privateDnsActive: true, zerotierInstalled: true, vpnOn: true };
			// Tailscale holds the VPN: ZeroTier's guidance, never Tailscale's or Private DNS's.
			expect(diagnose(result, ztOff, result.network ?? "tailscale")).toBe("zerotier_off");
		},
	);

	it("keeps the offer's network when the phone was not unlocked or the host key changed", async () => {
		deps.unlock = async () => false;
		expect(await pair()).toMatchObject({ ok: false, step: "connect", code: "UNLOCK_REQUIRED", network: "zerotier" });
		deps.unlock = async () => true;
		deps.host.connect = async () => ({ ok: false, code: "HOST_KEY_CHANGED", message: "x", fingerprint: "SHA256:x", expected: offer.hostKey });
		expect(await pair()).toMatchObject({ ok: false, step: "connect", code: "HOST_KEY_CHANGED", network: "zerotier" });
	});

	it("never uses the native ZeroTier request for a Tailscale offer", async () => {
		const result = await pairWithComputer(deps, encodePairingUri(tailscaleOffer));
		expect(result.ok).toBe(true);
		expect(vpnPosts).toEqual([]);
		expect(fetchPosts).toEqual(["http://devbox.example-tailnet.ts.net:47123/pair"]);
		expect(saved[0]).not.toHaveProperty("network");
	});
});

describe("ZeroTier pairing failure text", () => {
	it("asks to turn on ZeroTier in both languages", () => {
		expect(pairingFailureMessage({ code: "NOT_ON_VPN", network: "zerotier", message: "x" }, es.add)).toBe(
			"Este teléfono no llega a la computadora por ZeroTier. Prendé ZeroTier en el teléfono y uníte a la misma red.",
		);
		expect(pairingFailureMessage({ code: "NOT_ON_VPN", network: "zerotier", message: "x" }, en.add)).toBe(
			"This phone doesn't reach the computer over ZeroTier. Turn on ZeroTier on the phone and join the same network.",
		);
	});

	it.each(["UNREACHABLE", "SEND_FAILED"] as const)("talks about ZeroTier, not Tailscale, for %s", (code) => {
		for (const strings of [es.add, en.add]) {
			const text = pairingFailureMessage({ code, network: "zerotier", message: "x" }, strings);
			expect(text).toContain("ZeroTier");
			expect(text).not.toMatch(/Tailscale|tailnet/);
		}
		// A Tailscale failure keeps today's text.
		expect(pairingFailureMessage({ code, message: "x" }, en.add)).toBe(code === "UNREACHABLE" ? en.add.unreachable : en.add.failures.SEND_FAILED);
	});
});
