// A small diagnostic log of the agent hooks and their bridges: one line per hook run, bridge start and bridge exit,
// in ~/.mars-ram/logs/agent-hooks.log (the previous file kept as agent-hooks.log.1 once it passes the size limit).
// It only says what happened: never a prompt, a reply, a transcript path, a token or a tool's input. Errors are
// one bounded line with paths and token-like strings replaced. Writing it never fails the hook or the bridge.
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { APP_ID } from "@workspace/protocol";

export type AgentLogEntry = {
	agent: string;
	/** The hook event, or `bridge-start` / `bridge-exit`. */
	event: string;
	outcome: string;
	/** The process writing the line (the hook or the bridge). */
	pid?: number;
	/** The session's bridge, when the hook knows it. */
	bridgePid?: number;
	/** How a new bridge was started: `wmi` or `spawn`. */
	method?: string;
	error?: string;
};

export type AgentLog = (entry: AgentLogEntry) => void;

export const AGENT_LOG_MAX_BYTES = 256 * 1024;
const MAX_ERROR = 200;

export const agentLogPath = (home: string = homedir()) => join(home, `.${APP_ID}`, "logs", "agent-hooks.log");

const word = (value: string) => (/^[A-Za-z0-9_.:-]{1,40}$/.test(value) ? value : "?");
const count = (value: number | undefined) => (Number.isInteger(value) && value! >= 0 ? String(value) : undefined);

/** One error as a single bounded line, without paths or anything that looks like a token. */
export function cleanError(text: string): string {
	return text
		.replace(/[\r\n\t]+/g, " ")
		.replace(/(?:[A-Za-z]:)?(?:[\\/][^\s\\/:"'`]+)+[\\/]?/g, "<path>")
		.replace(/[A-Za-z0-9+_=-]{24,}/g, "<redacted>")
		.replace(/[\x00-\x1F\x7F]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_ERROR);
}

export function formatAgentLogLine(entry: AgentLogEntry, now: Date = new Date()): string {
	const fields = [now.toISOString(), `agent=${word(entry.agent)}`, `event=${word(entry.event)}`, `outcome=${word(entry.outcome)}`];
	const pid = count(entry.pid);
	if (pid) fields.push(`pid=${pid}`);
	const bridge = count(entry.bridgePid);
	if (bridge) fields.push(`bridge=${bridge}`);
	if (entry.method) fields.push(`method=${word(entry.method)}`);
	if (entry.error) fields.push(`error=${JSON.stringify(cleanError(entry.error))}`);
	return `${fields.join(" ")}\n`;
}

/** Appends one line, rotating first when the file would pass `maxBytes`. Never throws. */
export function appendAgentLog(path: string, entry: AgentLogEntry, options: { maxBytes?: number; now?: Date } = {}): void {
	try {
		const line = formatAgentLogLine(entry, options.now);
		const max = options.maxBytes ?? AGENT_LOG_MAX_BYTES;
		mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
		let size = 0;
		try { size = statSync(path).size; } catch { /* No file yet. */ }
		if (size > 0 && size + Buffer.byteLength(line) > max) {
			try { renameSync(path, `${path}.1`); } catch { /* Another process rotated it, or Windows holds it: keep appending. */ }
		}
		appendFileSync(path, line, { mode: 0o600 });
	} catch { /* Diagnostics only. */ }
}

export function agentLogger(home: string = homedir(), maxBytes: number = AGENT_LOG_MAX_BYTES): AgentLog {
	const path = agentLogPath(home);
	return (entry) => appendAgentLog(path, entry, { maxBytes });
}
