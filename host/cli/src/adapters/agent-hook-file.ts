// An agent's JSON hooks config (Claude Code's settings.json, Codex's hooks.json): add and remove the hook entries
// install owns. Every other key and hook is kept as read (JSON meaning, key order). Writes are atomic (temporary file
// in the same folder, then rename), keep the file's mode, follow a linked file to its target, and save the previous
// bytes as a backup first. Everything is validated before anything is written: a config that is not a JSON object, or
// one JSON would not write back exactly as read, is refused with every file left as it was. Only handlers the
// ownership record (~/.<appId>/<name>.json) lists, or that equal a handler install generates now, count as ours. The
// record is written before the config changes, so an interrupted run is recognised and finished by the next install
// or uninstall; a reinstall that would change nothing writes nothing.
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { APP_ID } from "@workspace/protocol";
import { type HookHandler, jsonRoundTripKeeps, type OwnedHook } from "../core/agent-hooks.ts";

type Ownership = { version: 1; settings: string; state: "pending" | "installed"; handlers: HookHandler[] };
type Config = Record<string, unknown>;
type Change = { settings: Config; changed: boolean };

const MAX_CONFIG_BYTES = 4 * 1024 * 1024;

export type HookFile = {
	path: string;
	/** The config as read (an absent or empty file is {}); throws when it is not a JSON object or is unsafe. */
	read(): Config;
	/** The handlers counted as ours: the ownership record's and the ones install generates now (each when readable). */
	owned(): HookHandler[];
	install(): Promise<{ changed: boolean; backup?: string }>;
	uninstall(): Promise<{ changed: boolean }>;
};

