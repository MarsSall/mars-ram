// Follows a JSONL file the agent appends to: reads what is there (only the last `initialBytes`), then polls for new
// complete lines. Polling, not fs.watch, so it behaves the same on Linux and Windows and survives the file appearing
// late (a new session writes its transcript with the first message). Read-only.
import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";

export type TailOptions = {
	path: string;
	/** Older history beyond this many bytes from the end is not read. */
	initialBytes: number;
	pollMs: number;
	/** `live` is false for the lines that were in the file when the tail started. */
	onLines(lines: string[], live: boolean): void;
};

const CHUNK = 1024 * 1024;
/** A single line longer than this (a huge tool result) is skipped rather than held in memory. */
const MAX_LINE = 8 * 1024 * 1024;

export function startTranscriptTail(options: TailOptions): { stop(): void; poll(): void } {
	let offset = -1;
	/** Bytes after the last newline: kept as bytes so a character split across reads decodes whole. */
	let pending = Buffer.alloc(0);
	let skipping = false;
	let stopped = false;

	const read = (from: number, to: number): Buffer => {
		const fd = openSync(options.path, "r");
		try {
			const size = Math.min(to, fstatSync(fd).size);
			const chunks: Buffer[] = [];
			let position = from;
			while (position < size) {
				const buffer = Buffer.alloc(Math.min(CHUNK, size - position));
				const got = readSync(fd, buffer, 0, buffer.length, position);
				if (got <= 0) break;
				chunks.push(buffer.subarray(0, got));
				position += got;
			}
			offset = position;
			return Buffer.concat(chunks);
		} finally { closeSync(fd); }
	};

	const split = (bytes: Buffer, first: boolean): string[] => {
		let data = pending.length ? Buffer.concat([pending, bytes]) : bytes;
		if (first) {
			// Started mid-file: the first line is partial.
			const newline = data.indexOf(0x0a);
			data = newline === -1 ? Buffer.alloc(0) : data.subarray(newline + 1);
		}
		const end = data.lastIndexOf(0x0a);
		pending = Buffer.from(end === -1 ? data : data.subarray(end + 1));
		const complete: string[] = [];
		if (end !== -1) {
			for (const line of data.subarray(0, end).toString("utf8").split("\n")) {
				// The rest of a line whose start was dropped for being too long.
				if (skipping) { skipping = false; continue; }
				if (line.trim()) complete.push(line.replace(/\r$/, ""));
			}
		}
		if (pending.length > MAX_LINE) { pending = Buffer.alloc(0); skipping = true; }
		return complete;
	};

	const poll = () => {
		if (stopped) return;
		let size: number;
		try { size = statSync(options.path).size; } catch { return; }
		try {
			if (offset === -1) {
				const start = Math.max(0, size - options.initialBytes);
				offset = start;
				const lines = split(read(start, size), start > 0);
				if (lines.length) options.onLines(lines, false);
				return;
			}
			if (size < offset) { offset = 0; pending = Buffer.alloc(0); }
			if (size === offset) return;
			const lines = split(read(offset, size), false);
			if (lines.length) options.onLines(lines, true);
		} catch {
			// A transient read failure (file being replaced, locked on Windows) is retried on the next poll.
		}
	};

	poll();
	const timer = setInterval(poll, options.pollMs);
	return {
		poll,
		stop() {
			stopped = true;
			clearInterval(timer);
		},
	};
}
