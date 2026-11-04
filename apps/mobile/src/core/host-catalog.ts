// The computers the user paired with, stored on the phone.
import { Type } from "typebox";
import { Value } from "typebox/value";

export const LEGACY_KEY_ALIAS = "app-ssh-key";
export type RotationPhase = "pending" | "added" | "verified" | "done";
export type KeyRotationError = { code: string; message: string };
export type SavedHost = {
	/** Missing only for legacy in-memory callers; persisted catalogs migrate automatically. */
	keyAlias?: string;
	rotation?: { phase: RotationPhase; lastError?: KeyRotationError };
	id: string;
	name: string;
	/** Tailscale IPv4 address, also the fallback when the name cannot be resolved. */
	address: string;
	dnsName?: string;
	sshPort: number;
	user: string;
	/** The pinned SSH identity; a different one is refused, never accepted. */
	hostKey: string;
	addedAt: number;
};

/** Port: where saved computers live (architecture: HostCatalog). */
export interface HostCatalog {
	list(): Promise<SavedHost[]>;
	save(host: SavedHost): Promise<void>;
	/** Forgets the computer, including its pinned identity. */
	remove(id: string): Promise<void>;
}

/** Name first, falling back to the address, as the app connects to it. */
export function connectTarget(host: SavedHost, keyAlias: string) {
	return {
		host: host.dnsName ?? host.address,
		fallbackHost: host.dnsName ? host.address : null,
		port: host.sshPort,
		username: host.user,
		keyAlias,
		expectedFingerprint: host.hostKey,
	};
}

const SavedHostSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	name: Type.String({ minLength: 1 }),
	address: Type.String({ minLength: 1 }),
	dnsName: Type.Optional(Type.String()),
	sshPort: Type.Integer({ minimum: 1, maximum: 65535 }),
	user: Type.String({ minLength: 1 }),
	hostKey: Type.String({ pattern: "^SHA256:[A-Za-z0-9+/]{43}$" }),
	addedAt: Type.Number(),
	keyAlias: Type.Optional(Type.String({ pattern: "^app-ssh-key(?:-[1-9][0-9]*)?$" })),
	rotation: Type.Optional(Type.Object({
		phase: Type.Union([Type.Literal("pending"), Type.Literal("added"), Type.Literal("verified"), Type.Literal("done")]),
		lastError: Type.Optional(Type.Object({ code: Type.String(), message: Type.String() })),
	})),
});

export const CATALOG_VERSION = 2;

/** Reads the stored catalog; a missing or damaged file starts empty, and invalid entries are dropped. */
export function parseSavedHosts(text: string | null): { hosts: SavedHost[]; dropped: number } {
	if (text === null) return { hosts: [], dropped: 0 };
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return { hosts: [], dropped: 0 };
	}
	const entries = (data as { hosts?: unknown } | null)?.hosts;
	if (!Array.isArray(entries)) return { hosts: [], dropped: 0 };
	const hosts = entries.filter((entry): entry is SavedHost => Value.Check(SavedHostSchema, entry))
		.map(host => ({ ...host, keyAlias: host.keyAlias ?? LEGACY_KEY_ALIAS, rotation: host.rotation ?? { phase: "done" as const } }));
	return { hosts, dropped: entries.length - hosts.length };
}

export function serializeSavedHosts(hosts: SavedHost[]): string {
	return JSON.stringify({ version: CATALOG_VERSION, hosts });
}
