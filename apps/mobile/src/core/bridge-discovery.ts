// Use cases: find the session bridges running on a host (PRD R2) and open one.
import { checkCompatibility, decodeRegistryEntry, REGISTRY_DIRECTORY, type RegistryEntry } from "@workspace/protocol";
import type { Failure, HostConnection } from "./ports";

const MAX_ENTRY_BYTES = 64 * 1024;
const LOOPBACK = "127.0.0.1";

export type SkippedEntry = { path: string; reason: string };
export type DiscoveryResult = { ok: true; bridges: RegistryEntry[]; skipped: SkippedEntry[] } | Failure;

export async function discoverBridges(host: HostConnection, connectionId: string): Promise<DiscoveryResult> {
	const listed = await host.listDir(connectionId, REGISTRY_DIRECTORY);
	// No registry directory yet means no bridge has ever started on this host.
	if (!listed.ok) return listed.code === "NOT_FOUND" ? { ok: true, bridges: [], skipped: [] } : listed;

	const bridges: RegistryEntry[] = [];
	const skipped: SkippedEntry[] = [];
	// Only finished entries: a bridge writes "<id>.json.<pid>.tmp" first and renames it.
	for (const file of listed.entries.filter((e) => e.isFile && e.name.endsWith(".json"))) {
		const path = `${REGISTRY_DIRECTORY}/${file.name}`;
		const read = await host.readFile(connectionId, path, MAX_ENTRY_BYTES);
		if (!read.ok) {
			// The bridge stopped and removed its entry between listing and reading.
			if (read.code === "NOT_FOUND") continue;
			return read;
		}
		let data: unknown;
		try {
			data = JSON.parse(read.content);
		} catch {
			skipped.push({ path, reason: "The entry is not valid JSON." });
			continue;
		}
		const decoded = decodeRegistryEntry(data);
		if (!decoded.ok) {
			skipped.push({ path, reason: "The entry is not a bridge registration." });
			continue;
		}
		const compatibility = checkCompatibility(decoded.value.protocolVersion);
		if (!compatibility.ok) {
			skipped.push({ path, reason: compatibility.message });
			continue;
		}
		bridges.push(decoded.value);
	}
	bridges.sort((a, b) => b.startedAt - a.startedAt);
	return { ok: true, bridges, skipped };
}

export type OpenBridge = { ok: true; baseUrl: string; token: string; close(): Promise<void> };

/** Tunnels to a bridge, which listens only on the host's loopback address, as the tunnel requires. */
export async function openBridge(host: HostConnection, connectionId: string, entry: RegistryEntry): Promise<OpenBridge | Failure> {
	const tunnel = await host.forwardLocal(connectionId, entry.port);
	if (!tunnel.ok) return tunnel;
	return {
		ok: true,
		baseUrl: `http://${LOOPBACK}:${tunnel.localPort}`,
		token: entry.token,
		close: () => host.closeForward(tunnel.forwardId),
	};
}
