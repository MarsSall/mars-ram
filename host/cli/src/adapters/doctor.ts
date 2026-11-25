// Read-only OS boundary. No shell, writes, repairs, or elevation.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, lstatSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, win32 } from "node:path";
import { decodeRegistryEntry, REGISTRY_DIRECTORY } from "@workspace/protocol";
import { checkUploadsFolder, currentHost, type UploadsFolderHost } from "@workspace/protocol/uploads-folder";
import type { DoctorPorts, RegistryObservation, WindowsDefaultShell } from "../core/doctor.ts";
import { createInstallAdapter, findPi, executableHerdr } from "./installation.ts";
import { keyTarget, parseWindowsPrivileges } from "./authorized-keys.ts";
import { lockOwnerState, unverifiedKeyLock, type LockOwner } from "./authorized-key-file.ts";
import { readTailscaleIp, type ReadOnlyRunner } from "./tailscale.ts";
import { spanish } from "./terminal.ts";
import { zeroTierAddresses, zeroTierInterfaces } from "./zerotier.ts";
import { readFirewall, systemdIsActive } from "./firewall.ts";
import { observeLinkServer } from "./link-doctor.ts";
import { observeCli, protocolSource } from "./cli-installation.ts";
import { enabledHerdrMachines } from "../core/herdr-switcher.ts";

