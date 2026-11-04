// Server-sent events, read chunk by chunk as they arrive (the bridge's /events stream).

export type SseMessage = { event: string; data: string; id: string | null };

export class SseParser {
	private buffer = "";

	constructor(private readonly onMessage: (message: SseMessage) => void) {}

	push(chunk: string): void {
		this.buffer += chunk.replace(/\r\n?/g, "\n");
		let end = this.buffer.indexOf("\n\n");
		while (end !== -1) {
			const block = this.buffer.slice(0, end);
			this.buffer = this.buffer.slice(end + 2);
			this.dispatch(block);
			end = this.buffer.indexOf("\n\n");
		}
	}

	private dispatch(block: string): void {
		let event = "message";
		let id: string | null = null;
		const data: string[] = [];
		for (const line of block.split("\n")) {
			// A line starting with a colon is a comment, such as the bridge's heartbeat.
			if (line === "" || line.startsWith(":")) continue;
			const colon = line.indexOf(":");
			const field = colon === -1 ? line : line.slice(0, colon);
			let value = colon === -1 ? "" : line.slice(colon + 1);
			if (value.startsWith(" ")) value = value.slice(1);
			if (field === "event") event = value;
			else if (field === "data") data.push(value);
			else if (field === "id") id = value;
		}
		if (data.length > 0) this.onMessage({ event, data: data.join("\n"), id });
	}
}
