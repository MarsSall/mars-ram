// Which Pi sessions the phone sees. Only sessions the user works in at a terminal
// are published: background subagents and one-shot runs use rpc, json or print mode.

/** True when a Pi session in `mode` should be published to the registry. */
export function publishesSession(mode: string | undefined, env: Record<string, string | undefined>): boolean {
	// Older Pi versions do not report a mode; keep publishing them as before.
	if (mode === undefined || mode === "tui") return true;
	// Headless sessions only on explicit request, for example the bridge's own contract tests.
	return env.PI_BRIDGE_HEADLESS === "1";
}
