import { describe, expect, it } from "vitest";
import {
	APP_ID,
	COMPACT_PAIRING_VERSION,
	decodeNetworkPairingUri,
	encodeCompactPairingUri,
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
	name: "devbox01",
	address: "100.64.0.10",
	dnsName: "devbox01.example-tailnet.ts.net",
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
	"mars-ram://pair?p=eyJ2IjoxLCJuYW1lIjoiZGV2Ym94MDEiLCJhZGRyZXNzIjoiMTAwLjY0LjAuMTAiLCJkbnNOYW1lIjoiZGV2Ym94MDEuZXhhbXBsZS10YWlsbmV0LnRzLm5ldCIsInNzaFBvcnQiOjIyLCJ1c2VyIjoibWFycyIsImhvc3RLZXkiOiJTSEEyNTY6cVJWcGhXc29kU1RnYWljY2ZUVVpuRUcxRjVzTlY0MmdQcUMrL0JsMzVCOCIsInBhaXJQb3J0Ijo0NzEyMywiY29kZSI6InE3SG4ydkprOXNMcDR4V2M4YlpyNXQiLCJleHBpcmVzQXQiOjE4MDAwMDAwMDAwMDB9";

const zerotier: ZeroTierPairingOffer = {
	v: ZEROTIER_PAIRING_VERSION,
	network: "zerotier",
	name: "devbox01",
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
		["a MagicDNS name", { ...zerotier, dnsName: "devbox01.example-tailnet.ts.net" }],
		["another network", { ...zerotier, network: "tailscale" }],
		["a missing network", { ...zerotier, network: undefined }],
		["a host name instead of an address", { ...zerotier, address: "devbox01.example.com" }],
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

describe("compact pairing offer (version 3)", () => {
	// What `mars-ram pair` makes: 16 random bytes as base64url, so the code is canonical.
	const CODE = "q7Hn2vJk9sLp4xWc8bZr5w";
	const tailscale: PairingOffer = { ...offer, address: "100.101.102.103", dnsName: "devbox01.tail1234ab.ts.net", code: CODE, expiresAt: 1_800_000_000_123 };
	const { dnsName: _, ...withoutDns } = tailscale;
	const zt: ZeroTierPairingOffer = { ...zerotier, code: CODE, expiresAt: 1_800_000_000_123 };
	const newerApp = { ok: false, message: "This pairing code needs a newer version of the app." };

	const uriOf = (bytes: number[]) => `${APP_ID}://pair?p=${Buffer.from(bytes).toString("base64url")}`;
	const bytesOf = (uri: string) => [...Buffer.from(uri.split("?p=")[1]!, "base64url")];
	const text = (value: string) => [Buffer.byteLength(value), ...Buffer.from(value)];
	const uint48 = (value: number) => [...Buffer.from(value.toString(16).padStart(12, "0"), "hex")];
	// The documented layout: version, flags, IPv4, SSH port, pair port, expiry (ms), host key, code, then name, user and the MagicDNS name.
	const fixed = (flags: number, address: number[]) => [
		COMPACT_PAIRING_VERSION,
		flags,
		...address,
		0, 22,
		0xb8, 0x13,
		...uint48(1_800_000_000_123),
		...Buffer.from(offer.hostKey.slice("SHA256:".length), "base64"),
		...Buffer.from(CODE, "base64url"),
	];
	// Flags: 1 ZeroTier, 2 MagicDNS name, 4 «.ts.net» left out, 8 «<name>.» left out.
	const tailscaleBytes = [...fixed(0b1110, [100, 101, 102, 103]), ...text("devbox01"), ...text("mars"), ...text("tail1234ab")];
	const zeroTierBytes = [...fixed(0b0001, [10, 147, 17, 5]), ...text("devbox01"), ...text("mars")];

	it("is version 3", () => {
		expect(COMPACT_PAIRING_VERSION).toBe(3);
	});

	it("keeps the app's lowercase link scheme and only URL-safe characters", () => {
		const uri = encodeCompactPairingUri(tailscale)!;
		expect(uri.startsWith(`${APP_ID}://pair?p=`)).toBe(true);
		expect(uri.split("?p=")[1]).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("lays a Tailscale offer out byte for byte, leaving out the name and «.ts.net» it can rebuild", () => {
		expect(bytesOf(encodeCompactPairingUri(tailscale)!)).toEqual(tailscaleBytes);
	});

	it("lays a ZeroTier offer out byte for byte, without a MagicDNS name", () => {
		expect(bytesOf(encodeCompactPairingUri(zt)!)).toEqual(zeroTierBytes);
	});

	it("is less than half as long as the same offer in version 1 or 2", () => {
		expect(encodeCompactPairingUri(tailscale)!.length).toBeLessThan(encodePairingUri(tailscale).length / 2);
		expect(encodeCompactPairingUri(zt)!.length).toBeLessThan(encodePairingUri(zt).length / 2);
	});

	it.each([
		["with a MagicDNS name", tailscale],
		["without a MagicDNS name", withoutDns],
		["with a MagicDNS name outside ts.net", { ...tailscale, dnsName: "devbox01.example.com" }],
		["with a MagicDNS name that does not start with its name", { ...tailscale, dnsName: "other.tail1234ab.ts.net" }],
		["with a MagicDNS name that is only the suffix", { ...tailscale, dnsName: ".ts.net" }],
		["with an upper-case name", { ...tailscale, name: "MarsMini" }],
		["with a non-ASCII name", { ...tailscale, name: "Computadora de Ñandú", dnsName: "computadora-de-nandu.tail1234ab.ts.net" }],
		["with an empty MagicDNS name", { ...tailscale, dnsName: "" }],
		["at the largest bounds", { ...tailscale, name: "n".repeat(128), user: "u".repeat(128), dnsName: `${"d".repeat(246)}.ts.net`, sshPort: 65535, pairPort: 65535, expiresAt: 2 ** 48 - 1 }],
	])("round-trips a Tailscale offer %s", (_name, value) => {
		expect(decodeNetworkPairingUri(encodeCompactPairingUri(value)!)).toEqual({ ok: true, network: "tailscale", value });
	});

	it.each([
		["a ZeroTier offer", zt],
		["a ZeroTier offer at the smallest bounds", { ...zt, name: "n", user: "u", address: "0.0.0.0", sshPort: 1, pairPort: 1, expiresAt: 0 }],
	])("round-trips %s", (_name, value) => {
		expect(decodeNetworkPairingUri(encodeCompactPairingUri(value)!)).toEqual({ ok: true, network: "zerotier", value });
	});

	it.each([
		["a code that is not 16 bytes in canonical base64url", { ...tailscale, code: "q7Hn2vJk9sLp4xWc8bZr5t" }],
		["a longer code", { ...tailscale, code: "q7Hn2vJk9sLp4xWc8bZr5wq7Hn2vJk" }],
		["a Tailscale address that is not IPv4", { ...tailscale, address: "fd7a:115c:a1e0::1" }],
		["a host key that is not canonical base64", { ...tailscale, hostKey: "SHA256:qRVphWsodSTgaiccfTUZnEG1F5sNV42gPqC+/Bl35B9" }],
		["a name longer than 255 bytes in UTF-8", { ...tailscale, name: "ñ".repeat(128) }],
		["an expiry that is not a whole millisecond", { ...tailscale, expiresAt: 1.5 }],
		["an expiry before 1970", { ...tailscale, expiresAt: -1 }],
		["an expiry past 48 bits", { ...tailscale, expiresAt: 2 ** 48 }],
		["an offer that is not valid", { ...tailscale, sshPort: 0 }],
		["a ZeroTier offer that is not valid", { ...zt, address: "10.147.17" }],
	])("cannot carry %s, so it returns null", (_name, value) => {
		expect(encodeCompactPairingUri(value as PairingOffer)).toBeNull();
	});

	const at = (bytes: number[], index: number, value: number) => bytes.map((byte, i) => (i === index ? value : byte));
	const NAME = 64;

	it("rejects every truncation as damaged", () => {
		for (let length = 1; length < tailscaleBytes.length; length++) {
			expect(decodeNetworkPairingUri(uriOf(tailscaleBytes.slice(0, length))), `length ${length}`).toEqual(damaged);
		}
		for (let length = 1; length < zeroTierBytes.length; length++) {
			expect(decodeNetworkPairingUri(uriOf(zeroTierBytes.slice(0, length))), `length ${length}`).toEqual(damaged);
		}
	});

	it.each([
		["a trailing byte", [...tailscaleBytes, 0]],
		["an oversized payload", [...zeroTierBytes, ...new Array(4096).fill(0x41)]],
		...[0x10, 0x20, 0x40, 0x80].map((bit) => [`unknown flag 0x${bit.toString(16)}`, at(tailscaleBytes, 1, 0b1110 | bit)] as [string, number[]]),
		["a ZeroTier offer with a MagicDNS name", [...fixed(0b0011, [10, 147, 17, 5]), ...text("devbox01"), ...text("mars"), ...text("x.ts.net")]],
		["a ZeroTier offer with a name-rebuild flag", at(zeroTierBytes, 1, 0b1001)],
		["a «.ts.net» flag without a MagicDNS name", [...fixed(0b0100, [100, 101, 102, 103]), ...text("devbox01"), ...text("mars")]],
		["a name flag without a MagicDNS name", [...fixed(0b1000, [100, 101, 102, 103]), ...text("devbox01"), ...text("mars")]],
		["an empty MagicDNS remainder with a rebuild flag", [...fixed(0b0110, [100, 101, 102, 103]), ...text("devbox01"), ...text("mars"), 0]],
		["an SSH port of 0", at(at(tailscaleBytes, 6, 0), 7, 0)],
		["a pair port of 0", at(at(tailscaleBytes, 8, 0), 9, 0)],
		["an empty name", [...fixed(0b0001, [10, 147, 17, 5]), 0, ...text("mars")]],
		["an empty user", [...fixed(0b0001, [10, 147, 17, 5]), ...text("devbox01"), 0]],
		["a name that is not UTF-8", at(zeroTierBytes, NAME + 1, 0xff)],
		["a name longer than 128 characters", [...fixed(0b0001, [10, 147, 17, 5]), ...text("n".repeat(129)), ...text("mars")]],
		["a MagicDNS name longer than 253 characters", [...fixed(0b0010, [100, 101, 102, 103]), ...text("devbox01"), ...text("mars"), ...text("d".repeat(254))]],
		["a length past the end", [...fixed(0b0001, [10, 147, 17, 5]), ...text("devbox01"), 200, 0x6d]],
	])("rejects a version 3 offer with %s as damaged", (_name, bytes) => {
		expect(decodeNetworkPairingUri(uriOf(bytes as number[]))).toEqual(damaged);
	});

	it("rejects a payload whose base64url is not canonical as damaged", () => {
		// 89 bytes leave 2 unused bits in the last character; setting one keeps the bytes but not the text.
		const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
		const payload = encodeCompactPairingUri(tailscale)!.split("?p=")[1]!;
		const tampered = payload.slice(0, -1) + alphabet[alphabet.indexOf(payload.at(-1)!) | 1];
		expect(Buffer.from(tampered, "base64url")).toEqual(Buffer.from(payload, "base64url"));
		expect(decodeNetworkPairingUri(`${APP_ID}://pair?p=${tampered}`)).toEqual(damaged);
	});

	it.each([4, 8, 31])("asks for a newer app for compact version %i", (version) => {
		expect(decodeNetworkPairingUri(uriOf(at(tailscaleBytes, 0, version)))).toEqual(newerApp);
	});

	it("is read as damaged by an app that knows only versions 1 and 2, which parses every payload as JSON", () => {
		expect(decodePairingUri(encodeCompactPairingUri(tailscale)!)).toEqual(damaged);
		expect(decodePairingUri(encodeCompactPairingUri(zt)!)).toEqual(damaged);
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
