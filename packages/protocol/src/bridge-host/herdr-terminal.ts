// Host-only, shared by the Pi bridge and the CLI's agent bridges.
// The inherited pane is the only target; no request can choose a pane or command.
import { execFile } from "node:child_process";

export type TerminalResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** Visible screen and input of this session's own terminal only. */
export interface TerminalPort {
	/** Immutable identity captured at session start; reading it performs no I/O. */
	readonly paneId?: string;
	screen(): Promise<TerminalResult<string>>;
	/** Focus only the inherited pane's workspace and tab (shared between Herdr clients). */
	focus(): Promise<TerminalResult<void>>;
	text(text: string, enter: boolean): Promise<TerminalResult<void>>;
	/** Key names already validated with the protocol's TerminalInputRequest schema. */
	keys(keys: string[]): Promise<TerminalResult<void>>;
}

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

type Direction = "left" | "right" | "up" | "down";
const DIRECTIONS: readonly Direction[] = ["left", "right", "up", "down"];
const OPPOSITE: Record<Direction, Direction> = { left: "right", right: "left", up: "down", down: "up" };
const SCOPED_PANE = /^w[A-Za-z0-9_-]{1,63}:p[A-Za-z0-9_-]{1,63}$/;

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
	/** The neighbor of `from` toward `direction`, when Herdr names a pane of the same workspace. */
	const neighborOf = async (from: string, direction: Direction, workspace: string): Promise<string | undefined> => {
		const found = await command(["pane", "neighbor", "--pane", from, "--direction", direction]);
		if (!found.ok) return undefined;
		let id: unknown;
		try { id = JSON.parse(found.value)?.result?.neighbor?.neighbor_pane_id; } catch { return undefined; }
		return typeof id === "string" && SCOPED_PANE.test(id) && id.split(":")[0] === workspace ? id : undefined;
	};
	// Herdr focuses a pane only as the neighbor of another (`pane focus --pane <from> --direction <d>`): find a
	// neighbor whose way back in the opposite direction leads exactly to this pane, then step back into it.
	const focusOwnPane = async (workspace: string): Promise<void> => {
		for (const direction of DIRECTIONS) {
			const from = await neighborOf(pane, direction, workspace);
			if (from === undefined || from === pane) continue;
			const back = OPPOSITE[direction];
			if (await neighborOf(from, back, workspace) !== pane) continue;
			await command(["pane", "focus", "--pane", from, "--direction", back]);
			return;
		}
	};
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
			let paneFocused: unknown;
			try {
				const info = JSON.parse(metadata.value)?.result?.pane;
				tab = info?.tab_id;
				paneFocused = info?.focused;
			} catch { return failure(); }
			if (typeof tab !== "string" || !/^w[A-Za-z0-9_-]{1,63}:t[A-Za-z0-9_-]{1,63}$/.test(tab) || tab.split(":")[0] !== workspace) return failure();
			const focused = await command(["workspace", "focus", workspace]);
			if (!focused.ok) return focused;
			const result = await command(["tab", "focus", tab]);
			if (!result.ok) return result;
			// A tab can hold several panes (Claude Code next to another agent): `focused: false` means another pane of
			// the tab has its focus. Best effort, the tab stays focused whatever happens here.
			if (paneFocused === false) await focusOwnPane(workspace);
			return { ok: true, value: undefined };
		},
		keys,
	};
}
