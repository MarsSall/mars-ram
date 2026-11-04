import { describe, expect, it } from "vitest";
import {
	APP_ID,
	decodePairingRequest,
	decodePairingUri,
	encodePairingUri,
	PAIRING_VERSION,
	type PairingOffer,
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
