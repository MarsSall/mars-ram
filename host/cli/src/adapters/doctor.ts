// Read-only OS boundary. No shell, writes, repairs, or elevation.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, lstatSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, win32 } from "node:path";
import { decodeRegistryEntry } from "@workspace/protocol";
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
export function parseWindowsAcl(value: { owner: string; user: string; grants: string[] }): { safe: boolean; administratorOwner: boolean } {
	const allowed = new Set([value.user, "S-1-5-18", "S-1-5-32-544"]);
	return { safe: !!value.user && allowed.has(value.owner) && value.grants.length > 0 && value.grants.every((sid) => allowed.has(sid)), administratorOwner: value.owner === "S-1-5-32-544" };
}
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

export function createDoctorAdapter(options: { home?: string; platform?: NodeJS.Platform; io?: DoctorIO; installation?: DoctorPorts["installation"]; pi?: typeof findPi; uploadsHost?: UploadsFolderHost } = {}): DoctorPorts {
	const home = options.home ?? homedir();
	const platform = options.platform ?? process.platform;
	const fs = options.io ?? io;
	const paths = platform === "win32" ? win32 : { join, dirname, basename };
	const root = paths.join(home, ".mars-ram");
	const bridges = paths.join(root, "bridges");
	const programData = process.env.ProgramData ?? "C:\\ProgramData";
	let registryPromise: Promise<RegistryObservation> | undefined;
	const registry = async (): Promise<RegistryObservation> => {
		// Cache a single read-only snapshot for the loaded/permissions checks.
		return registryPromise ??= Promise.resolve().then(() => {
			let directoryMode: number;
			try { directoryMode = fs.mode(bridges); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, entries: [], modes: [] }; throw error; }
			const entries: RegistryObservation["entries"] = [];
			const modes: (number | undefined)[] = [];
			for (const name of fs.list(bridges)) {
				const path = paths.join(bridges, name);
				try { modes.push(fs.mode(path)); } catch { modes.push(undefined); }
				if (!name.endsWith(".json")) continue;
				try {
					const decoded = decodeRegistryEntry(JSON.parse(fs.read(path) ?? "null"));
					entries.push({ name, ...(decoded.ok ? { pid: decoded.value.pid } : {}) });
				} catch { entries.push({ name }); }
			}
			return { exists: true, directoryMode, entries, modes };
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
		async piVersion() { const pi = (options.pi ?? findPi)(); return fs.run(pi.command, [...pi.prefix, "--version"]); },
		installation: options.installation ?? (async () => {
			const installer = createInstallAdapter({ home });
			const record = await installer.readRecord();
			const copy = paths.join(root, "pi-bridge");
			const homes = await Promise.all((await installer.candidateHomes()).map(async (path) => ({ path, registered: await installer.isRegistered(path, copy) })));
			return { present: !!record, current: !!record && copyIsCurrent(copy), homes };
		}),
		registry,
		alive(pid) {
			if (!Number.isInteger(pid) || pid <= 0) return false;
			try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
		},
		async acl() {
			// Encode the literal path as data, and the complete fixed read-only script for PowerShell.
			// -Command concatenates argv on Windows; passing a raw path there is not safe.
			const parse = (path: string) => {
				const data = Buffer.from(path, "utf8").toString("base64");
				const script = `$ErrorActionPreference='Stop'; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')); $a=Get-Acl -LiteralPath $p; $u=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $s=[System.Security.Principal.SecurityIdentifier]; @{owner=$a.GetOwner($s).Value; user=$u; grants=@($a.Access | Where-Object AccessControlType -eq Allow | ForEach-Object { $_.IdentityReference.Translate($s).Value })} | ConvertTo-Json -Compress`;
				return parseWindowsAcl(JSON.parse(fs.run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")])));
			};
			const rootAcl = parse(root);
			// Check the token-bearing children as well as the product root.
			const observation = await registry();
			let safe = rootAcl.safe;
			if (observation.exists) {
				safe = parse(bridges).safe && safe;
				for (const name of fs.list(bridges)) safe = parse(paths.join(bridges, name)).safe && safe;
			}
			return { safe, administratorOwner: rootAcl.administratorOwner };
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
			try {
				const privileges = platform === "win32" ? parseWindowsPrivileges(fs.run("whoami", ["/groups", "/fo", "csv"])) : { administrator: false };
				const target = keyTarget(platform, { home, programData, administrator: privileges.administrator });
				keysAllowed = pairingKeysAllowForwarding(fs.read(target.path) ?? "");
			} catch { /* Key access cannot erase the independent sshd observation. */ }
			return { allowed: config === undefined ? undefined : parseForwarding(config), keysAllowed };
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
