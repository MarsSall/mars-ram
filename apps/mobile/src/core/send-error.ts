import { AGENT_ASKING_MESSAGE } from "./live-session";

/** What the chat looked like when a send failed: the pending approvals and the draft, as comparable keys. */
export type SendErrorContext = { approvals: string; draft: string };
/** The chat's error line. `asking`: the agent-asking refusal, with the chat as it was when the bridge refused. */
export type ChatError = { text: string; asking?: SendErrorContext };

export function sendErrorContext(approvals: readonly { id: string }[] | null | undefined, draft: { text: string; attachments: readonly { id: string }[] }): SendErrorContext {
	return { approvals: JSON.stringify((approvals ?? []).map((a) => a.id)), draft: JSON.stringify([draft.text, draft.attachments.map((a) => a.id)]) };
}

/** Any error line other than a refused send (a failed stop, a thrown transport error): it stays until the next action. */
export function chatError(text: string): ChatError {
	return { text };
}

/** A send the bridge refused: `message` is the core's (English) message, `text` what the screen shows for it. */
export function sendFailure(message: string, text: string, context: SendErrorContext): ChatError {
	return message === AGENT_ASKING_MESSAGE ? { text, asking: context } : { text };
}

/**
 * The line to show now. «The agent is asking in its terminal» is only true while nothing changed since the refusal:
 * once the pending approvals change (answered, resolved, replaced, added) or the user edits the draft, it goes away
 * (build 15 phone check). Every other error stays as before.
 */
export function visibleChatError(error: ChatError | null, now: SendErrorContext): string | null {
	if (!error) return null;
	if (error.asking && (error.asking.approvals !== now.approvals || error.asking.draft !== now.draft)) return null;
	return error.text;
}
