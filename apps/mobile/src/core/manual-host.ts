// Use case: add a computer by hand after copying the app's key to it (PRD R1 fallback).
// The user checks the identity the computer shows against the computer itself before it is saved.
import { connectTarget, type HostCatalog, type SavedHost } from "./host-catalog";
import type { Failure, FailureCode, HostConnection } from "./ports";

export type ManualHostInput = { name: string; address: string; user: string; sshPort: string };
export type ManualHostDetails = { name: string; address: string; user: string; sshPort: number };
export type FieldError = "required" | "invalid";

export function validateManualHost(input: ManualHostInput):
	| { ok: true; value: ManualHostDetails }
	| { ok: false; errors: Partial<Record<keyof ManualHostInput, FieldError>> } {
	const address = input.address.trim();
	const user = input.user.trim();
	const portText = input.sshPort.trim();
	const sshPort = Number(portText);
	const errors: Partial<Record<keyof ManualHostInput, FieldError>> = {};
	if (!address) errors.address = "required";
	if (!user) errors.user = "required";
	if (!/^\d{1,5}$/.test(portText) || sshPort < 1 || sshPort > 65535) errors.sshPort = "invalid";
	if (Object.keys(errors).length > 0) return { ok: false, errors };
	return { ok: true, value: { name: input.name.trim() || address, address, user, sshPort } };
}

export type ManualHostDeps = {
	clock: () => number;
	keyAlias: string;
	newId: () => string;
	unlock: () => Promise<boolean>;
	host: HostConnection;
	catalog: HostCatalog;
};

const draft = (deps: ManualHostDeps, details: ManualHostDetails, hostKey: string): SavedHost => ({
	id: deps.newId(),
	keyAlias: deps.keyAlias,
	rotation: { phase: "done" },
	name: details.name,
	address: details.address,
	sshPort: details.sshPort,
	user: details.user,
	hostKey,
	addedAt: deps.clock(),
});

/** Connects trusting nothing; the module refuses and reports the identity the computer showed. */
export async function discoverIdentity(
	deps: ManualHostDeps,
	details: ManualHostDetails,
): Promise<{ ok: true; fingerprint: string } | { ok: false; code: FailureCode; message: string }> {
	const target = { ...connectTarget(draft(deps, details, ""), deps.keyAlias), expectedFingerprint: null };
	const result = await deps.host.connect(target);
	if (!result.ok && result.code === "HOST_KEY_UNKNOWN" && result.fingerprint) return { ok: true, fingerprint: result.fingerprint };
	if (!result.ok) return { ok: false, code: result.code, message: result.message };
	// Not expected: an unknown identity is never trusted. Close and report it as an error.
	await deps.host.disconnect(result.connectionId);
	return { ok: false, code: "SSH_ERROR", message: "The computer was reached without checking its identity." };
}

/** Saves the computer once the user confirmed the identity on the computer itself. */
export async function confirmManualHost(
	deps: ManualHostDeps,
	details: ManualHostDetails,
	fingerprint: string,
): Promise<{ ok: true; host: SavedHost } | Pick<Failure, "ok" | "code" | "message">> {
	if (!(await deps.unlock())) return { ok: false, code: "UNLOCK_REQUIRED", message: "The phone was not unlocked, so the computer was not saved." };
	const host = draft(deps, details, fingerprint);
	const result = await deps.host.connect(connectTarget(host, deps.keyAlias));
	if (!result.ok) return { ok: false, code: result.code, message: result.message };
	await deps.host.disconnect(result.connectionId);
	await deps.catalog.save(host);
	return { ok: true, host };
}
