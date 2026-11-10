// A pairing link (`<scheme>://pair?p=…`, printed by `mars-ram pair`) read into what the user confirms before pairing (PRD R1).
// Any app or web page can open such a link, so nothing here touches the network; pairing starts only after the user agrees.
import { APP_ID, decodeNetworkPairingUri } from "@workspace/protocol";
import { magicDnsName, type PairingFailureCode } from "./pairing";

/** What the confirmation shows: the computer's name and where the key would go, from the link itself. */
export type PairLinkOffer = { name: string; address: string; expiresAt: number; uri: string };

export type PairLinkResult =
	| { ok: true; offer: PairLinkOffer }
	| { ok: false; reason: "missing" | "invalid" | "expired"; code: "INVALID_QR" | "CODE_EXPIRED" };

/**
 * The URI the computer's QR carries for this link's `p`, so the link pairs exactly like a scan.
 * The canonical scheme is the app id, whichever app scheme (store or preview) opened the link.
 */
export function pairingUriFromLink(p: string | string[] | undefined): string | null {
	if (typeof p !== "string" || p === "") return null;
	return `${APP_ID}://pair?p=${p}`;
}

export function readPairLink(p: string | string[] | undefined, now: number): PairLinkResult {
	if (p === undefined || p === "") return { ok: false, reason: "missing", code: "INVALID_QR" };
	const uri = pairingUriFromLink(p);
	const decoded = uri ? decodeNetworkPairingUri(uri) : null;
	if (!uri || !decoded?.ok) return { ok: false, reason: "invalid", code: "INVALID_QR" };
	const offer = decoded.value;
	if (now > offer.expiresAt) return { ok: false, reason: "expired", code: "CODE_EXPIRED" };
	// Over Tailscale the key request goes to the MagicDNS name; without one pairing stops later and explains why.
	// Over ZeroTier it goes to the offer's address.
	const address = decoded.network === "tailscale" ? magicDnsName(decoded.value.dnsName) ?? offer.address : offer.address;
	return { ok: true, offer: { name: offer.name, address, expiresAt: offer.expiresAt, uri } };
}

/** Core messages are English; a failure with a known code is shown in the screen's language, ZeroTier's when it differs. */
export function pairingFailureMessage(
	result: { code?: PairingFailureCode; message: string; network?: "zerotier" },
	strings: {
		failures: Partial<Record<PairingFailureCode, string>>;
		unreachable: string;
		zeroTierFailures: Partial<Record<PairingFailureCode, string>>;
	},
): string {
	const failures: Partial<Record<PairingFailureCode, string>> = {
		...strings.failures,
		UNREACHABLE: strings.unreachable,
		...(result.network === "zerotier" ? strings.zeroTierFailures : {}),
	};
	return (result.code && failures[result.code]) || result.message;
}
