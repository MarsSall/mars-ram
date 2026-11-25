// Use case: open a session from Home or a notice: its Herdr pane when it runs in one, else its chat.
// A card or notice can hold a key whose bridge is gone: Claude Code and Codex bridges restart with a new
// instance (and port) on a host update or a new SessionStart, while a Pi bridge keeps its own (claude-codex L19).
import { sessionCapabilities, type StateResponse } from "@workspace/protocol";
import type { BridgeEndpoint, BridgeResult } from "./bridge-client";
import type { EndpointResult } from "./live-session";

/** `key` may differ from the one asked for: the live bridge of the same session or pane. */
export type OpenTarget = { key: string; terminal: boolean };
export type SessionOpenDeps = {
	/** The listed tunnel; `fresh` (or an unknown key) lists the computer again first. */
	endpoint(key: string, fresh: boolean): Promise<EndpointResult>;
	state(endpoint: BridgeEndpoint): Promise<BridgeResult<StateResponse>>;
	/** After a listing: the live key that replaced `key`, when exactly one does. */
	successor(key: string): string | undefined;
};

const target = (key: string, state: StateResponse): OpenTarget => ({
	key,
	// A session whose agent offers no terminal routes is chat-only, even inside Herdr (claude-codex S6).
	terminal: state.terminal === true && sessionCapabilities(state).capabilities.terminal,
});

/** null is unknown/unreachable, not evidence that a session is outside Herdr. At most one listing of the computer. */
export async function openSessionTarget(key: string, deps: SessionOpenDeps): Promise<OpenTarget | null> {
	const ask = async (endpoint: BridgeEndpoint, of: string) => {
		const state = await deps.state(endpoint);
		return state.ok ? target(of, state.value) : null;
	};
	let endpoint = await deps.endpoint(key, false);
	if (typeof endpoint !== "string") {
		const opened = await ask(endpoint, key);
		if (opened) return opened;
		// The cached tunnel or bridge did not answer: list once with fresh ids.
		endpoint = await deps.endpoint(key, true);
		if (typeof endpoint !== "string") {
			const again = await ask(endpoint, key);
			if (again) return again;
		}
	}
	// A listing ran and this key is not live: follow the bridge that replaced it, without another listing.
	const next = deps.successor(key);
	if (next === undefined || next === key) return null;
	const replaced = await deps.endpoint(next, false);
	return typeof replaced === "string" ? null : ask(replaced, next);
}
