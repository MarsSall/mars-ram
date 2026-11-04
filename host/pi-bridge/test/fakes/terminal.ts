import type { TerminalPort, TerminalResult } from "../../src/core/ports.ts";

export class FakeTerminal implements TerminalPort {
	calls: unknown[][] = [];
	failure = false;
	throws = false;
	private result<T>(value: T): TerminalResult<T> {
		if (this.throws) throw new Error("private content and paths");
		return this.failure ? { ok: false, message: "private content and paths" } : { ok: true, value };
	}
	async focus() {
		this.calls.push(["focus"]);
		return this.result(undefined);
	}
	async screen() {
		this.calls.push(["screen"]);
		return this.result("\u001b[32mhello\u001b[0m");
	}
	async text(text: string, enter: boolean) {
		this.calls.push(["text", text, enter]);
		return this.result(undefined);
	}
	async keys(keys: Parameters<TerminalPort["keys"]>[0]) {
		this.calls.push(["keys", keys]);
		return this.result(undefined);
	}
}
