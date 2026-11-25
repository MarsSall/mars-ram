// Reads Codex's rollout JSONL (the transcript_path its hooks report, under ~/.codex/sessions/) into the
// conversation items the app shows. Codex says this format is not a stable interface, so the reader is tolerant:
// any line it does not understand yields nothing, and nothing here throws.
//
// Shapes, from Codex's source (codex-rs/history RolloutLine/RolloutItem, codex-rs/protocol models.rs ResponseItem):
// every line is {timestamp, ordinal?, type, payload}. Read: `turn_context` (payload.model), `response_item` with
// payload `message` (role user: input_text/input_image parts; role assistant: output_text parts), `function_call`,
// `custom_tool_call`, `local_shell_call` (tool calls, by call_id), `function_call_output` and
// `custom_tool_call_output` (their output: a string or a list of text parts), and `event_msg` with payload
// `turn_aborted` (the user interrupted). Older rollouts wrote the response item itself as the line; that is read too.
// Dropped: developer/system messages, context Codex injects as user messages (<environment_context>, AGENTS.md…),
// reasoning, session_meta, compacted, token counts, and the duplicate user_message/agent_message events.
import type { ConversationItem } from "./agent-session.ts";

const MAX_ID = 128;
const RESPONSE_TYPES = new Set(["message", "function_call", "custom_tool_call", "local_shell_call", "function_call_output", "custom_tool_call_output"]);
/** Codex's injected context, written as a user message: a whole `<tag>…</tag>` block, or AGENTS.md instructions. */
const CONTEXT_BLOCK = /^<([A-Za-z_][\w -]{0,60})>[\s\S]*<\/\1>$/;
const AGENTS_INSTRUCTIONS = /^#\s*AGENTS\.md instructions\b/;

type Record_ = Record<string, unknown>;
const object = (value: unknown): Record_ | undefined => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record_) : undefined);
const shortString = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MAX_ID;

export type RolloutReader = {
	/** The items of one rollout line, in order. */
	parse(line: string): ConversationItem[];
};

/** One reader per rollout: it remembers the model of the current turn and numbers items without their own id. */
export function createRolloutReader(): RolloutReader {
	let model: string | undefined;
	let count = 0;
	const id = (value: unknown) => (shortString(value) ? value : `rollout-${++count}`);

	const responseItem = (item: Record_): ConversationItem[] => {
		switch (item.type) {
			case "message": {
				const parts = Array.isArray(item.content) ? item.content.map(object).filter((part): part is Record_ => !!part) : typeof item.content === "string" ? [{ type: "text", text: item.content }] : [];
				const text = (types: string[]) => parts.flatMap((part) => (types.includes(part.type as string) && typeof part.text === "string" ? [part.text] : [])).join("\n");
				if (item.role === "user") {
					const body = text(["input_text", "text"]);
					const trimmed = body.trim();
					if (/^<turn_aborted>[\s\S]*<\/turn_aborted>$/.test(trimmed)) return [{ type: "interrupt" }];
					if (CONTEXT_BLOCK.test(trimmed) || AGENTS_INSTRUCTIONS.test(trimmed)) return [];
					const images = parts.filter((part) => part.type === "input_image").length;
					if (!trimmed && images === 0) return [];
					return [{ type: "user", id: id(item.id), text: body, images }];
				}
				if (item.role === "assistant") {
					const body = text(["output_text", "text"]);
					if (!body.trim()) return [];
					return [{ type: "assistant", id: id(item.id), text: body, toolCalls: 0, ...(model ? { model } : {}) }];
				}
				return [];
			}
			case "function_call":
			case "custom_tool_call":
				if (!shortString(item.call_id) || typeof item.name !== "string" || !item.name) return [];
				return [{ type: "tool_use", id: item.call_id, toolName: item.name.slice(0, 80) }];
			case "local_shell_call": {
				const callId = shortString(item.call_id) ? item.call_id : shortString(item.id) ? item.id : undefined;
				return callId ? [{ type: "tool_use", id: callId, toolName: "shell" }] : [];
			}
			case "function_call_output":
			case "custom_tool_call_output": {
				if (!shortString(item.call_id)) return [];
				const { text, isError } = outputText(item.output);
				return [{ type: "tool_result", id: id(item.id), toolUseId: item.call_id, text, isError }];
			}
			default:
				return [];
		}
	};

	return {
		parse(line) {
			try {
				const entry = object(JSON.parse(line));
				if (!entry) return [];
				const payload = object(entry.payload);
				if (entry.type === "turn_context") {
					if (payload && typeof payload.model === "string" && payload.model && payload.model.length <= 200) model = payload.model;
					return [];
				}
				if (entry.type === "response_item") return payload ? responseItem(payload) : [];
				if (entry.type === "event_msg") return payload?.type === "turn_aborted" ? [{ type: "interrupt" }] : [];
				// Older rollouts: the response item is the line itself.
				if (typeof entry.type === "string" && RESPONSE_TYPES.has(entry.type) && payload === undefined) return responseItem(entry);
				return [];
			} catch {
				return [];
			}
		},
	};
}

/** A tool output's text: a plain string, a list of text parts, or an older JSON string {output, metadata.exit_code}. */
function outputText(output: unknown): { text: string; isError: boolean } {
	const value = object(output);
	if (value && ("content" in value || "body" in value)) {
		const inner = outputText(value.content ?? value.body);
		return { text: inner.text, isError: inner.isError || value.success === false };
	}
	if (Array.isArray(output)) {
		const text = output.flatMap((part) => {
			const item = object(part);
			return item && typeof item.text === "string" && (item.type === "input_text" || item.type === "output_text" || item.type === "text") ? [item.text] : [];
		}).join("\n");
		return { text, isError: false };
	}
	if (typeof output !== "string") return { text: "", isError: false };
	if (output.startsWith("{")) {
		try {
			const legacy = object(JSON.parse(output));
			if (legacy && typeof legacy.output === "string") {
				const exit = object(legacy.metadata)?.exit_code;
				return { text: legacy.output, isError: typeof exit === "number" && exit !== 0 };
			}
		} catch { /* Plain text that starts with a brace. */ }
	}
	return { text: output, isError: false };
}
