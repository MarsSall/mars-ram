import type { Conversation } from "../core/conversation";
import type { LivePhase } from "../core/live-session";

type ActivityStrings = {
 phases: Record<string, string>;
 fallback: string; working: string; blocked: string; waiting: string; done: string; finished: string;
};
export type TerminalActivityStatus = { kind: "working" | "attention" | "done"; text: string; announcement: string };

/** Never turn cached state (or a standalone PTY) into a claim about the agent. */
export function terminalActivityStatus(
 sessionOpen: boolean,
 view: { phase: LivePhase; conversation: Pick<Conversation, "running" | "prompt" | "activity"> | null } | null,
 strings: ActivityStrings,
): TerminalActivityStatus | null {
 if (!sessionOpen || view?.phase !== "live" || !view.conversation) return null;
 const c = view.conversation;
 if (c.prompt) return { kind: "attention", text: strings.waiting, announcement: `${strings.blocked}: ${strings.waiting}` };
 if (!c.running) return { kind: "done", text: strings.done, announcement: strings.finished };
 const label = c.activity && Object.hasOwn(strings.phases, c.activity) ? strings.phases[c.activity]! : strings.fallback;
 return { kind: "working", text: `${label}…`, announcement: `${strings.working}: ${label}` };
}
