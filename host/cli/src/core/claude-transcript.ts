// Reads one line of a Claude Code transcript (the JSONL Claude Code writes under ~/.claude/projects/) into the
// conversation items the app shows. Pure and total: any line it does not understand yields nothing.
// Kept: user text and images, assistant text and its tool calls, tool results (briefly). Dropped: thinking, meta
// lines (isMeta), subagent lines (isSidechain), slash-command wrappers, and every other line type (summary, mode,
// cost-state, last-prompt, attachment, queue-operation, file-history-snapshot, system, …).
import type { ConversationItem } from "./agent-session.ts";

type Part = { type?: unknown; text?: unknown; id?: unknown; name?: unknown; tool_use_id?: unknown; content?: unknown; is_error?: unknown };

const INTERRUPT = /^\[Request interrupted by user/;
const COMMAND_WRAPPER = /^\s*<(?:command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat)>/;
const MAX_ID = 128;

export function parseTranscriptLine(line: string): ConversationItem[] {
	let entry: unknown;
	try { entry = JSON.parse(line); } catch { return []; }
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
	const { type, uuid, message, isMeta, isSidechain } = entry as Record<string, unknown>;
	if (isMeta === true || isSidechain === true) return [];
	if ((type !== "user" && type !== "assistant") || typeof uuid !== "string" || !uuid || uuid.length > MAX_ID) return [];
	if (!message || typeof message !== "object") return [];
	const { content, model } = message as { content?: unknown; model?: unknown };
	const parts: Part[] = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content.filter((part): part is Part => !!part && typeof part === "object") : [];
	const text = parts.flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("\n");

	if (type === "assistant") {
		const items: ConversationItem[] = [];
		const tools = parts.filter((part) => part.type === "tool_use" && typeof part.id === "string" && part.id && part.id.length <= MAX_ID && typeof part.name === "string");
		if (text || tools.length) {
			items.push({ type: "assistant", id: uuid, text, toolCalls: tools.length, ...(typeof model === "string" && model && model !== "<synthetic>" ? { model } : {}) });
		}
		for (const tool of tools) items.push({ type: "tool_use", id: tool.id as string, toolName: tool.name as string });
		return items;
	}

	const results: ConversationItem[] = parts
		.filter((part) => part.type === "tool_result" && typeof part.tool_use_id === "string" && part.tool_use_id && part.tool_use_id.length <= MAX_ID)
		.map((part) => ({ type: "tool_result", id: uuid, toolUseId: part.tool_use_id as string, text: resultText(part.content), isError: part.is_error === true }));
	if (results.length) return results;
	if (INTERRUPT.test(text.trim())) return [{ type: "interrupt" }];
	if (COMMAND_WRAPPER.test(text)) return [];
	const images = parts.filter((part) => part.type === "image").length;
	if (!text.trim() && images === 0) return [];
	return [{ type: "user", id: uuid, text, images }];
}

function resultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.flatMap((part) => (part && typeof part === "object" && (part as Part).type === "text" && typeof (part as Part).text === "string" ? [(part as Part).text as string] : [])).join("\n");
}
