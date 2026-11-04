// One SSH connection per saved computer, opened on demand and reused by every screen.
// The key needs the device unlocked: the user is asked once for all computers, and
// after cancelling is not asked again until they refresh by hand (PRD R1).
import { connectTarget, type HostCatalog, type SavedHost } from "./host-catalog";
import type { Failure, HostConnection } from "./ports";
import { cleanupUploads, type AttachmentRetention } from "./attachment-retention";

export type ConnectionDeps = {
	host: HostConnection;
	keyAlias: string;
	/** Reload the authoritative alias when a screen holds a pre-rotation host snapshot. */
	catalog?: Pick<HostCatalog, "list">;
	/** Asks the user to unlock the key; resolves false if they cancel. */
	unlock: () => Promise<boolean>;
	/** Read at the first successful connection per computer per app opening. Defaults to seven days. */
	retention?: () => AttachmentRetention;
	clock?: () => number;
	/** Every fresh successful connection; deduplicated while running, never delays or fails SSH. */
	afterConnect?: (computer: SavedHost, connectionId: string) => Promise<void>;
	/** Opening-only maintenance, independent of per-connection credential resume. */
	afterFirstConnect?: (computer: SavedHost, connectionId: string) => Promise<void>;
};

export type ConnectionResult = { ok: true; connectionId: string } | Failure;

export class HostConnections {
	private readonly open = new Map<string, string>();
	private readonly aliases = new Map<string, string>();
	private readonly connecting = new Map<string, Promise<ConnectionResult>>();
	private readonly cleaned = new Set<string>();
	private readonly resuming = new Set<string>();
	private unlocking: Promise<boolean> | null = null;
	private unlockDeclined = false;

	constructor(private readonly deps: ConnectionDeps) {}

	async connection(saved: SavedHost): Promise<ConnectionResult> {
		if (this.deps.catalog) {
			const current = (await this.deps.catalog.list()).find(h => h.id === saved.id);
			if (!current) return { ok: false, code: "NOT_CONNECTED", message: "The computer is no longer saved." };
			saved = current;
		}
		const alias = saved.keyAlias ?? this.deps.keyAlias;
		const pendingKey = `${saved.id}/${alias}`;
		if (this.aliases.has(saved.id) && this.aliases.get(saved.id) !== alias) await this.drop(saved.id);
		const open = this.open.get(saved.id);
		if (open !== undefined && this.deps.host.isConnected(open)) return Promise.resolve({ ok: true, connectionId: open });
		const pending = this.connecting.get(pendingKey);
		if (pending) return pending;
		const attempt = this.connect(saved).finally(() => this.connecting.delete(pendingKey));
		this.connecting.set(pendingKey, attempt);
		return attempt;
	}

	/** After a cancelled unlock, lets the next connection ask again (a refresh by hand). */
	allowUnlockAgain(): void {
		this.unlockDeclined = false;
	}

	/** Closes a computer's connection, for example after it failed mid-use. */
	async drop(hostId: string): Promise<void> {
		const open = this.open.get(hostId);
		this.open.delete(hostId);
		this.aliases.delete(hostId);
		if (open !== undefined) await this.deps.host.disconnect(open);
	}

	async closeAll(): Promise<void> {
		await Promise.all([...this.open.keys()].map((hostId) => this.drop(hostId)));
	}

	private async connect(saved: SavedHost): Promise<ConnectionResult> {
		const target = connectTarget(saved, saved.keyAlias ?? this.deps.keyAlias);
		let result = await this.deps.host.connect(target);
		if (!result.ok && result.code === "UNLOCK_REQUIRED") {
			if (!(await this.unlockOnce())) return result;
			result = await this.deps.host.connect(target);
		}
		if (!result.ok) return result;
		this.open.set(saved.id, result.connectionId);
		this.aliases.set(saved.id, target.keyAlias);
		const connectionId = result.connectionId;
		if (!this.resuming.has(saved.id)) {
			this.resuming.add(saved.id);
			void Promise.resolve().then(() => this.deps.afterConnect?.(saved, connectionId))
				.catch(() => { /* Optional maintenance must not fail the connection. */ })
				.finally(() => this.resuming.delete(saved.id));
		}
		if (!this.cleaned.has(saved.id)) {
			this.cleaned.add(saved.id);
			void Promise.resolve().then(() => this.deps.afterFirstConnect?.(saved, connectionId))
				.catch(() => { /* Opening maintenance must not fail the connection. */ });
			void Promise.resolve().then(() => cleanupUploads(this.deps.host, connectionId, this.deps.retention?.() ?? 7, this.deps.clock ?? Date.now))
				.catch(() => { /* Maintenance failure must never become a connection failure. */ });
		}
		return { ok: true, connectionId: result.connectionId };
	}

	private unlockOnce(): Promise<boolean> {
		if (this.unlockDeclined) return Promise.resolve(false);
		this.unlocking ??= this.deps.unlock().then((unlocked) => {
			this.unlockDeclined = !unlocked;
			this.unlocking = null;
			return unlocked;
		});
		return this.unlocking;
	}
}
