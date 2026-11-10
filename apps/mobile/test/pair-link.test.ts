import { afterEach, describe, expect, it, vi } from "vitest";
import { encodePairingUri, PAIRING_VERSION, ZEROTIER_PAIRING_VERSION, type PairingOffer } from "@workspace/protocol";
import { pairingFailureMessage, pairingUriFromLink, readPairLink } from "../src/core/pair-link";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

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
const qr = encodePairingUri(offer);
// What `<scheme>://pair?p=…` hands the route: the text after `p=`.
const p = qr.slice(qr.indexOf("p=") + 2);

afterEach(() => vi.unstubAllGlobals());

describe("pairing link", () => {
	it("rebuilds exactly the URI the QR carries from the link's p parameter", () => {
		expect(pairingUriFromLink(p)).toBe(qr);
	});

	it("summarizes a valid offer with name and MagicDNS address, without touching the network", () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		expect(readPairLink(p, 1_000)).toEqual({
			ok: true,
			offer: { name: "devbox", address: "devbox.example-tailnet.ts.net", expiresAt: 10_000, uri: qr },
		});
		expect(fetch).not.toHaveBeenCalled();
	});

	it("shows the tailnet address when the offer has no MagicDNS name", () => {
		const { dnsName: _, ...noDns } = offer;
		const uri = encodePairingUri(noDns);
		const result = readPairLink(uri.slice(uri.indexOf("p=") + 2), 1_000);
		expect(result.ok && result.offer.address).toBe("100.64.0.10");
	});

	it("refuses a link without p", () => {
		expect(readPairLink(undefined, 1_000)).toEqual({ ok: false, reason: "missing", code: "INVALID_QR" });
		expect(readPairLink("", 1_000)).toEqual({ ok: false, reason: "missing", code: "INVALID_QR" });
		expect(pairingUriFromLink(undefined)).toBeNull();
	});

	it("refuses a repeated p instead of choosing one", () => {
		expect(readPairLink([p, p], 1_000)).toEqual({ ok: false, reason: "invalid", code: "INVALID_QR" });
	});

	it("refuses garbage", () => {
		expect(readPairLink("not-a-pairing-offer", 1_000)).toEqual({ ok: false, reason: "invalid", code: "INVALID_QR" });
		expect(readPairLink("%%%", 1_000)).toEqual({ ok: false, reason: "invalid", code: "INVALID_QR" });
	});

	it("refuses an expired offer", () => {
		expect(readPairLink(p, 10_001)).toEqual({ ok: false, reason: "expired", code: "CODE_EXPIRED" });
	});

	it("summarizes a ZeroTier offer with its ZeroTier address", () => {
		const { dnsName: _, ...rest } = offer;
		const uri = encodePairingUri({ ...rest, v: ZEROTIER_PAIRING_VERSION, network: "zerotier", address: "10.147.17.5" });
		expect(readPairLink(uri.slice(uri.indexOf("p=") + 2), 1_000)).toEqual({
			ok: true,
			offer: { name: "devbox", address: "10.147.17.5", expiresAt: 10_000, uri },
		});
	});
});

describe("pairing failure text", () => {
	it("uses the screen's language for known codes and the core message otherwise", () => {
		expect(pairingFailureMessage({ code: "CODE_EXPIRED", message: "x" }, es.add)).toBe(es.add.failures.CODE_EXPIRED);
		expect(pairingFailureMessage({ code: "UNREACHABLE", message: "x" }, en.add)).toBe(en.add.unreachable);
		expect(pairingFailureMessage({ message: "Something else" }, en.add)).toBe("Something else");
	});

	it("asks to turn off Private DNS when the phone cannot find the computer by its name", () => {
		expect(pairingFailureMessage({ code: "PRIVATE_DNS", message: "x" }, es.add)).toBe(
			"Tu teléfono no encuentra la computadora por su nombre de Tailscale. Desactivá el DNS privado: Ajustes › Conexiones › Más ajustes de conexión › DNS privado › Desactivado.",
		);
		expect(pairingFailureMessage({ code: "PRIVATE_DNS", message: "x" }, en.add)).toBe(
			"Your phone can't find the computer by its Tailscale name. Turn off Private DNS: Settings › Connections › More connection settings › Private DNS › Off.",
		);
	});
});

describe("pairing link texts", () => {
	it("asks before sending the key, in Spanish", () => {
		expect(es.pair.title).toBe("¿Agregar esta computadora?");
		expect(es.pair.explain).toBe("Se va a enviar la clave pública de este teléfono a esa computadora; ahí te van a pedir que confirmes.");
		expect(es.pair.add).toBe("Agregar");
		expect(es.pair.cancel).toBe("Cancelar");
		expect(es.pair.scan).toBe("Escanear código");
		expect(es.notFound.title).toBe("No encontramos esa pantalla.");
		expect(es.notFound.home).toBe("Ir a Inicio");
	});
	it("asks before sending the key, in English", () => {
		expect(en.pair.title).toBe("Add this computer?");
		expect(en.pair.explain).toBe("This phone's public key will be sent to that computer, which will ask you to confirm.");
		expect(en.pair.add).toBe("Add");
		expect(en.pair.cancel).toBe("Cancel");
		expect(en.pair.scan).toBe("Scan code");
		expect(en.notFound.title).toBe("We couldn't find that screen.");
		expect(en.notFound.home).toBe("Go to Home");
	});
});