export function parseForwarding(config: string): boolean | undefined {
	let allow: string | undefined;
	let disable: string | undefined;
	for (const raw of config.split(/\r?\n/)) {
		const line = raw.replace(/#.*$/, "").trim();
		if (!line) continue;
		// No user/connection context is available to evaluate Match or unresolved Include.
		if (/^(?:Match|Include)(?:\s|=|$)/i.test(line)) return undefined;
		const directive = line.match(/^(AllowTcpForwarding|DisableForwarding)(?:\s+|\s*=\s*)(\S+)\s*$/i);
		if (!directive) {
			if (/^(?:AllowTcpForwarding|DisableForwarding)\b/i.test(line)) return undefined;
			continue;
		}
		const value = directive[2]!.toLowerCase();
		if (directive[1]!.toLowerCase() === "allowtcpforwarding") {
			if (!["yes", "all", "local", "no", "remote"].includes(value)) return undefined;
			allow ??= value;
		} else {
			if (!["yes", "no"].includes(value)) return undefined;
			disable ??= value;
		}
	}
	if (disable === "yes" || allow === "no" || allow === "remote") return false;
	// A config that was read and never sets it gets sshd's default, which allows forwarding.
	return true;
}
export function pairingKeysAllowForwarding(contents: string): boolean {
	return contents.split(/\r?\n/).every((line) => {
		if (/^\s*(?:#|$)/.test(line)) return true;
		// Split whitespace outside quoted options; comments start only after type and blob.
		const fields = line.trim().match(/(?:[^\s"\\]|\\.|"(?:[^"\\]|\\.)*")+/g) ?? [];
		const type = fields.findIndex((field) => /^(?:ssh-|ecdsa-|sk-)/.test(field));
		if (type < 0 || !fields[type + 2]?.startsWith("mars-ram:")) return true;
		if (type === 0) return true;
		const options = (fields[0] ?? "").split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
		return !options.includes("no-port-forwarding") && (!options.includes("restrict") || options.includes("port-forwarding"));
	});
}
/** The folders under ~/.mars-ram that hold secrets on Windows, each restricted to the current user with a protected
 * ACL when created: agents (agent hook tokens in lock markers), bridges (bridge tokens), links (link copies, tokens
 * and server identity records) and notify (per-phone notification secrets). Code, logs and settings are not secrets. */
export const WINDOWS_SECRET_FOLDERS = ["agents", "bridges", "links", "notify"] as const;
/** One Allow entry: SID, FileSystemRights as an unsigned 32-bit mask, and its account name when it is not allowed. */
export type WindowsAclRule = { sid: string; rights: number; name?: string | null };
/** dir: a directory; reparse: a reparse point (junction, symlink, mount point), never followed and never private. */
export type WindowsAclItem = { owner: string; protected: boolean; dir: boolean; reparse: boolean; rules: WindowsAclRule[] };
// Read and execute only: ReadData/ListDirectory, ReadExtendedAttributes, ExecuteFile/Traverse, ReadAttributes,
// ReadPermissions, Synchronize, GENERIC_EXECUTE and GENERIC_READ. Every other bit can write, delete, change
// permissions or take ownership.
const READ_ONLY_RIGHTS = 0x1 | 0x8 | 0x20 | 0x80 | 0x20000 | 0x100000 | 0x20000000 | 0x80000000;
const validItem = (item: unknown): item is WindowsAclItem => {
	const value = item as WindowsAclItem;
	// A missing or error marker mixed into an ACL is a malformed result, never a valid one.
	return !!value && typeof value === "object" && !("missing" in value) && !("error" in value)
		&& typeof value.owner === "string" && typeof value.protected === "boolean" && typeof value.dir === "boolean" && typeof value.reparse === "boolean" && Array.isArray(value.rules)
		&& value.rules.every((rule) => !!rule && typeof rule.sid === "string" && Number.isInteger(rule.rights) && rule.rights >= 0 && rule.rights <= 0xFFFFFFFF);
};
/** Exactly `{missing: true}`: anything else that mentions missing is malformed. */
const reportedMissing = (item: unknown) => !!item && typeof item === "object" && Object.keys(item).length === 1 && (item as { missing?: unknown }).missing === true;
/**
 * Judges Mars-RAM's Windows ACLs by SID. Secret folders and every descendant must be owned by and allow only the user,
 * SYSTEM and Administrators, and none may be a reparse point; a secret folder under the root that inherits from a
 * root with other entries is unsafe too, and a secret folder outside the root (an overridden bridge registry) must
 * be protected. The root and every secret folder must be a directory and not a reparse point. The root must have such
 * an owner, and other accounts may only read it: they are returned as readers. When the root is itself the bridge
 * registry (`rootSecret`), it holds tokens and is judged as a secret folder: private and protected, no readers.
 */
export function judgeWindowsAcl(user: string, root: unknown, folders: unknown[], entries: unknown[], outside: unknown[] = [], rootSecret = false): { safe: boolean; administratorOwner: boolean; readers: string[] } {
	const allowed = new Set([user, "S-1-5-18", "S-1-5-32-544"]);
	if (!user || !validItem(root)) return { safe: false, administratorOwner: false, readers: [] };
	const extra = root.rules.filter((rule) => !allowed.has(rule.sid));
	const privateItem = (item: unknown): item is WindowsAclItem => validItem(item) && !item.reparse && allowed.has(item.owner) && item.rules.length > 0 && item.rules.every((rule) => allowed.has(rule.sid));
	const folder = (item: unknown): item is WindowsAclItem => privateItem(item) && item.dir;
	const safe = root.dir && !root.reparse && allowed.has(root.owner) && root.rules.length > 0 && extra.every((rule) => (rule.rights & ~READ_ONLY_RIGHTS) === 0)
		&& (!rootSecret || (folder(root) && root.protected))
		&& folders.every((item) => folder(item) && (item.protected || !extra.length)) && entries.every(privateItem)
		&& outside.every((item) => folder(item) && item.protected);
	return { safe, administratorOwner: root.owner === "S-1-5-32-544", readers: safe ? [...new Set(extra.map((rule) => rule.name || rule.sid))] : [] };
}
// Read-only: paths travel base64-encoded as data, never as script text. Get-Item -Force gives the type and the
// ReparsePoint attribute of the path itself (a junction or symlink is reported, not followed). Allow entries are read
// as SIDs; only accounts outside user/SYSTEM/Administrators are translated to names (a bounded lookup), sent as UTF-8
// base64 so the console code page cannot garble them. A path Test-Path does not find is reported as missing (the
// caller re-checks it); any other failure is an error, which the caller judges unsafe.
const aclScript = (data: string) => `$ErrorActionPreference='Stop'; $s=[System.Security.Principal.SecurityIdentifier]; $n=[System.Security.Principal.NTAccount]; $u=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $k=@($u,'S-1-5-18','S-1-5-32-544'); $paths=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}'))); $items=@(foreach ($p in @($paths)) { try { if (-not (Test-Path -LiteralPath $p)) { @{missing=$true}; continue }; $i=Get-Item -LiteralPath $p -Force; $a=Get-Acl -LiteralPath $p; @{owner=$a.GetOwner($s).Value; 'protected'=$a.AreAccessRulesProtected; dir=[bool]$i.PSIsContainer; reparse=[bool](($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0); rules=@($a.GetAccessRules($true,$true,$s) | Where-Object { $_.AccessControlType -eq 'Allow' } | ForEach-Object { $r=$_; $sid=$r.IdentityReference.Value; $name=$null; if ($k -notcontains $sid) { try { $name=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($r.IdentityReference.Translate($n).Value)) } catch { $name=$null } }; @{sid=$sid; rights=([int64][int]$r.FileSystemRights) -band 4294967295; name64=$name} })} } catch { @{error=$true} } }); @{user=$u; items=$items} | ConvertTo-Json -Compress -Depth 5`;
// Keep each command line well under Windows' 32,767-character limit, and the whole check bounded.
const ACL_PATHS_PER_CALL = 32;
const ACL_DATA_PER_CALL = 6000;
const ACL_MAX_PATHS = 1024;
export function parseSshService(output: string): boolean { return /^\s*[^:\r\n]+:\s*4(?:\s|$)/m.test(output); }
export function parseDefaultShell(output: string): WindowsDefaultShell {
	if (!output.trim()) return "cmd";
	const value = output.match(/^\s*DefaultShell\s+REG_(?:EXPAND_)?SZ\s+([^\r\n]+?)\s*$/im)?.[1];
	if (!value) return "other";
	const executable = win32.basename(value.replace(/^"(.*)"$/, "$1")).toLowerCase();
	if (executable === "cmd.exe") return "cmd";
	if (executable === "powershell.exe" || executable === "pwsh.exe") return "powershell";
	return "other";
}

export interface DoctorIO {
	run: ReadOnlyRunner;
	read(path: string): string | undefined;
	list(path: string): string[];
	mode(path: string): number;
	/** lstat's type: a symlink or junction is a link, never followed. Optional for fakes; without it only mode -1 is a link. */
	type?(path: string): "directory" | "file" | "link" | "other";
}
const io: DoctorIO = {
	run: (command, args) => execFileSync(command, args, { encoding: "utf8", windowsHide: true, shell: false, timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] }),
	read(path) {
		try { return readFileSync(path, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
	},
	list(path) {
		try { return readdirSync(path).sort(); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
	},
	mode: (path) => {
		const stat = lstatSync(path);
		// Symlinks/directories in the token registry are not regular private files.
		if (stat.isSymbolicLink()) return -1;
		return stat.mode & 0o7777;
	},
	type: (path) => {
		// Node reports Windows junctions as symbolic links too.
		const stat = lstatSync(path);
		return stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other";
	},
};

/** Compare the same source/dependency bytes copied by install, without building a new copy. */
export function copyIsCurrent(copy: string): boolean {
	const bridge = resolve(import.meta.dirname, "../../../pi-bridge");
	const protocol = protocolSource;
	const require = createRequire(join(protocol, "package.json"));
	let typebox = dirname(realpathSync(require.resolve("typebox")));
	while (!existsSync(join(typebox, "package.json")) || JSON.parse(readFileSync(join(typebox, "package.json"), "utf8")).name !== "typebox") {
		const parent = dirname(typebox);
		if (parent === typebox) throw new Error("Cannot resolve typebox");
		typebox = parent;
	}
	const fingerprint = (folder: string): string => {
		const hash = createHash("sha256");
		const visit = (path: string, key = "") => {
			if (statSync(path).isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name), `${key}/${name}`);
			else { hash.update(key); hash.update("\0"); hash.update(readFileSync(path)); hash.update("\0"); }
		};
		visit(folder);
		return hash.digest("hex");
	};
	try {
		return [[join(bridge, "src"), join(copy, "src")], [join(bridge, "package.json"), join(copy, "package.json")],
			[join(protocol, "src"), join(copy, "node_modules/@workspace/protocol/src")], [join(protocol, "package.json"), join(copy, "node_modules/@workspace/protocol/package.json")],
			[typebox, join(copy, "node_modules/typebox")]].every(([source, target]) => fingerprint(source!) === fingerprint(target!));
	} catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export function createDoctorAdapter(options: { home?: string; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; io?: DoctorIO; installation?: DoctorPorts["installation"]; pi?: typeof findPi; uploadsHost?: UploadsFolderHost; claudeHooks?: DoctorPorts["claudeHooks"]; codexHooks?: DoctorPorts["codexHooks"] } = {}): DoctorPorts {
	const home = options.home ?? homedir();
	const platform = options.platform ?? process.platform;
	const fs = options.io ?? io;
	const paths = platform === "win32" ? win32 : { join, dirname, basename };
	const root = paths.join(home, ".mars-ram");
	const bridges = paths.join(root, "bridges");
	const programData = process.env.ProgramData ?? "C:\\ProgramData";
	const env = options.env ?? process.env;
	// lstat's type; a fake without type() only knows links by mode -1.
	const kind = (path: string) => fs.type ? fs.type(path) : fs.mode(path) === -1 ? "link" : undefined;
	// Only a drive path (X:\) or a UNC share (\\server\share\) names the same folder for every bridge; a drive-less
	// \path depends on the current drive, and C:path on that drive's current folder.
	const fullyQualified = (path: string) => /^[A-Za-z]:[\\/]/.test(path) || /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/.test(path);
	/**
	 * A fully qualified PI_BRIDGE_REGISTRY_DIR (Windows), walked with lstat from below its drive or share root down to the
	 * leaf before the leaf is used: the first component that is a link, junction or not a folder (`unfollowed`, and
	 * nothing below it is touched), or whether the leaf exists. Undefined without such an override.
	 */
	const overrideWay = (): { leaf: string; unfollowed?: string; present: boolean } | undefined => {
		const value = env.PI_BRIDGE_REGISTRY_DIR;
		if (platform !== "win32" || value === undefined || !fullyQualified(value)) return undefined;
		const leaf = win32.resolve(value);
		const top = win32.parse(leaf).root;
		let path = top;
		for (const part of leaf.slice(top.length).split(/[\\/]+/).filter(Boolean)) {
			path = win32.join(path, part);
			let found: ReturnType<typeof kind>;
			try { found = kind(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { leaf, present: false }; throw error; }
			if (found !== undefined && found !== "directory") return { leaf, unfollowed: path, present: false };
		}
		return { leaf, present: true };
	};
	let registryPromise: Promise<RegistryObservation> | undefined;
	const registry = async (): Promise<RegistryObservation> => {
		// Cache a single read-only snapshot for the loaded/permissions checks.
		return registryPromise ??= Promise.resolve().then(() => {
			// On Windows the root and the registry folder must be real folders and entries real files before anything is
			// listed or read: a symlink, junction or file in their place is reported, never followed.
			// The same holds for every folder on the way to a PI_BRIDGE_REGISTRY_DIR override, checked after the root.
			const unfollowed: string[] = [];
			const absent = (): RegistryObservation => ({ exists: false, entries: [], modes: [], ...(unfollowed.length ? { unfollowed } : {}) });
			if (platform === "win32") {
				for (const folder of [root, bridges]) {
					let found: ReturnType<typeof kind>;
					try { found = kind(folder); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return absent(); throw error; }
					if (found !== undefined && found !== "directory") { unfollowed.push(folder); return absent(); }
					if (folder === root) { const way = overrideWay(); if (way?.unfollowed) unfollowed.push(way.unfollowed); }
				}
			}
			let directoryMode: number;
			try { directoryMode = fs.mode(bridges); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return absent(); throw error; }
			const entries: RegistryObservation["entries"] = [];
			const modes: (number | undefined)[] = [];
			for (const name of fs.list(bridges)) {
				const path = paths.join(bridges, name);
				try { modes.push(fs.mode(path)); } catch { modes.push(undefined); }
				if (platform === "win32") {
					let found: ReturnType<typeof kind>;
					try { found = kind(path); } catch { continue; }
					if (found === "link") { unfollowed.push(path); continue; }
				}
				if (!name.endsWith(".json")) continue;
				try {
					const decoded = decodeRegistryEntry(JSON.parse(fs.read(path) ?? "null"));
					entries.push({ name, ...(decoded.ok ? { pid: decoded.value.pid } : {}) });
				} catch { entries.push({ name }); }
			}
			return { exists: true, directoryMode, entries, modes, ...(unfollowed.length ? { unfollowed } : {}) };
		});
	};
	return {
		platform, spanish,
  async cli() { return observeCli(home, platform); },
  async linkServer() { return observeLinkServer(root); },
  async herdr() {
   try { return executableHerdr(JSON.parse(fs.read(paths.join(root, "host.json")) ?? "{}").herdr, platform); }
   catch { return false; }
  },
  async herdrMachines() {
   // Only the recorded Herdr (the one the phone's terminal runs); never a PATH guess.
   let herdr: unknown;
   try { herdr = JSON.parse(fs.read(paths.join(root, "host.json")) ?? "{}").herdr; } catch { return []; }
   if (!executableHerdr(herdr, platform)) return [];
   try { return enabledHerdrMachines(fs.run(herdr, ["machine", "list"])); } catch { return []; }
  },
		async piVersion() { const pi = (options.pi ?? findPi)(); return fs.run(pi.command, [...pi.prefix, "--version"]); },
		installation: options.installation ?? (async () => {
			const installer = createInstallAdapter({ home });
			const record = await installer.readRecord();
			const copy = paths.join(root, "pi-bridge");
			const homes = await Promise.all((await installer.candidateHomes()).map(async (path) => ({ path, registered: await installer.isRegistered(path, copy) })));
			return { present: !!record, current: !!record && copyIsCurrent(copy), homes };
		}),
		claudeHooks: options.claudeHooks ?? (async () => createInstallAdapter({ home }).claude.status()),
		codexHooks: options.codexHooks ?? (async () => createInstallAdapter({ home }).codex.status()),
		registry,
		alive(pid) {
			if (!Number.isInteger(pid) || pid <= 0) return false;
			try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
		},
		async acl() {
			// The root, and every secret folder that exists with all its descendants: the bridges' writers and the link
			// server restrict each nested record (session lock markers with hook tokens, link.json, link copies) on its
			// own, so a private folder says nothing about them. Code, logs and settings are judged only through the root,
			// where other accounts may read (Codex's sandbox adds such an entry).
			const key = (path: string) => win32.resolve(path).toLowerCase();
			const inRoot = (path: string) => key(path).startsWith(`${key(root)}\\`);
			const exists = (path: string) => { try { fs.mode(path); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ENOENT"; } };
			const folders = WINDOWS_SECRET_FOLDERS.map((name) => paths.join(root, name));
			// The registry the bridges publish to, resolved as they do (PI_BRIDGE_REGISTRY_DIR, else ~/.mars-ram/bridges).
			// An override that is not fully qualified (relative, empty, drive-less) depends on each bridge's working folder or
			// drive, so it cannot be checked: unsafe. An override that is the root makes the root a secret folder.
			const override = env.PI_BRIDGE_REGISTRY_DIR;
			const registryDir = override ?? paths.join(home, REGISTRY_DIRECTORY);
			let unknownRegistry = false;
			let rootSecret = false;
			const outside: string[] = [];
			if (!fullyQualified(registryDir)) unknownRegistry = true;
			else if (key(registryDir) === key(root)) rootSecret = true;
			else if (!folders.some((folder) => key(folder) === key(registryDir) || key(registryDir).startsWith(`${key(folder)}\\`))) {
				(inRoot(registryDir) ? folders : outside).push(win32.resolve(registryDir));
			}
			const observed = new Map<string, unknown>();
			const named = (item: unknown) => {
				const rules = (item as { rules?: unknown } | null)?.rules;
				if (!Array.isArray(rules)) return item;
				return { ...(item as object), rules: rules.map((rule: { name64?: unknown }) => {
					if (!rule || typeof rule !== "object") return rule;
					const { name64, ...rest } = rule;
					return typeof name64 === "string" ? { ...rest, name: Buffer.from(name64, "base64").toString("utf8") } : rest;
				}) };
			};
			let user = "";
			const ask = (chunk: string[]) => {
				// -Command concatenates argv on Windows; the complete fixed script goes encoded, the paths inside it as data.
				const script = aclScript(Buffer.from(JSON.stringify(chunk), "utf8").toString("base64"));
				const value = JSON.parse(fs.run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")])) as { user?: unknown; items?: unknown };
				if (typeof value?.user !== "string" || !Array.isArray(value.items) || value.items.length !== chunk.length || (user && user !== value.user)) throw new Error("Unexpected ACL output");
				user = value.user;
				chunk.forEach((path, index) => observed.set(path, named((value.items as unknown[])[index])));
			};
			const askAll = (list: string[]) => {
				let chunk: string[] = [];
				for (const path of list) {
					const next = [...chunk, path];
					if (chunk.length && (next.length > ACL_PATHS_PER_CALL || Buffer.byteLength(JSON.stringify(next)) * 4 / 3 > ACL_DATA_PER_CALL)) { ask(chunk); chunk = [path]; }
					else chunk = next;
				}
				if (chunk.length) ask(chunk);
			};
			// A path PowerShell did not find counts as gone only when it is still gone now; a path that is there after
			// all (a broken link, an unreadable entry) is unsafe.
			const gone = (path: string) => { try { fs.mode(path); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT"; } };
			const unsafe = { error: true };
			const judged = new Map<string, unknown>();
			// The root first, alone: nothing under it is probed unless it is a directory and not a reparse point.
			askAll([root]);
			const rootItem = observed.get(root);
			if (reportedMissing(rootItem)) throw new Error("Mars-RAM folder missing");
			if (!validItem(rootItem) || !rootItem.dir || rootItem.reparse) return judgeWindowsAcl(user, rootItem, [], [], [], rootSecret);
			// Every folder on the way to an override first: a link, junction or file there leaves the registry unknown, and
			// neither the leaf nor anything under that component is probed (doctor's registry check names it).
			const way = overrideWay();
			if (way && !way.present) {
				for (const list of [folders, outside]) { const at = list.findIndex((path) => key(path) === key(way.leaf)); if (at >= 0) list.splice(at, 1); }
				if (way.unfollowed) unknownRegistry = true;
			}
			// The registry being the root: everything under the root is a descendant of a secret folder.
			const tops = rootSecret ? [] : [...folders, ...outside].filter(exists);
			// Breadth first, one level per round, each directory listed only after PowerShell said it is a directory and
			// not a reparse point; at most ACL_MAX_PATHS paths in total, beyond that the check stops as too many.
			let level = rootSecret ? fs.list(root).map((name) => paths.join(root, name)) : tops;
			let total = 1 + level.length;
			let tooMany = total > ACL_MAX_PATHS;
			while (level.length && !tooMany) {
				askAll(level);
				const next: string[] = [];
				for (const path of level) {
					const item = observed.get(path);
					if (reportedMissing(item)) { if (!gone(path)) judged.set(path, unsafe); continue; }
					judged.set(path, item);
					if (!validItem(item) || !item.dir || item.reparse) continue;
					const children = fs.list(path).map((name) => paths.join(path, name));
					total += children.length;
					if (total > ACL_MAX_PATHS) { tooMany = true; break; }
					next.push(...children);
				}
				level = next;
			}
			const pick = (list: string[]) => list.filter((path) => tops.includes(path) && judged.has(path)).map((path) => judged.get(path));
			const descendants = [...judged.keys()].filter((path) => !tops.includes(path)).map((path) => judged.get(path));
			const verdict = judgeWindowsAcl(user, rootItem, pick(folders), [...descendants, ...(unknownRegistry ? [unsafe] : [])], pick(outside), rootSecret);
			return tooMany ? { safe: false, administratorOwner: verdict.administratorOwner, readers: [], tooMany: true } : verdict;
		},
		async tailscale() { return readTailscaleIp(fs.run); },
		async zerotier() { return zeroTierAddresses(undefined, platform); },
		async zeroTierInterfaces() { return zeroTierInterfaces(undefined, platform).map((entry) => entry.name); },
		async firewall() { return readFirewall({ read: fs.read, isActive: systemdIsActive(fs.run) }, platform); },
  async keyLocks() {
   const privileges = platform === 'win32' ? parseWindowsPrivileges(fs.run('whoami', ['/groups', '/fo', 'csv'])) : { administrator: false };
   const target = keyTarget(platform, { home, programData, administrator: privileges.administrator });
   const findings: (string | { path: string; diagnostic: string })[] = [];
   const folder = paths.dirname(target.path), base = paths.basename(target.path) + '.lock';
   const names = fs.list(folder);
   for (const path of [target.path + '.lock', target.path + '.lock.recovery']) {
    let data: string | undefined;
    try { data = fs.read(`${path}/owner.json`); }
    catch { findings.push(path); continue; }
    if (data === undefined) {
     if (names.includes(paths.basename(path))) findings.push(path);
     continue;
    }
    let owner: LockOwner;
    try {
     owner = JSON.parse(data) as LockOwner;
     if (!owner || typeof owner.id !== 'string' || !Number.isSafeInteger(owner.pid) || typeof owner.createdAt !== 'number'
      || !(owner.startTime === null || typeof owner.startTime === 'string')) throw Error('Invalid owner');
    } catch { findings.push(path); continue; }
    const state = lockOwnerState(owner, { platform, run: (command, args) => fs.run(command, args) });
    if (state === 'dead') findings.push(path);
    if (state === 'unverified') findings.push({ path, diagnostic: unverifiedKeyLock(path, owner) });
   }
   for (const name of names) {
    if (name.startsWith(base + '.') && name.endsWith('.trash')) findings.push(paths.join(folder, name));
   }
   return findings;
  },
		async forwarding() {
			let config: string | undefined;
			if (platform !== "win32") {
				try { config = fs.run("sshd", ["-T"]); } catch { /* Unprivileged sshd often cannot read host keys; inspect config instead. */ }
			}
			if (config === undefined) {
				try {
					const folder = platform === "win32" ? paths.join(programData, "ssh") : "/etc/ssh";
					const source = fs.read(paths.join(folder, "sshd_config"));
					if (source !== undefined) {
						const lines: string[] = [];
						for (const line of source.split(/\r?\n/)) {
							if (/^\s*Include\s+(?:\/etc\/ssh\/)?sshd_config\.d\/\*\.conf\s*(?:#.*)?$/i.test(line) && platform !== "win32") {
								const includeFolder = paths.join(folder, "sshd_config.d");
								for (const name of fs.list(includeFolder).filter((name) => name.endsWith(".conf")).sort()) {
									const included = fs.read(paths.join(includeFolder, name));
									if (included === undefined) throw Error("Unreadable Include");
									lines.push(included);
								}
							} else lines.push(line);
						}
						config = lines.join("\n");
					}
				} catch { config = undefined; }
			}
			let keysAllowed: boolean | undefined;
			let windows: { windowsElevated: boolean; administratorsKeys: boolean } | undefined;
			try {
				const privileges = platform === "win32" ? parseWindowsPrivileges(fs.run("whoami", ["/groups", "/fo", "csv"])) : { administrator: false, elevated: false };
				const target = keyTarget(platform, { home, programData, administrator: privileges.administrator });
				if (platform === "win32") windows = { windowsElevated: privileges.elevated, administratorsKeys: target.kind === "windows-administrators" };
				keysAllowed = pairingKeysAllowForwarding(fs.read(target.path) ?? "");
			} catch { /* Key access cannot erase the independent sshd observation. */ }
			return { allowed: config === undefined ? undefined : parseForwarding(config), keysAllowed, ...windows };
		},
		async uploads() {
			let legacy = true;
			try { lstatSync(paths.join(root, "uploads")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") legacy = false; }
			return { state: await checkUploadsFolder(options.uploadsHost ?? currentHost()), legacy };
		},
		async windows() {
			let service = false;
			let shell: WindowsDefaultShell = "cmd";
			try { service = parseSshService(fs.run("sc.exe", ["query", "sshd"])); } catch { /* Missing service. */ }
			try { shell = parseDefaultShell(fs.run("reg.exe", ["query", "HKLM\\SOFTWARE\\OpenSSH", "/v", "DefaultShell"])); } catch { /* Missing value: OpenSSH defaults to cmd. */ }
			return { service, shell };
		},
	};
}
