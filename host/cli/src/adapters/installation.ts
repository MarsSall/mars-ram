// Filesystem and shell-free Pi process boundary. All user paths derive from the injected home.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, cpSync, existsSync, mkdirSync, lstatSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve, win32 } from "node:path";
import { APP_ID } from "@workspace/protocol";
import type { InstallPorts, InstallRecord } from "../core/ports.ts";
import { readWindowsPrivileges } from "./authorized-keys.ts";
import { installText } from "./terminal.ts";
import { validHerdrPath } from "../core/herdr.ts";
import { buildLinkCopy } from "./link-installation.ts";
import { buildCliCopy, protocolSource, checkLauncher, launcherPath, installLauncher, removeLauncher, updateOwnedUserPath, type UserPathIO } from "./cli-installation.ts";

export function executableHerdr(path: unknown, platform: NodeJS.Platform = process.platform): path is string {
 if (!validHerdrPath(path) || path === "herdr") return false;
 try { accessSync(path, platform === "win32" ? constants.F_OK : constants.X_OK); return statSync(path).isFile(); } catch { return false; }
}

/** PATH lookup only: never run a shell, Herdr, or a shim. */
export function findHerdr(options: { path?: string; platform?: NodeJS.Platform; pathExt?: string; executable?: (path: string) => boolean } = {}): string | undefined {
 const windows = (options.platform ?? process.platform) === "win32";
 const paths = windows ? win32 : { join, resolve };
 const extensions = (options.pathExt ?? process.env.PATHEXT ?? ".EXE").split(";").map(ext => ext.toLowerCase());
 const names = windows ? [...new Set(["herdr", "herdr.exe", ...extensions.filter(ext => ext === ".exe").map(ext => `herdr${ext}`)])] : ["herdr"];
 for (const directory of (options.path ?? process.env.PATH ?? "").split(windows ? ";" : delimiter).filter(Boolean)) {
  for (const name of names) {
   const file = paths.resolve(paths.join(directory.replace(/^\"|\"$/g, ""), name));
   if ((options.executable ?? (path => executableHerdr(path, options.platform)))(file)) return file;
  }
 }
 return undefined;
}

export function resolveWindowsPiEntry(shim: string, shimPath: string): string {
	// npm uses %~dp0; pnpm uses %dp0%. Never execute or interpolate the batch file.
	const match = shim.match(/"(?:%~dp0|%dp0%)[\\/]([^"\r\n]*pi-coding-agent[\\/][^"\r\n]*\.js)"/i);
	if (!match?.[1]) throw new Error(installText.unsupportedShim);
	return win32.resolve(win32.dirname(shimPath), match[1]);
}

type PiCommand = { command: string; prefix: string[] };
export function findPi(): PiCommand {
	const windows = process.platform === "win32";
	for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
		const file = join(directory, windows ? "pi.cmd" : "pi");
		try { accessSync(file, windows ? constants.F_OK : constants.X_OK); } catch { continue; }
		if (!statSync(file).isFile()) continue;
		if (!windows) return { command: file, prefix: [] };
		const entry = resolveWindowsPiEntry(readFileSync(file, "utf8"), file);
		if (!existsSync(entry)) throw new Error(installText.unsupportedShim);
		return { command: process.execPath, prefix: [entry] };
	}
	throw new Error(installText.missingPi);
}

/** Temporary names used by the first installer version. */
const LEGACY_LEFTOVER = /^(?:pi-bridge[.-](?:staging|previous)|install\..*\.tmp)/;

/** Nix resolves process.execPath into /nix/store, which garbage collection removes after an upgrade;
 * prefer a PATH symlink outside the store (e.g. the profile's bin/node) that points to the same file. */
export function stableNodePath(options: { execPath?: string; path?: string; storePrefix?: string } = {}): string {
	const execPath = options.execPath ?? process.execPath;
	const store = options.storePrefix ?? "/nix/store/";
	if (process.platform === "win32" || !execPath.startsWith(store)) return execPath;
	const real = realpathSync(execPath);
	for (const directory of (options.path ?? process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
		const candidate = join(directory, "node");
		if (!isAbsolute(candidate) || candidate.startsWith(store)) continue;
		try { if (realpathSync(candidate) === real) return candidate; } catch { /* Not on this PATH entry. */ }
	}
	return execPath;
}

export function createInstallAdapter(options: { home?: string; herdr?: () => string | undefined; userPath?: UserPathIO; /** Allowlisted shortcut programs to record (install command only). */ programs?: () => Promise<Record<string, string>> } = {}): InstallPorts & { writeHostConfig(): Promise<boolean> } {
	const home = options.home ?? homedir();
	const root = join(home, `.${APP_ID}`);
	const copy = join(root, "pi-bridge");
	const statePath = join(root, "install.json");
 const hostPath = join(root, "host.json");
 const temporaryHost = join(root, "host.tmp");
	const candidates = [join(home, ".pi", "agent"), join(home, ".gentle-shell", "agent")];
	const bridge = resolve(import.meta.dirname, "../../../pi-bridge");
	const protocol = protocolSource;
	const staging = join(root, "pi-bridge.staging");
	const backup = join(root, "pi-bridge.previous");
	const temporaryRecord = join(root, "install.tmp");
	const stat = (path: string) => {
		try { return lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
	};
	const assertSafe = () => {
		const rootStat = stat(root);
		if (rootStat?.isSymbolicLink()) throw new Error(installText.unsafePaths);
		if (!rootStat) return;
		if (!rootStat.isDirectory() || realpathSync(root) !== join(realpathSync(home), `.${APP_ID}`)) throw new Error(installText.unsafePaths);
		const paths = new Set([copy, statePath, hostPath, temporaryHost, staging, backup, temporaryRecord, ...["link-server", "link-server.staging", "link-server.previous", "cli", "cli.staging", "cli.previous", "bin"].map(name => join(root, name))]);
		// Also reject linked leftovers from the previous random-name installer.
		for (const name of readdirSync(root)) if (LEGACY_LEFTOVER.test(name)) paths.add(join(root, name));
		for (const path of paths) if (stat(path)?.isSymbolicLink()) throw new Error(installText.unsafePaths);
	};
	const recover = () => {
		assertSafe();
		if (!existsSync(copy) && existsSync(backup)) renameSync(backup, copy);
  const link = join(root, "link-server");
  if (!existsSync(link) && existsSync(`${link}.previous`)) renameSync(`${link}.previous`, link);
  rmSync(`${link}.staging`, { recursive: true, force: true });
  const cli = join(root, "cli");
  if (!existsSync(cli) && existsSync(`${cli}.previous`)) renameSync(`${cli}.previous`, cli);
  rmSync(`${cli}.staging`, { recursive: true, force: true });
		rmSync(staging, { recursive: true, force: true });
		// install.json is atomically replaced; an interrupted temporary write is not intent.
		rmSync(temporaryRecord, { force: true });
  rmSync(temporaryHost, { force: true });
	};
	const hostConfig = (): Record<string, unknown> => {
  if (!existsSync(hostPath)) return {};
  const value: unknown = JSON.parse(readFileSync(hostPath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(installText.invalidRecord);
  return value as Record<string, unknown>;
 };
 const writeHost = (value: Record<string, unknown>) => {
  try {
   writeFileSync(temporaryHost, `${JSON.stringify(value)}\n`, { mode: 0o600 });
   renameSync(temporaryHost, hostPath);
  } finally { rmSync(temporaryHost, { force: true }); }
 };
 let pi: PiCommand | undefined;
	const run = (verb: string, agent: string, path: string) => {
		if (!pi) throw new Error(installText.missingPi);
		execFileSync(pi.command, [...pi.prefix, verb, path], {
			env: { ...process.env, PI_CODING_AGENT_DIR: agent }, encoding: "utf8", windowsHide: true, shell: false,
		});
	};
	return {
  async writeHostConfig() {
   assertSafe();
   const herdr = (options.herdr ?? findHerdr)();
   mkdirSync(root, { recursive: true, mode: 0o700 });
   const node = stableNodePath();
   if (!isAbsolute(node) || !statSync(node).isFile()) throw new Error("Node executable must be an existing absolute file.");
   accessSync(node, process.platform === "win32" ? constants.F_OK : constants.X_OK);
   const value = hostConfig();
   delete value.herdr;
   // Recorded so `mars-ram launch` over a non-interactive SSH PATH still finds them (presence check only).
   if (options.programs) { delete value.programs; const programs = await options.programs(); if (Object.keys(programs).length) value.programs = programs; }
   writeHost({ ...value, ...(herdr ? { herdr } : {}), node, cli: resolve(root, 'cli/src/main.ts'), linkServer: resolve(root, "link-server/src/main.ts"), linkPort: 47811 });
   return !!herdr;
  },
		async recover() { recover(); },
		async preflight() {
			assertSafe();
			if (process.platform === "win32" && readWindowsPrivileges().elevated) throw new Error(installText.noAdmin);
			pi = findPi();
		},
		async candidateHomes() { return candidates.filter((path) => existsSync(path) && statSync(path).isDirectory()); },
		async readRecord() {
			assertSafe();
			if (!existsSync(statePath)) return undefined;
			const value = JSON.parse(readFileSync(statePath, "utf8")) as InstallRecord;
   if ((value.cli !== undefined && value.cli !== join(root, "cli")) || (value.launcher !== undefined && value.launcher !== launcherPath(home, process.platform)) || (value.addedPath !== undefined && (process.platform !== "win32" || value.addedPath !== join(root, "bin")))) throw new Error(installText.invalidRecord);
			if (value.copy !== copy || !Array.isArray(value.homes) || value.homes.some((entry) => !candidates.includes(entry)) || (value.pending !== undefined && (!Array.isArray(value.pending) || value.pending.some((entry) => !candidates.includes(entry)))) || typeof value.version !== "string" || typeof value.date !== "string") throw new Error(installText.invalidRecord);
			return value;
		},
		async writeRecord(record) {
			assertSafe();
			mkdirSync(root, { recursive: true, mode: 0o700 });
			const temporary = temporaryRecord;
			try {
				writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
				renameSync(temporary, statePath);
			} finally { rmSync(temporary, { force: true }); }
		},
		async buildCopy() {
			recover();
			// Resolve everything before touching the installed copy.
			const require = createRequire(join(protocol, "package.json"));
			let typebox = dirname(realpathSync(require.resolve("typebox")));
			while (!existsSync(join(typebox, "package.json")) || JSON.parse(readFileSync(join(typebox, "package.json"), "utf8")).name !== "typebox") {
				const parent = dirname(typebox);
				if (parent === typebox) throw new Error("Cannot resolve typebox package");
				typebox = parent;
			}
			const packageVersion: unknown = JSON.parse(readFileSync(join(bridge, "package.json"), "utf8")).version;
			mkdirSync(root, { recursive: true, mode: 0o700 });
   checkLauncher(home, process.platform);
   buildCliCopy(root);
   buildLinkCopy(root);
			const temporary = staging;
			mkdirSync(temporary);
			// A completed previous swap may have left a backup; the current copy is usable.
			if (existsSync(copy)) rmSync(backup, { recursive: true, force: true });
			let moved = false;
			try {
				for (const [source, target] of [[bridge, temporary], [protocol, join(temporary, "node_modules/@workspace/protocol")]] as const) {
					mkdirSync(target, { recursive: true });
					for (const name of ["src", "package.json"]) cpSync(join(source, name), join(target, name), { recursive: true, dereference: true });
				}
				cpSync(typebox, join(temporary, "node_modules/typebox"), { recursive: true, dereference: true });
				// Workspace packages are currently unversioned: identify the exact copied bytes instead.
				const hash = createHash("sha256");
				const fingerprint = (folder: string, relative = "") => {
					for (const name of readdirSync(folder).sort()) {
						const path = join(folder, name);
						const key = `${relative}/${name}`;
						if (statSync(path).isDirectory()) fingerprint(path, key);
						else { hash.update(key); hash.update("\0"); hash.update(readFileSync(path)); hash.update("\0"); }
					}
				};
				fingerprint(temporary);
				const version = typeof packageVersion === "string" ? packageVersion : `source-sha256:${hash.digest("hex")}`;
				if (existsSync(copy)) { renameSync(copy, backup); moved = true; }
				try { renameSync(temporary, copy); } catch (error) {
					if (moved) renameSync(backup, copy);
					throw error;
				}
				if (moved) rmSync(backup, { recursive: true, force: true });
				return { copy, version };
			} finally { rmSync(temporary, { recursive: true, force: true }); }
		},
  async installCli(record) {
   assertSafe();
   checkLauncher(home, process.platform);
   // Durable ownership precedes both launcher creation and user-Path mutation.
   record.cli = join(root, "cli");
   record.launcher = launcherPath(home, process.platform);
   await this.writeRecord(record);
   installLauncher(home, stableNodePath(), process.platform);
   if (process.platform === "win32") await updateOwnedUserPath(record, join(root, "bin"), home, true, () => this.writeRecord(record), options.userPath);
  },
		async isRegistered(agent, path) {
			const settings = join(agent, "settings.json");
			if (!existsSync(settings)) return false;
			const packages: unknown = JSON.parse(readFileSync(settings, "utf8")).packages;
			if (!Array.isArray(packages)) return false;
			return packages.some((entry: unknown) => {
				const source = typeof entry === "string" ? entry : entry && typeof entry === "object" && "source" in entry ? entry.source : undefined;
				if (typeof source !== "string") return false;
				const resolved = resolve(agent, source);
				return resolved === resolve(path) || (existsSync(resolved) && existsSync(path) && realpathSync(resolved) === realpathSync(path));
			});
		},
		async register(agent, path) { assertSafe(); run("install", agent, path); },
		async remove(agent, path) { assertSafe(); run("remove", agent, path); },
		async deleteInstallation() {
			assertSafe();
			const config = hostConfig();
   const record = await this.readRecord();
   if (record && process.platform === "win32") await updateOwnedUserPath(record, join(root, "bin"), home, false, () => this.writeRecord(record), options.userPath);
   if (record?.launcher) removeLauncher(home, process.platform);
   let stopFailed = false;
   const linkMain = join(root, "link-server/src/main.ts");
   if (existsSync(linkMain)) {
    try {
     if (!lstatSync(linkMain).isFile() || lstatSync(linkMain).isSymbolicLink() || lstatSync(dirname(linkMain)).isSymbolicLink()) throw new Error("Unsafe link-server entry.");
     execFileSync(process.execPath, [linkMain, "stop"], { timeout: 20000, windowsHide: true, shell: false, stdio: "pipe", env: { ...process.env, HOME: home, USERPROFILE: home } });
    } catch { stopFailed = true; }
   }
   for (const key of ["herdr", "node", "cli", "linkServer", "linkPort", "programs"]) delete config[key];
   for (const path of [copy, staging, backup, ...["link-server", "link-server.staging", "link-server.previous", "cli", "cli.staging", "cli.previous"].map(name => join(root, name))]) rmSync(path, { recursive: true, force: true });
			rmSync(temporaryRecord, { force: true });
			// Leftovers of the earlier random-name installer; assertSafe already refused them as links.
			if (existsSync(root)) for (const name of readdirSync(root)) if (LEGACY_LEFTOVER.test(name)) rmSync(join(root, name), { recursive: true, force: true });
			rmSync(statePath, { force: true });
   if (Object.keys(config).length) writeHost(config);
   else rmSync(hostPath, { force: true });
   rmSync(temporaryHost, { force: true });
   if (stopFailed) throw new Error("Link-server stop failed; installed code was removed, but retained links may still be served until expiry. Check the host process and Windows task manually.");
		},
		clock: () => new Date().toISOString(),
	};
}
