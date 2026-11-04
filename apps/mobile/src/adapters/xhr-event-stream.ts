// EventStream adapter: React Native's fetch cannot read a response while it arrives, but
// XMLHttpRequest reports partial text on each progress event.
import type { EventStream } from "../core/live-session";
import { SseParser } from "./sse-parser";

/** The bridge sends a heartbeat every 15 seconds, so this much silence means the stream is dead. */
const IDLE_MS = 45_000;
/** The partial text only grows, so a long stream is closed and resumed from its last event. */
const MAX_TEXT = 2_000_000;

export const xhrEventStream: EventStream = {
	open(url, token, handlers) {
		const xhr = new XMLHttpRequest();
		let read = 0;
		let closed = false;
		let idle: ReturnType<typeof setTimeout> | undefined;

		const parser = new SseParser((message) => {
			let data: unknown;
			try {
				data = JSON.parse(message.data);
			} catch {
				return;
			}
			if (message.event === "replay") handlers.onReplay(data);
			else handlers.onEvent(data);
		});

		const close = () => {
			closed = true;
			clearTimeout(idle);
			xhr.abort();
		};
		const finish = (reason: string) => {
			if (closed) return;
			close();
			handlers.onClose(reason);
		};
		const watch = () => {
			clearTimeout(idle);
			idle = setTimeout(() => finish("The session stopped sending updates."), IDLE_MS);
		};
		const readNew = () => {
			if (closed) return;
			const text = xhr.responseText ?? "";
			if (text.length > read) {
				parser.push(text.slice(read));
				read = text.length;
			}
			watch();
			if (read > MAX_TEXT) finish("Resuming a long stream.");
		};

		xhr.onprogress = readNew;
		xhr.onload = () => {
			readNew();
			finish(xhr.status === 200 ? "The session closed the stream." : `The session answered with status ${xhr.status}.`);
		};
		xhr.onerror = () => finish("The connection to the session was lost.");
		xhr.open("GET", url);
		xhr.setRequestHeader("Authorization", `Bearer ${token}`);
		xhr.setRequestHeader("Accept", "text/event-stream");
		xhr.send();
		watch();
		return close;
	},
};
