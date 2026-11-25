import { describe, expect, it } from "vitest";
import { AGENT_ASKING_MESSAGE } from "../src/core/live-session";
import { chatError, sendErrorContext, sendFailure, visibleChatError } from "../src/core/send-error";

// Build 15 phone check (approval card, finding 3): «El agente está preguntando algo en su terminal…» is only true
// while nothing changed since the refusal. Answering/resolving the approval or editing the draft makes it stale.
const file = (id: string) => ({ id, sourceUri: `file:///${id}`, displayName: id, size: 1, mimeType: "text/plain", kind: "file" as const });
const a1 = { id: "a1" }, a2 = { id: "a2" };
const at = (approvals: { id: string }[], text = "hola", attachments = [] as ReturnType<typeof file>[]) => sendErrorContext(approvals, { text, attachments });

describe("the chat's send error line", () => {
	it("shows the agent-asking refusal while the approvals and the draft stay as they were", () => {
		const error = sendFailure(AGENT_ASKING_MESSAGE, "Respondé ahí", at([a1]));
		expect(visibleChatError(error, at([a1]))).toBe("Respondé ahí");
		expect(visibleChatError(null, at([a1]))).toBeNull();
	});

	it("drops the agent-asking refusal once the pending approvals change: answered, resolved, replaced or added", () => {
		const error = sendFailure(AGENT_ASKING_MESSAGE, "Respondé ahí", at([a1]));
		for (const now of [[], [a2], [a1, a2]]) expect(visibleChatError(error, at(now))).toBeNull();
		// A refusal with no approval pending clears when one appears (the agent's question reached the phone).
		expect(visibleChatError(sendFailure(AGENT_ASKING_MESSAGE, "x", at([])), at([a1]))).toBeNull();
		expect(visibleChatError(sendFailure(AGENT_ASKING_MESSAGE, "x", sendErrorContext(undefined, { text: "hola", attachments: [] })), at([]))).toBe("x");
	});

	it("drops the agent-asking refusal when the user edits the draft text or its attachments", () => {
		const error = sendFailure(AGENT_ASKING_MESSAGE, "Respondé ahí", at([a1], "hola", [file("f1")]));
		expect(visibleChatError(error, at([a1], "hola", [file("f1")]))).toBe("Respondé ahí");
		expect(visibleChatError(error, at([a1], "hola!", [file("f1")]))).toBeNull();
		expect(visibleChatError(error, at([a1], "", [file("f1")]))).toBeNull();
		expect(visibleChatError(error, at([a1], "hola", []))).toBeNull();
		expect(visibleChatError(error, at([a1], "hola", [file("f1"), file("f2")]))).toBeNull();
	});

	it("keeps every other error through approval changes and draft edits, as before", () => {
		for (const error of [sendFailure("Connection reset", "No se pudo enviar", at([a1])), sendFailure("Session ended.", "No se pudo enviar", at([a1])), chatError("No se pudo detener")]) {
			expect(visibleChatError(error, at([a1]))).toBe(error.text);
			expect(visibleChatError(error, at([]))).toBe(error.text);
			expect(visibleChatError(error, at([a2], "otra cosa", [file("f1")]))).toBe(error.text);
		}
	});
});
