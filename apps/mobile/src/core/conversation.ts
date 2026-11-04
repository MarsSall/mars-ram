// What the session screen shows, built from the bridge's snapshot and then its live events
// (PRD R3, R4, R6). Pure: every change returns a new value.
import { splitAttachedFiles, type BridgeEvent, type HistoryResponse, type PendingPrompt, type StateResponse } from "@workspace/protocol";
import { type SessionStatus, statusOf as statusOfState } from "./session-list";

export type ChatItem =
	| { kind: "user"; key: string; text: string; images: number }
	| { kind: "assistant"; key: string; text: string; streaming: boolean }
	/** Consecutive tool runs summed up, for example "used 3 tools". */
	| { kind: "tools"; key: string; count: number; failed: number; running: string | null };

/** Sent from the phone while the agent was busy; `returned` after a stop put it back in Pi's editor. */
export type OutgoingMessage = { key: string; text: string; files?: string[]; state: "queued" | "returned" };

export type Conversation = {
	items: ChatItem[];
	running: boolean;
	/** Protocol 1.4 phase id; older bridges omit it. */
	activity: string | null;
	prompt: PendingPrompt | null;
	stopping: boolean;
	outgoing: OutgoingMessage[];
	model: StateResponse["model"];
	lastSeq: number;
	/** When the session last changed, or null if unknown. */
	updatedAt: number | null;
};

export function statusOf(c: Pick<Conversation, "running" | "prompt">): SessionStatus {
	return statusOfState({ idle: !c.running, pendingPrompt: c.prompt });
}

export function fromSnapshot(state: StateResponse, history: HistoryResponse["messages"]): Conversation {
	let items: ChatItem[] = [];
	for (const message of history) {
		if (message.role === "user") items.push({ kind: "user", key: message.entryId, text: message.text, images: message.images });
		else if (message.role === "assistant" && message.text.trim()) items.push({ kind: "assistant", key: message.entryId, text: message.text, streaming: false });
		else if (message.role === "toolResult") items = addTool(items, message.entryId, false);
	}
	return {
		items,
		running: !state.idle,
		activity: state.activity ?? null,
		prompt: state.pendingPrompt,
		stopping: false,
		outgoing: [],
		model: state.model,
		lastSeq: state.lastSeq,
		updatedAt: state.lastActivityAt,
	};
}

export function addQueued(c: Conversation, key: string, text: string, files: string[] = []): Conversation {
	return { ...c, outgoing: [...c.outgoing, { key, text, ...(files.length ? { files } : {}), state: "queued" }] };
}

export function applyEvent(c: Conversation, event: BridgeEvent): Conversation {
	if (event.seq <= c.lastSeq) return c;
	const next = { ...c, lastSeq: event.seq, updatedAt: event.at };
	const key = `e${event.seq}`;
	switch (event.type) {
		case "activity":
			return { ...next, activity: event.activity };
		case "agent_start":
			return { ...next, running: true, activity: null };
		case "agent_settled":
			return {
				...next,
				running: false,
				activity: null,
				stopping: false,
				prompt: null,
				outgoing: event.aborted ? next.outgoing.map((m) => ({ ...m, state: "returned" as const })) : next.outgoing,
			};
		case "prompt_start":
			return { ...next, prompt: event.prompt };
		case "prompt_end":
			return { ...next, prompt: null };
		case "abort_requested":
			return { ...next, stopping: true };
		case "message_start":
			if (event.message.role === "user") return takeUserMessage(next, key, event.message.text, event.message.images);
			if (event.message.role === "assistant") return { ...next, items: [...next.items, { kind: "assistant", key, text: "", streaming: true }] };
			return next;
		case "text_delta": {
			const last = next.items.at(-1);
			if (last?.kind === "assistant" && last.streaming) return { ...next, items: [...next.items.slice(0, -1), { ...last, text: last.text + event.delta }] };
			// The phone joined while this reply was being written.
			return { ...next, items: [...next.items, { kind: "assistant", key, text: event.delta, streaming: true }] };
		}
		case "message_end": {
			if (event.message.role !== "assistant") return next;
			const index = next.items.findLastIndex((item) => item.kind === "assistant" && item.streaming);
			const text = event.message.text;
			const items = index === -1 ? [...next.items] : next.items.filter((_, i) => i !== index);
			if (text.trim()) items.splice(index === -1 ? items.length : index, 0, { kind: "assistant", key: index === -1 ? key : next.items[index]!.key, text, streaming: false });
			return { ...next, items };
		}
		case "tool_start":
			return { ...next, items: startTool(next.items, key, event.toolName) };
		case "tool_end":
			return { ...next, items: addTool(next.items, key, event.isError) };
		default:
			return next;
	}
}

function takeUserMessage(c: Conversation, key: string, text: string, images: number): Conversation {
	const parsed = splitAttachedFiles(text);
	const queued = c.outgoing.findIndex((m) => m.state === "queued" && m.text.trim() === parsed.text.trim()
		&& (m.files ?? []).length === parsed.files.length && (m.files ?? []).every((file, i) => file === parsed.files[i]));
	return {
		...c,
		items: [...c.items, { kind: "user", key, text, images }],
		outgoing: queued === -1 ? c.outgoing : c.outgoing.filter((_, i) => i !== queued),
	};
}

function startTool(items: ChatItem[], key: string, toolName: string): ChatItem[] {
	const last = items.at(-1);
	if (last?.kind === "tools") return [...items.slice(0, -1), { ...last, running: toolName }];
	return [...items, { kind: "tools", key, count: 0, failed: 0, running: toolName }];
}

function addTool(items: ChatItem[], key: string, failed: boolean): ChatItem[] {
	const last = items.at(-1);
	const base = last?.kind === "tools" ? last : { kind: "tools" as const, key, count: 0, failed: 0, running: null };
	const updated = { ...base, count: base.count + 1, failed: base.failed + (failed ? 1 : 0), running: null };
	return last?.kind === "tools" ? [...items.slice(0, -1), updated] : [...items, updated];
}
