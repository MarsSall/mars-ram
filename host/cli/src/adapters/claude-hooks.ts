// Claude Code's settings.json: add and remove the hook entries install owns, through the shared hook-file editor
// (agent-hook-file.ts: atomic writes, backup, ownership record ~/.<appId>/claude-hooks.json, foreign settings kept).
import { homedir } from "node:os";
import { isAbsolute, join, win32 } from "node:path";
import { CLAUDE_HOOK_EVENTS, type ClaudeHookEvent, type HookCommand, ownedHooks, ownedHookStatus, withOwnedHooks, withoutOwnedHooks } from "../core/claude-hooks.ts";
import { createHookFile, lstatOrUndefined } from "./agent-hook-file.ts";

export type ClaudeHooksPort = {
	/** Claude Code is on this computer: `claude` on PATH, or its configuration folder exists. */
	detected(): Promise<boolean>;
	/** The settings file install edits. */
	settingsPath(): string;
	install(): Promise<{ changed: boolean; backup?: string }>;
	uninstall(): Promise<{ changed: boolean }>;
	/** Read-only, for doctor. */
	status(): Promise<{ detected: boolean; registered: ClaudeHookEvent[]; current: boolean; readable: boolean }>;
};

export function claudeConfigDir(home: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
	const paths = platform === "win32" ? win32 : { isAbsolute, join };
	// Claude Code reads CLAUDE_CONFIG_DIR instead of ~/.claude when it is set.
	const override = env.CLAUDE_CONFIG_DIR;
	return override && paths.isAbsolute(override) ? override : paths.join(home, ".claude");
}

export function createClaudeHooksAdapter(options: {
	home?: string;
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	/** The Node executable and CLI entry the hooks run. */
	command: () => Omit<HookCommand, "platform">;
	/** Whether `claude` is on PATH (presence only, never run). */
	claudeOnPath: () => Promise<boolean>;
}): ClaudeHooksPort {
	const home = options.home ?? homedir();
	const platform = options.platform ?? process.platform;
	const config = claudeConfigDir(home, options.env ?? process.env, platform);
	const settings = join(config, "settings.json");
	const hookCommand = (): HookCommand => ({ ...options.command(), platform });
	const file = createHookFile({
		home, platform, path: settings, ownership: "claude-hooks.json", agent: "Claude Code",
		desired: () => ownedHooks(hookCommand()),
		withOwned: (value, desired, recorded) => withOwnedHooks(value, desired as ReturnType<typeof ownedHooks>, recorded),
		withoutOwned: withoutOwnedHooks,
	});

	return {
		settingsPath: () => settings,
		async detected() {
			return (await options.claudeOnPath()) || !!lstatOrUndefined(config)?.isDirectory();
		},
		install: () => file.install(),
		uninstall: () => file.uninstall(),
		async status() {
			const detected = await this.detected();
			try {
				return { detected, readable: true, ...ownedHookStatus(file.read(), hookCommand(), file.owned()) };
			} catch {
				return { detected, readable: false, registered: [], current: false };
			}
		},
	};
}

export { CLAUDE_HOOK_EVENTS };
