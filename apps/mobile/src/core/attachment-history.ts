import { ATTACHMENT_MAX_BYTES } from "@workspace/protocol";
import type { AttachmentStorage } from "./attachment-storage";
import type { AttachmentRetention } from "./attachment-retention";

export type LocalAttachment = { uri: string; displayName: string; mimeType: string };
type SavedAttachment = LocalAttachment & { createdAt: number };
const safeName = (name: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name);

/** URI grants are ephemeral; only verified private image copies survive reopening. */
export class AttachmentHistory {
	private readonly uploads = new Map<string, LocalAttachment>();
	private readonly saved = new Map<string, SavedAttachment>();
	private queue: Promise<void> = Promise.resolve();
	private cleaned = false;
	private revision = 0;
	private readonly listeners = new Set<() => void>();
	constructor(private readonly storage?: AttachmentStorage, private readonly clock: () => number = Date.now) {
		try {
			const rows: unknown = JSON.parse(storage?.read() ?? "[]");
			if (!Array.isArray(rows)) return;
			for (const row of rows) {
				if (!row || typeof row.name !== "string" || !safeName(row.name) || typeof row.displayName !== "string"
					|| typeof row.mimeType !== "string" || typeof row.uri !== "string" || !Number.isFinite(row.createdAt)) continue;
				const { name, uri, displayName, mimeType, createdAt } = row;
				const local = { uri: uri && storage?.hasCopy(name, uri) ? uri : "", displayName, mimeType };
				this.uploads.set(name, local);
				this.saved.set(name, { ...local, createdAt });
			}
		} catch { /* Corrupt or unavailable metadata is just a card fallback. */ }
	}
	subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
	snapshot = (): number => this.revision;
	private notify(): void { this.revision++; for (const listener of this.listeners) listener(); }
	private enqueue(work: () => Promise<void>): Promise<void> {
		this.queue = this.queue.then(work).catch(() => undefined);
		return this.queue;
	}
	private async persist(): Promise<void> {
		await this.storage?.write(JSON.stringify([...this.saved].map(([name, value]) => ({ name, ...value }))));
	}
	remember(name: string, attachment: LocalAttachment): Promise<void> {
		this.uploads.set(name, { ...attachment });
		this.notify();
		return this.enqueue(async () => {
			if (!this.storage || !safeName(name)) return;
			let uri = "";
			if (attachment.mimeType.startsWith("image/")) {
				try { uri = await this.storage.copy(attachment.uri, name, ATTACHMENT_MAX_BYTES); }
				catch { /* A preview must never fail the send. */ }
			}
			this.saved.set(name, { ...attachment, uri, createdAt: this.clock() });
			if (uri) this.uploads.set(name, { ...attachment, uri });
			this.notify();
			await this.persist();
		});
	}
	/** Also sweeps unindexed copies left by an interrupted metadata write. */
	cleanup(retention: AttachmentRetention): Promise<void> {
		if (this.cleaned) return this.queue;
		this.cleaned = true;
		return this.enqueue(async () => {
			if (!this.storage || retention === "never") return;
			const cutoff = this.clock() - retention * 86400000;
			for (const copy of this.storage.list()) {
				if (!safeName(copy.name) || copy.modifiedAt >= cutoff) continue;
				try { await this.storage.remove(copy.name); } catch { continue; }
				this.uploads.delete(copy.name);
				this.saved.delete(copy.name);
			}
			for (const [name, entry] of this.saved) {
				if (entry.createdAt < cutoff && !this.storage.hasCopy(name, entry.uri)) {
					this.saved.delete(name); this.uploads.delete(name);
				}
			}
			this.notify();
			await this.persist();
		});
	}
	get(name: string): LocalAttachment | undefined {
		return this.uploads.get(name);
	}
}

/** A URI is merely a preview candidate: the renderer must report a read failure. */
export function attachmentPresentation(history: AttachmentHistory, name: string, previewFailed = false) {
	const local = history.get(name);
	const image = local ? local.mimeType.startsWith("image/") : /\.(png|jpe?g|gif|webp|heic|heif|bmp|avif)$/i.test(name);
	return {
		displayName: local?.displayName ?? attachmentDisplayName(name),
		image,
		uri: image && !previewFailed ? local?.uri || undefined : undefined,
	};
}

/** Best available name after an app restart; the original spelling is only known locally. */
export function attachmentDisplayName(name: string): string {
	return name.replace(/^\d{8}-\d{6}-[a-z0-9]{6}-/, "");
}
