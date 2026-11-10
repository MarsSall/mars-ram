import { describe, expect, it } from "vitest";
import {
	APP_ID,
	decodeNetworkPairingUri,
	decodePairingRequest,
	decodePairingUri,
	encodePairingUri,
	PAIRING_VERSION,
	ZEROTIER_PAIRING_VERSION,
	type PairingOffer,
	type ZeroTierPairingOffer,
} from "../src/index.ts";

const offer: PairingOffer = {
	v: PAIRING_VERSION,
	name: "devbox",
	address: "100.64.0.10",
	dnsName: "devbox.example-tailnet.ts.net",
	sshPort: 22,
	user: "mars",
	hostKey: "SHA256:qRVphWsodSTgaiccfTUZnEG1F5sNV42gPqC+/Bl35B8",
	pairPort: 47123,
	code: "q7Hn2vJk9sLp4xWc8bZr5t",
	expiresAt: 1_800_000_000_000,
};

describe("pairing URI", () => {
	it("round-trips an offer through the app's own link scheme", () => {
		const uri = encodePairingUri(offer);
		expect(uri.startsWith(`${APP_ID}://pair?p=`)).toBe(true);
		expect(decodePairingUri(uri)).toEqual({ ok: true, value: offer });
	});

	it("keeps non-ASCII host names intact", () => {
		const named = { ...offer, name: "Computadora de Ñandú" };
		expect(decodePairingUri(encodePairingUri(named))).toEqual({ ok: true, value: named });
	});

	it("uses only URL-safe characters in the payload", () => {
		const payload = encodePairingUri(offer).split("?p=")[1]!;
		expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it.each([
		["another app's link", "otherapp://pair?p=abc", "This QR is not a pairing code for this app."],
		["a link without a payload", `${APP_ID}://pair`, "This QR is not a pairing code for this app."],
		["a payload that is not valid", `${APP_ID}://pair?p=%%%`, "This pairing code is damaged. Show a new one on the computer."],
	])("rejects %s with a clear message", (_name, uri, message) => {
		expect(decodePairingUri(uri)).toEqual({ ok: false, message });
	});

	it("rejects a pairing version it does not support", () => {
		const uri = encodePairingUri({ ...offer, v: 2 } as unknown as PairingOffer);
		expect(decodePairingUri(uri)).toEqual({
			ok: false,
			message: "This pairing code needs a newer version of the app.",
		});
	});

	it("rejects an offer whose host identity is not an OpenSSH SHA256 fingerprint", () => {
		const uri = encodePairingUri({ ...offer, hostKey: "MD5:aa:bb" });
		expect(decodePairingUri(uri)).toEqual({ ok: false, message: "This pairing code is damaged. Show a new one on the computer." });
	});
});

// Installed apps and hosts read this exact encoding: a Tailscale offer must keep producing it.
const GOLDEN_V1 =
	"mars-ram://pair?p=eyJ2IjoxLCJuYW1lIjoiZGV2Ym94IiwiYWRkcmVzcyI6IjEwMC42NC4wLjEwIiwiZG5zTmFtZSI6ImRldmJveC5leGFtcGxlLXRhaWxuZXQudHMubmV0Iiwic3NoUG9ydCI6MjIsInVzZXIiOiJtYXJzIiwiaG9zdEtleSI6IlNIQTI1NjpxUlZwaFdzb2RTVGdhaWNjZlRVWm5FRzFGNXNOVjQyZ1BxQysvQmwzNUI4IiwicGFpclBvcnQiOjQ3MTIzLCJjb2RlIjoicTdIbjJ2Sms5c0xwNHhXYzhiWnI1dCIsImV4cGlyZXNBdCI6MTgwMDAwMDAwMDAwMH0";

const zerotier: ZeroTierPairingOffer = {
	v: ZEROTIER_PAIRING_VERSION,
	network: "zerotier",
	name: "devbox",
	address: "10.147.17.5",
	sshPort: 22,
	user: "mars",
	hostKey: offer.hostKey,
	pairPort: 47123,
	code: offer.code,
	expiresAt: offer.expiresAt,
};

const damaged = { ok: false, message: "This pairing code is damaged. Show a new one on the computer." };

describe("pairing offer versions", () => {
	it("keeps encoding a Tailscale offer as version 1, byte for byte", () => {
		expect(PAIRING_VERSION).toBe(1);
		expect(encodePairingUri(offer)).toBe(GOLDEN_V1);
	});

	it("decodes a version 1 offer as a Tailscale offer, unchanged", () => {
		expect(decodeNetworkPairingUri(GOLDEN_V1)).toEqual({ ok: true, network: "tailscale", value: offer });
		expect(decodePairingUri(GOLDEN_V1)).toEqual({ ok: true, value: offer });
	});

	it("encodes a ZeroTier offer as version 2 with its network and no MagicDNS name", () => {
		const uri = encodePairingUri(zerotier);
		const json = JSON.parse(Buffer.from(uri.split("?p=")[1]!, "base64url").toString("utf8"));
		expect(json).toEqual({ ...zerotier, v: 2, network: "zerotier" });
		expect(json).not.toHaveProperty("dnsName");
	});

	it("decodes a version 2 offer as a ZeroTier offer", () => {
		expect(decodeNetworkPairingUri(encodePairingUri(zerotier))).toEqual({ ok: true, network: "zerotier", value: zerotier });
	});

	it("lets a Tailscale-only reader reject a version 2 offer with an update message", () => {
		expect(decodePairingUri(encodePairingUri(zerotier))).toEqual({ ok: false, message: "This pairing code needs a newer version of the app." });
	});

	it.each([3, 0, "2"])("rejects pairing version %j with an update message", (v) => {
		const uri = encodePairingUri({ ...zerotier, v } as unknown as ZeroTierPairingOffer);
		expect(decodeNetworkPairingUri(uri)).toEqual({ ok: false, message: "This pairing code needs a newer version of the app." });
	});

	it.each([
		["a MagicDNS name", { ...zerotier, dnsName: "devbox.example-tailnet.ts.net" }],
		["another network", { ...zerotier, network: "tailscale" }],
		["a missing network", { ...zerotier, network: undefined }],
		["a host name instead of an address", { ...zerotier, address: "devbox.example.com" }],
		["an IPv6 address", { ...zerotier, address: "fd00::5" }],
		["an IPv4 part above 255", { ...zerotier, address: "10.147.17.256" }],
		["an IPv4 part with a leading zero", { ...zerotier, address: "10.147.017.5" }],
		["an IPv4 address with a port", { ...zerotier, address: "10.147.17.5:22" }],
		["three IPv4 parts", { ...zerotier, address: "10.147.17" }],
		["a host identity that is not a SHA256 fingerprint", { ...zerotier, hostKey: "MD5:aa:bb" }],
		["a short code", { ...zerotier, code: "short" }],
		["an SSH port out of range", { ...zerotier, sshPort: 70000 }],
		["a pair port out of range", { ...zerotier, pairPort: 0 }],
		["an empty name", { ...zerotier, name: "" }],
		["a missing user", { ...zerotier, user: undefined }],
		["a missing expiry", { ...zerotier, expiresAt: undefined }],
	])("rejects a version 2 offer with %s as damaged", (_name, data) => {
		expect(decodeNetworkPairingUri(encodePairingUri(data as unknown as ZeroTierPairingOffer))).toEqual(damaged);
	});

	it("still rejects a damaged version 1 offer", () => {
		expect(decodeNetworkPairingUri(encodePairingUri({ ...offer, hostKey: "MD5:aa:bb" }))).toEqual(damaged);
	});

	it.each([
		["another app's link", "otherapp://pair?p=abc", "This QR is not a pairing code for this app."],
		["a payload that is not valid", `${APP_ID}://pair?p=%%%`, damaged.message],
	])("rejects %s with the same messages as before", (_name, uri, message) => {
		expect(decodeNetworkPairingUri(uri)).toEqual({ ok: false, message });
	});
});

describe("pairing request", () => {
	const request = {
		code: offer.code,
		publicKey: "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBHUv phone",
		deviceName: "Galaxy S24 Ultra",
	};

	it("accepts a valid request", () => {
		expect(decodePairingRequest(request)).toEqual({ ok: true, value: request });
	});

	it.each([
		["a key with options", { ...request, publicKey: `command="sh" ${request.publicKey}` }],
		["a key spanning lines", { ...request, publicKey: `${request.publicKey}\nssh-ed25519 AAAA other` }],
		["an unsupported key type", { ...request, publicKey: "ssh-dss AAAAB3NzaC1kc3M phone" }],
		["a device name with control characters", { ...request, deviceName: "S24\nUltra" }],
		["a device name with a C1 terminal control character", { ...request, deviceName: "S24\u009b2JUltra" }],
		["a missing code", { publicKey: request.publicKey, deviceName: request.deviceName }],
	])("rejects %s", (_name, data) => {
		expect(decodePairingRequest(data).ok).toBe(false);
	});
});
