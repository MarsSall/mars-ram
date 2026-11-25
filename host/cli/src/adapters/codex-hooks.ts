// Codex's hooks.json ($CODEX_HOME/hooks.json, default ~/.codex/hooks.json): add and remove the hook entries install
// owns, through the shared hook-file editor (agent-hook-file.ts: atomic writes, backup, ownership record
// ~/.<appId>/codex-hooks.json; foreign hooks and the top-level `description` kept). Doctor also reads Codex's
// config.toml for the trust Codex recorded for each owned hook (read only; never written).
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, win32 } from "node:path";
import { type CodexHookEvent, codexHookStatus, codexRegistered, codexHookTrust, codexOwnedHooks, type CodexTrust, withCodexHooks, withoutCodexHooks } from "../core/codex-hooks.ts";
import type { HookCommand } from "../core/agent-hooks.ts";
import { createHookFile, lstatOrUndefined } from "./agent-hook-file.ts";

export type CodexHooksStatus = { detected: boolean; readable: boolean; registered: CodexHookEvent[]; current: boolean; trust: CodexTrust };

export type CodexHooksPort = {
	/** Codex is on this computer: `codex` on PATH, or its home folder exists. */
	detected(): Promise<boolean>;
	/** The hooks file install edits. */
	settingsPath(): string;
	install(): Promise<{ changed: boolean; backup?: string }>;
	uninstall(): Promise<{ changed: boolean }>;
	/** Read-only, for doctor. */
	status(): Promise<CodexHooksStatus>;
};

const MAX_CONFIG_TOML_BYTES = 4 * 1024 * 1024;

/** Codex's home: CODEX_HOME when it is an absolute path, otherwise ~/.codex (under the user profile on Windows). */
export function codexHome(home: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
	const paths = platform === "win32" ? win32 : { isAbsolute, join };
	const override = env.CODEX_HOME;
	return override && paths.isAbsolute(override) ? override : paths.join(home, ".codex");
}

export function createCodexHooksAdapter(options: {
	home?: string;
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	/** The Node executable and CLI entry the hooks run. */
	command: () => Omit<HookCommand, "platform">;
	/** Whether `codex` is on PATH (presence only, never run). */
	codexOnPath: () => Promise<boolean>;
}): CodexHooksPort {
	const home = options.home ?? homedir();
	const platform = options.platform ?? process.platform;
	const config = codexHome(home, options.env ?? process.env, platform);
	const hooksPath = join(config, "hooks.json");
	const hookCommand = (): HookCommand => ({ ...options.command(), platform });
	const file = createHookFile({
		home, platform, path: hooksPath, ownership: "codex-hooks.json", agent: "Codex",
		desired: () => codexOwnedHooks(hookCommand()),
		withOwned: (value, desired, recorded) => withCodexHooks(value, desired as ReturnType<typeof codexOwnedHooks>, recorded),
		withoutOwned: withoutCodexHooks,
	});

	const configToml = (): string | undefined => {
		const path = join(config, "config.toml");
		try {
			const stat = lstatOrUndefined(path);
			if (!stat) return "";
			if (!stat.isFile() && !stat.isSymbolicLink()) return undefined;
			const text = readFileSync(path, "utf8");
			return text.length > MAX_CONFIG_TOML_BYTES ? undefined : text;
		} catch { return undefined; }
	};

	return {
		settingsPath: () => hooksPath,
		async detected() {
			return (await options.codexOnPath()) || !!lstatOrUndefined(config)?.isDirectory();
		},
		install: () => file.install(),
		uninstall: () => file.uninstall(),
		async status() {
			const detected = await this.detected();
			let value: Record<string, unknown>;
			try { value = file.read(); } catch { return { detected, readable: false, registered: [], current: false, trust: { known: false } }; }
			const toml = configToml();
			const owned = file.owned();
			let trust = codexHookTrust(value, hooksPath, toml, platform, owned);
			// Codex keys trust by the path it loaded hooks.json from, which may be the resolved one.
			if (trust.known && !Object.values(trust.events).includes("trusted")) {
				let real: string | undefined;
				try { real = realpathSync(hooksPath); } catch { real = undefined; }
				if (real && real !== hooksPath) {
					const resolved = codexHookTrust(value, real, toml, platform, owned);
					if (resolved.known && Object.values(resolved.events).includes("trusted")) trust = resolved;
				}
			}
			let status: { registered: CodexHookEvent[]; current: boolean };
			// A Node or CLI path install would refuse cannot match any written hook.
			try { status = codexHookStatus(value, hookCommand(), owned); } catch { status = { registered: codexRegistered(value, owned), current: false }; }
			return { detected, readable: true, ...status, trust };
		},
	};
}
