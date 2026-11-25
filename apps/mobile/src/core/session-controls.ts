// claude-codex-support S6/T3b: which session controls a session's capabilities allow. Pure.
// An unsupported control is hidden, never shown disabled; a Pi bridge without capabilities keeps them all.
import { LEGACY_PI_CAPABILITIES, NO_CAPABILITIES, type AgentKind, type Capabilities } from "@workspace/protocol";

export type SessionControls = {
	/** The text box and send button (`message`). */
	composer: boolean;
	/** The attachments button, only beside a composer (`attachments`). */
	attachments: boolean;
	/** Sending while the agent runs; without `steer` the send button waits for the agent to finish. */
	sendWhileRunning: boolean;
	/** Stop, while the agent runs (`abort`). */
	stop: boolean;
	/** The way to the session's terminal (`terminal`); the screen still checks the bridge's live `terminal`. */
	terminal: boolean;
	/** Buttons on approval cards (`approvals`). */
	answerApprovals: boolean;
};

/** Before the first snapshot: what the Home card said, or Pi when the route did not say. */
export function expectedCapabilities(agent: string | undefined): Capabilities {
	return agent === undefined || agent === "" || agent === "pi" ? LEGACY_PI_CAPABILITIES : NO_CAPABILITIES;
}

export function sessionControls(capabilities: Capabilities, running: boolean): SessionControls {
	return {
		composer: capabilities.message,
		attachments: capabilities.message && capabilities.attachments,
		sendWhileRunning: capabilities.steer,
		stop: capabilities.abort && running,
		terminal: capabilities.terminal,
		answerApprovals: capabilities.approvals,
	};
}

/** The composer placeholder names the agent; Pi keeps its own text. */
export function composerAgent(agent: AgentKind | "unknown" | undefined): Exclude<AgentKind, "pi"> | "unknown" | null {
	return agent === undefined || agent === "pi" ? null : agent;
}

/** The agent a session text names: Pi for a Pi session (no agent), null for an agent this app does not know. */
export function agentDisplayName(agent: AgentKind | "unknown" | undefined, names: Record<Exclude<AgentKind, "pi">, string>): string | null {
	if (agent === undefined || agent === "pi") return "Pi";
	return agent === "unknown" ? null : names[agent];
}
