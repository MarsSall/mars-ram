// Use case: add a computer by scanning the QR it shows (PRD R1).
import { decodePairingUri, decodeResponse, PairingResponse, type PairingErrorCode } from "@workspace/protocol";
import { connectTarget, type HostCatalog, type SavedHost } from "./host-catalog";
import type { FailureCode, HostConnection } from "./ports";

export type PairingDeps = {
	clock: () => number;
	/** Shown on the computer when it asks the user to authorize this phone. */
	deviceName: string;
	keyAlias: string;
	/** Creates the app's key if missing and returns its public half. */
	appKey: { ensure(): Promise<{ publicKey: string }> };
	/** Resolves true when an SSH server answers at address:port within a short timeout. */
	probe: (address: string, port: number) => Promise<boolean>;
	http: { postJson(url: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: unknown }> };
	host: HostConnection;
	catalog: HostCatalog;
	newId: () => string;
	/** Asks the user to unlock the key; resolves false if they cancel. */
	unlock: () => Promise<boolean>;
};

/** Where pairing stopped: reading the QR, giving the key to the computer, or the first connection. */
export type PairingStep = "scan" | "send-key" | "connect";

/** Pairing's own failures, so the screen can explain them in the user's language; message stays an English fallback. */
export type PairingFailureCode =
	| FailureCode
	| "INVALID_QR"
	| "CODE_EXPIRED"
	| "MAGICDNS_REQUIRED"
	| "SEND_FAILED"
	| "UNEXPECTED_ANSWER"
	| "REFUSED"
	| "PAIRING_CLOSED";

export type PairingResult =
	| { ok: true; host: SavedHost }
	| { ok: false; step: PairingStep; message: string; code?: PairingFailureCode };

const REFUSAL_CODES: Record<PairingErrorCode, PairingFailureCode> = {
	rejected: "REFUSED",
	expired: "CODE_EXPIRED",
	closed: "PAIRING_CLOSED",
	bad_code: "PAIRING_CLOSED",
	bad_request: "PAIRING_CLOSED",
	internal: "PAIRING_CLOSED",
};

const MAGICDNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The computer's MagicDNS name, lowercase and without one trailing dot, or null unless it is a host under ts.net.
 * Android permits cleartext only to ts.net names; a MagicDNS name normally resolves to a tailnet address.
 */
export function magicDnsName(dnsName: string | undefined): string | null {
	if (!dnsName) return null;
	const name = dnsName.toLowerCase().replace(/\.$/, "");
	const labels = name.split(".");
	if (name.length > 253 || labels.length < 3 || labels.at(-2) !== "ts" || labels.at(-1) !== "net") return null;
	return labels.every((label) => MAGICDNS_LABEL.test(label)) ? name : null;
}

export async function pairWithComputer(deps: PairingDeps, uri: string): Promise<PairingResult> {
	const decoded = decodePairingUri(uri);
	if (!decoded.ok) return { ok: false, step: "scan", code: "INVALID_QR", message: decoded.message };
	const offer = decoded.value;
	if (deps.clock() > offer.expiresAt) {
		return { ok: false, step: "scan", code: "CODE_EXPIRED", message: "This pairing code expired. Show a new one on the computer." };
	}
	// The key request is plain HTTP, which Android allows only to MagicDNS names: never fall back to the IP address.
	const pairHost = magicDnsName(offer.dnsName);
	if (!pairHost) {
		return {
			ok: false,
			step: "scan",
			code: "MAGICDNS_REQUIRED",
			message: "Turn on MagicDNS in Tailscale (admin console › DNS) and run mars-ram pair again.",
		};
	}

	// The key request waits minutes for the user's answer, so first make sure the computer is reachable at all,
	// for example that Tailscale is on in this phone.
	if (!(await deps.probe(offer.address, offer.sshPort))) {
		return {
			ok: false,
			step: "send-key",
			code: "UNREACHABLE",
			message: "Cannot reach the computer. Check that Tailscale is on in this phone and the computer is on, then scan again.",
		};
	}

	// Only the public key leaves the phone; the computer still asks its user before accepting it.
	const key = await deps.appKey.ensure();
	let reply: { status: number; json: unknown };
	try {
		// The computer answers only after its user confirms, so wait until the code expires.
		reply = await deps.http.postJson(
			`http://${pairHost}:${offer.pairPort}/pair`,
			{ code: offer.code, publicKey: key.publicKey, deviceName: deps.deviceName },
			offer.expiresAt - deps.clock(),
		);
	} catch {
		return {
			ok: false,
			step: "send-key",
			code: "SEND_FAILED",
			message: "Cannot reach the computer. Check that the phone is on the tailnet and the pairing code is still on screen.",
		};
	}
	const answer = decodeResponse(PairingResponse, reply.json);
	if (!answer.ok) return { ok: false, step: "send-key", code: "UNEXPECTED_ANSWER", message: "The computer answered something unexpected." };
	if (!answer.value.ok) return { ok: false, step: "send-key", code: REFUSAL_CODES[answer.value.error], message: answer.value.message };

	const host: SavedHost = {
		id: deps.newId(),
		keyAlias: deps.keyAlias,
		rotation: { phase: "done" },
		name: offer.name,
		address: offer.address,
		...(offer.dnsName ? { dnsName: offer.dnsName } : {}),
		sshPort: offer.sshPort,
		user: offer.user,
		// The identity comes from the QR the user scanned at the computer, not from the network.
		hostKey: offer.hostKey,
		addedAt: deps.clock(),
	};
	// Unlock only now: confirming at the computer may take minutes, and the unlock lasts five.
	if (!(await deps.unlock())) {
		return {
			ok: false,
			step: "connect",
			code: "UNLOCK_REQUIRED",
			message: "The phone was not unlocked, so the computer was not saved. Show a new code on the computer and try again.",
		};
	}
	const connected = await deps.host.connect(connectTarget(host, deps.keyAlias));
	if (!connected.ok) {
		if (connected.code === "HOST_KEY_CHANGED" || connected.code === "HOST_KEY_UNKNOWN") {
			return {
				ok: false,
				step: "connect",
				code: "HOST_KEY_CHANGED",
				message: "The computer that answered is not the one in the QR. It was not saved.",
			};
		}
		return { ok: false, step: "connect", code: connected.code, message: connected.message };
	}
	await deps.host.disconnect(connected.connectionId);
	await deps.catalog.save(host);
	return { ok: true, host };
}
