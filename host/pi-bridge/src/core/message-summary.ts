// What the bridge reports about one Pi message.
import type { MessageSummary } from "@workspace/protocol";

/** Tool output can be huge, so only its start is sent; the conversation itself is sent whole. */
const MAX_TOOL_TEXT = 500;
const FULL_TEXT_ROLES = new Set(["user", "assistant"]);

export function summarize(message: unknown): MessageSummary {
	const m = message as { role?: string; content?: unknown; stopReason?: string };
	const parts: { type: string; text?: string }[] =
		typeof m.content === "string" ? [{ type: "text", text: m.content }] : Array.isArray(m.content) ? m.content : [];
	const text = parts.flatMap((p) => (p.type === "text" && p.text ? [p.text] : [])).join("");
	const role = m.role ?? "unknown";
	const shorten = !FULL_TEXT_ROLES.has(role) && text.length > MAX_TOOL_TEXT;
	const summary: MessageSummary = {
		role,
		text: shorten ? `${text.slice(0, MAX_TOOL_TEXT)}…` : text,
		images: parts.filter((p) => p.type === "image").length,
		toolCalls: parts.filter((p) => p.type === "toolCall").length,
	};
	if (m.stopReason !== undefined) summary.stopReason = m.stopReason;
	return summary;
}
