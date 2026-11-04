// One pairing: a one-time code shown in a QR, valid for a short time and for one phone,
// which the user must still confirm at the computer before its key is authorized.
import { createHash, timingSafeEqual } from "node:crypto";
import { decodePairingRequest, PAIRING_VERSION, type PairingErrorCode, type PairingOffer, type PairingResponse } from "@workspace/protocol";
import type { HostInfo, PairingPorts } from "./ports.ts";

export type PairingState = "open" | "confirming" | "paired" | "closed";

export type PairingSessionOptions = { host: HostInfo; ports: PairingPorts; ttlMs: number; maxBadAttempts: number };

export class PairingSession {
	state: PairingState = "open";
	badAttempts = 0;
	private readonly host: HostInfo;
	private readonly ports: PairingPorts;
	private readonly code: string;
	private readonly expiresAt: number;
	private readonly maxBadAttempts: number;

	constructor(options: PairingSessionOptions) {
		this.host = options.host;
		this.ports = options.ports;
		this.code = options.ports.randomCode();
		this.expiresAt = options.ports.clock() + options.ttlMs;
		this.maxBadAttempts = options.maxBadAttempts;
	}

	offer(): PairingOffer {
		return { v: PAIRING_VERSION, ...this.host, code: this.code, expiresAt: this.expiresAt };
	}

	isExpired(): boolean {
		return this.ports.clock() > this.expiresAt;
	}

	close(): void {
		if (this.state !== "paired") this.state = "closed";
	}

	/** clientWaiting tells whether the phone is still waiting for the answer; if not, nothing is authorized. */
	async handle(body: unknown, clientWaiting: () => boolean = () => true): Promise<PairingResponse> {
		if (this.state === "confirming") return fail("closed", "Another phone is pairing with this computer right now.");
		if (this.state !== "open") return fail("closed", "This pairing code was already used or cancelled. Show a new one on the computer.");
		if (this.isExpired()) {
			this.state = "closed";
			return fail("expired", "This pairing code expired. Show a new one on the computer.");
		}
		const decoded = decodePairingRequest(body);
		if (!decoded.ok) return this.wrongAttempt("bad_request", "The pairing request is not valid.");
		const request = decoded.value;
		if (!sameCode(request.code, this.code)) return this.wrongAttempt("bad_code", "The pairing code does not match. Scan the QR again.");

		this.state = "confirming";
		const confirmed = await this.ports.confirm({ deviceName: request.deviceName, keyFingerprint: this.ports.keyFingerprint(request.publicKey) });
		// The answer may come after the pairing was cancelled or expired; then it authorizes nothing.
		if (this.state !== "confirming") return fail("closed", "Pairing was cancelled on the computer.");
		// A phone that gave up would never save the computer, so authorizing would leave a stray key.
		if (!clientWaiting()) {
			this.state = "closed";
			return fail("closed", "The phone stopped waiting before the computer confirmed.");
		}
		if (this.isExpired()) {
			this.state = "closed";
			return fail("expired", "This pairing code expired. Show a new one on the computer.");
		}
		if (!confirmed) {
			this.state = "closed";
			return fail("rejected", "The computer did not authorize this phone.");
		}
		const written = await this.ports.authorizeKey(request.publicKey, request.deviceName);
		if (!written.ok) {
			this.state = "closed";
			return fail("internal", `The computer could not authorize the key: ${written.message}`);
		}
		this.state = "paired";
		return { ok: true, user: this.host.user, hostKey: this.host.hostKey };
	}

	/** For requests rejected before they reach handle(), such as oversized bodies. */
	countBadAttempt(): void {
		this.badAttempts++;
		if (this.badAttempts >= this.maxBadAttempts && this.state === "open") this.state = "closed";
	}

	private wrongAttempt(error: PairingErrorCode, message: string): PairingResponse {
		this.countBadAttempt();
		return fail(error, message);
	}
}

function fail(error: PairingErrorCode, message: string): PairingResponse {
	return { ok: false, error, message };
}

/** Constant-time comparison; hashing first hides the code's length. */
function sameCode(given: string, expected: string): boolean {
	const digest = (value: string) => createHash("sha256").update(value).digest();
	return timingSafeEqual(digest(given), digest(expected));
}