export function createHookFile(options: {
	home: string;
	platform: NodeJS.Platform;
	/** The config file install edits. */
	path: string;
	/** The ownership record's file name in ~/.<appId>/. */
	ownership: string;
	/** The agent's name, for messages. */
	agent: string;
	desired(): OwnedHook[];
	withOwned(config: Config, desired: OwnedHook[], recorded: readonly HookHandler[]): Change;
	withoutOwned(config: Config, recorded: readonly HookHandler[]): Change;
}): HookFile {
	const { path: settings, platform } = options;
	const root = join(options.home, `.${APP_ID}`);
	const ownershipPath = join(root, options.ownership);

	const readOwnership = (): Ownership | undefined => {
		if (!existsSync(ownershipPath)) return undefined;
		const value = JSON.parse(readFileSync(ownershipPath, "utf8")) as Ownership;
		if (value?.version !== 1 || typeof value.settings !== "string" || !Array.isArray(value.handlers)) throw new Error(`${ownershipPath} is not a valid ownership record; remove it by hand, then try again.`);
		return value;
	};
	const writeOwnership = (value: Ownership) => {
		if (lstatOrUndefined(root)?.isSymbolicLink()) throw new Error(`${root} is a link; refusing to write the ownership record.`);
		mkdirSync(root, { recursive: true, mode: 0o700 });
		const temporary = `${ownershipPath}.${process.pid}.tmp`;
		try {
			writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
			renameSync(temporary, ownershipPath);
		} finally { rmSync(temporary, { force: true }); }
	};

	/** The file to write: a linked config is edited at its target, so dotfile links stay links. */
	const target = (): string => {
		const stat = lstatOrUndefined(settings);
		return stat?.isSymbolicLink() ? realpathSync(settings) : settings;
	};
	const read = (path: string): { raw: string | undefined; value: Config } => {
		const stat = lstatOrUndefined(path);
		if (!stat) return { raw: undefined, value: {} };
		if (!stat.isFile()) throw new Error(`${path} is not a regular file; nothing changed.`);
		if (stat.size > MAX_CONFIG_BYTES) throw new Error(`${path} is larger than ${MAX_CONFIG_BYTES} bytes; nothing changed.`);
		let raw: string;
		try { raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readFileSync(path)); }
		catch { throw new Error(`${path} is not valid UTF-8 text; fix it by hand, then run install again. Nothing changed.`); }
		if (!raw) return { raw, value: {} };
		if (!raw.trim()) throw new Error(`${path} holds only whitespace, which is not JSON; empty it or write {} in it, then run install again. Nothing changed.`);
		let value: unknown;
		try { value = JSON.parse(raw); } catch { throw new Error(`${path} is not valid JSON; fix it (${options.agent} cannot read it either), then run install again. Nothing changed.`); }
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} does not hold a JSON object; nothing changed.`);
		if (!jsonRoundTripKeeps(raw, value)) throw new Error(`${path} has values that rewriting it would change (an integer beyond 2^53, a number with more digits than JSON keeps, a number spelled like 1.0 or 1e3, or a duplicate key); edit those by hand, then run install again. Nothing changed.`);
		return { raw, value: value as Config };
	};

	/** Read, change, and replace the file only if nobody wrote it meanwhile (one retry, e.g. the agent saving it). */
	const edit = (change: (value: Config) => Change): { changed: boolean; backup?: string } => {
		for (let attempt = 0; attempt < 2; attempt++) {
			const path = target();
			const before = read(path);
			const next = change(before.value);
			if (!next.changed) return { changed: false };
			const folder = dirname(path);
			mkdirSync(folder, { recursive: true, mode: 0o700 });
			const mode = before.raw === undefined ? 0o600 : statSync(path).mode & 0o777;
			const backup = `${path}.${APP_ID}.bak`;
			if (before.raw !== undefined) {
				writeFileSync(`${backup}.tmp`, before.raw, { mode: 0o600 });
				renameSync(`${backup}.tmp`, backup);
			}
			const temporary = join(folder, `.${basename(settings)}.${APP_ID}-${process.pid}.tmp`);
			try {
				writeFileSync(temporary, `${JSON.stringify(next.settings, null, 2)}\n`, { mode, flag: "w" });
				if (platform !== "win32") chmodSync(temporary, mode);
				const now = lstatOrUndefined(path) ? readFileSync(path, "utf8") : undefined;
				if (now !== before.raw) continue;
				renameSync(temporary, path);
			} finally { rmSync(temporary, { force: true }); }
			return { changed: true, ...(before.raw === undefined ? {} : { backup }) };
		}
		throw new Error(`${settings} kept changing while install edited it; close ${options.agent}'s settings and try again. Nothing changed.`);
	};

	const generated = (): HookHandler[] => { try { return options.desired().map((hook) => hook.handler); } catch { return []; } };

	return {
		path: settings,
		read: () => read(target()).value,
		owned() {
			let recorded: HookHandler[];
			try { recorded = readOwnership()?.handlers ?? []; } catch { recorded = []; }
			return [...recorded, ...generated()];
		},
		async install() {
			const desired = options.desired();
			const ownership = readOwnership();
			const previous = ownership?.handlers ?? [];
			const installed: Ownership = { version: 1, settings, state: "installed", handlers: desired.map((hook) => hook.handler) };
			// Validate first: a config that cannot be read or rewritten exactly throws here, before any file is written.
			const preview = options.withOwned(read(target()).value, desired, previous);
			if (!preview.changed) {
				if (JSON.stringify(ownership) !== JSON.stringify(installed)) writeOwnership(installed);
				return { changed: false };
			}
			// Intent next: a crash after this still lets uninstall find every handler, old and new.
			writeOwnership({ version: 1, settings, state: "pending", handlers: [...previous, ...installed.handlers] });
			const result = edit((value) => options.withOwned(value, desired, previous));
			writeOwnership(installed);
			return result;
		},
		async uninstall() {
			const ownership = readOwnership();
			const result = edit((value) => options.withoutOwned(value, [...(ownership?.handlers ?? []), ...generated()]));
			rmSync(ownershipPath, { force: true });
			return result;
		},
	};
}

export function lstatOrUndefined(path: string) {
	try { return lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
