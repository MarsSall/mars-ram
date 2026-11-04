import { UPLOADS_DIRECTORY } from "@workspace/protocol";
import type { HostConnection } from "./ports";

export type AttachmentRetention = 1 | 7 | 30 | "never";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Best-effort maintenance, never part of a successful connection's critical path. */
export async function cleanupUploads(host: HostConnection, connectionId: string, retention: AttachmentRetention, clock: () => number): Promise<void> {
	const listing = await host.listDir(connectionId, UPLOADS_DIRECTORY);
	// A missing uploads directory is normal before the first attachment.
	if (!listing.ok) return;
	const now = clock();
	for (const entry of listing.entries) {
		if (!entry.isFile || entry.name === "." || entry.name === ".." || /[/\\:]/.test(entry.name)) continue;
		const stale = /\.part$/i.test(entry.name)
			? entry.modifiedAt < now - HOUR
			: retention !== "never" && entry.modifiedAt < now - retention * DAY;
		if (!stale) continue;
		try { await host.removeFile(connectionId, `${UPLOADS_DIRECTORY}/${entry.name}`); } catch { /* Continue with the other files. */ }
	}
}
