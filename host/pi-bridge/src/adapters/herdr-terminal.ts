// The inherited pane is the only target; no request can choose a pane or command.
import { execFile } from "node:child_process";
import type { TerminalPort, TerminalResult } from "../core/ports.ts";

type ExecOptions = {
	env: NodeJS.ProcessEnv;
	shell: false;
	encoding: "utf8";
	timeout: number;
	maxBuffer: number;
};

/** Narrow injection seam for testing argv without launching a process. */
export type TerminalExecFile = (
	file: string,
	args: readonly string[],
	options: ExecOptions,
	callback: (error: Error | null, stdout: string, stderr: string) => void,
) => void;

export function createHerdrTerminal(
	env: NodeJS.ProcessEnv = process.env,
	run: TerminalExecFile = execFile,
): TerminalPort | undefined {
	const pane = env.HERDR_PANE_ID;
	// Herdr pane ids look like `w2G:p2`: a workspace and a pane part.
	if (!pane || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}(:[a-zA-Z0-9][a-zA-Z0-9_-]{0,63})?$/.test(pane)) return undefined;
	const binary = env.HERDR_BIN_PATH || "herdr";
	// Retain the inherited socket and other environment, but fix the target at creation.
	const options: ExecOptions = { env: { ...env }, shell: false, encoding: "utf8", timeout: 3000, maxBuffer: 1024 * 1024 };
	const failure = (): TerminalResult<never> => ({ ok: false, message: "Herdr did not complete the terminal operation." });
	const command = (args: string[]): Promise<TerminalResult<string>> => new Promise((resolve) => {
		try {
			run(binary, args, options, (error, stdout) => resolve(error ? failure() : { ok: true, value: stdout }));
		} catch {
			resolve(failure());
		}
	});
	const keys: TerminalPort["keys"] = async (keys) => {
		const result = await command(["pane", "send-keys", pane, ...keys]);
		return result.ok ? { ok: true, value: undefined } : result;
	};
	return {
		paneId: pane,
		screen: () => command(["pane", "read", pane, "--source", "visible", "--format", "ansi"]),
		text: async (text, enter) => {
			// `pane run` sends the text and Enter together and wraps the text in bracketed paste when the
			// program in the pane enabled it, so several lines arrive as one paste instead of one Enter each.
			const result = await command(["pane", enter ? "run" : "send-text", pane, text]);
			return result.ok ? { ok: true, value: undefined } : result;
		},
		focus: async () => {
			// Legacy pane names remain valid for read/input, but focus needs a scoped Herdr id.
			const scoped = /^(w[A-Za-z0-9_-]{1,63}):p[A-Za-z0-9_-]{1,63}$/.exec(pane);
			if (!scoped) return failure();
			const workspace = scoped[1]!;
			const metadata = await command(["pane", "get", pane]);
			if (!metadata.ok) return metadata;
			let tab: unknown;
			try { tab = JSON.parse(metadata.value)?.result?.pane?.tab_id; } catch { return failure(); }
			if (typeof tab !== "string" || !/^w[A-Za-z0-9_-]{1,63}:t[A-Za-z0-9_-]{1,63}$/.test(tab) || tab.split(":")[0] !== workspace) return failure();
			const focused = await command(["workspace", "focus", workspace]);
			if (!focused.ok) return focused;
			const result = await command(["tab", "focus", tab]);
			return result.ok ? { ok: true, value: undefined } : result;
		},
		keys,
	};
}
