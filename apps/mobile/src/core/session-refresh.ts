// When Home lists its sessions again (claude-codex L19, owner decision): on focus, unless the last listing
// finished less than FOCUS_REFRESH_GAP_MS ago; on its timer and on a pull, always; never two at once.
export const FOCUS_REFRESH_GAP_MS = 10_000;

export type RefreshReason = "focus" | "interval" | "manual";

export class SessionRefresh {
	private running: Promise<void> | null = null;
	private finishedAt: number | null = null;

	/** `load` resolves false when its result was not shown (the screen lost focus): that one does not count. */
	constructor(private readonly deps: { load: () => Promise<boolean | void>; clock: () => number; gapMs?: number }) {}

	/** A request while one runs joins it; a skipped focus resolves at once and keeps the current list. */
	request(reason: RefreshReason): Promise<void> {
		if (this.running) return this.running;
		const gap = this.deps.gapMs ?? FOCUS_REFRESH_GAP_MS;
		if (reason === "focus" && this.finishedAt !== null && this.deps.clock() - this.finishedAt < gap) return Promise.resolve();
		const run = (async () => {
			let shown = true;
			try {
				shown = (await this.deps.load()) !== false;
			} finally {
				if (shown) this.finishedAt = this.deps.clock();
				this.running = null;
			}
		})();
		this.running = run;
		return run;
	}
}
