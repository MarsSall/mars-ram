import type { RunOutcome as Outcome } from "@workspace/protocol";

/** Evidence from the latest agent_end, not tool results or assistant prose. */
export class RunOutcome {
	private stopReason: unknown;

	reset(): void {
		this.stopReason = undefined;
	}

	ended(messages: readonly { role: string; stopReason?: unknown }[]): void {
		this.stopReason = messages.findLast((message) => message.role === "assistant")?.stopReason;
	}

	settled(aborted: boolean): Outcome | undefined {
		const reason = this.stopReason;
		this.reset();
		if (aborted || reason === "aborted") return "aborted";
		if (reason === "error") return "failed";
		// Pi uses stop; tolerate end_turn from compatible older/provider adapters.
		if (reason === "stop" || reason === "end_turn") return "completed";
		return undefined;
	}
}
