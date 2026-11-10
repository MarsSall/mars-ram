import { execFile, spawn } from "node:child_process";
import { request } from "node:http";
import { join } from "node:path";
import { readdir, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import type { ListenAddress, ServerLauncher } from "../core/ports.ts";
import { readRegular, writePrivate } from "./file-store.ts";
import { isIpv4 } from "./zerotier.ts";

// One process per listening address: the Tailscale one keeps its original files, task and arguments;
// each ZeroTier address gets its own identity file and Windows task, so starting one never restarts the other.
const ZERO_TIER_RECORD = /^server-zerotier-(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\.pid\.json$/;
const zeroTier = (address?: ListenAddress | PidRecord) => {
	if (address?.network !== "zerotier") return undefined;
	if (!isIpv4(address.ip)) throw new Error("Invalid ZeroTier address.");
	return address.ip;
};
export function pidFileName(address: ListenAddress | PidRecord): string {
	const ip = zeroTier(address);
	return ip ? `server-zerotier-${ip}.pid.json` : "server.pid.json";
}
export function taskName(address?: ListenAddress): string {
	const ip = zeroTier(address);
	return ip ? `mars-ram-links-zerotier-${ip.replaceAll(".", "-")}` : "mars-ram-links";
}
function serveArguments(port: number, address?: ListenAddress): string[] {
	const ip = zeroTier(address);
	return ["serve", "--port", String(port), ...(ip ? ["--network", "zerotier", "--address", ip] : [])];
}
export function windowsTaskCommand(node: string, main: string, port: number, address?: ListenAddress): string {
	// Task Scheduler parses an executable command line directly (not cmd.exe).
	// Reject quotes/control chars; quote both absolute paths, including spaces and &.
	const quote = (path: string) => {
		if (!path || /["\x00-\x1f]/.test(path) || path.endsWith("\\")) throw new Error("Unsafe scheduled task path.");
		return `"${path}"`;
	};
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port.");
	return `${quote(node)} ${quote(main)} ${serveArguments(port, address).join(" ")}`;
}
type LaunchIO = {
	exec(file: string, args: string[]): Promise<unknown>;
	spawn(file: string, args: string[], options: { detached: true; stdio: "ignore"; windowsHide: true }): { unref(): void };
};
export async function launchServer(platform: NodeJS.Platform, node: string, main: string, port: number, io: LaunchIO, address?: ListenAddress): Promise<void> {
	if (platform === "win32") {
		const task = taskName(address);
		await io.exec("schtasks.exe", ["/create", "/tn", task, "/sc", "once", "/st", "23:59", "/tr", windowsTaskCommand(node, main, port, address), "/rl", "LIMITED", "/f"]);
		try { await io.exec("schtasks.exe", ["/run", "/tn", task]); }
		finally { await io.exec("schtasks.exe", ["/change", "/tn", task, "/disable"]); }
	} else {
		// detached:true invokes setsid on POSIX; no shell or inherited SSH descriptors.
		io.spawn(node, [main, ...serveArguments(port, address)], { detached: true, stdio: "ignore", windowsHide: true }).unref();
	}
}
export async function stopWindowsTask(confirmed: boolean, exec: LaunchIO["exec"], task = "mars-ram-links"): Promise<void> {
	// The name is embedded in a PowerShell command: only names built by taskName.
	if (!/^mars-ram-links(?:-zerotier(?:-\d{1,3}){4})?$/.test(task)) throw new Error("Invalid scheduled task name.");
	// Enumerate successfully (fail on access errors), so an absent task is an idempotent no-op.
	// Removing a task does not terminate its process; /end is reserved for confirmed boots.
	await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
		`$ErrorActionPreference = 'Stop'; $task = Get-ScheduledTask | Where-Object { $_.TaskName -eq '${task}' -and $_.TaskPath -eq '\\' }; if ($task) { `
		+ (confirmed ? `& schtasks.exe /end /tn ${task}; if ($LASTEXITCODE -ne 0) { throw 'Task stop failed' }; ` : "")
		+ `& schtasks.exe /delete /tn ${task} /f; if ($LASTEXITCODE -ne 0) { throw 'Task removal failed' } }`]);
}
// Fixed text, no input: root-folder tasks whose whole name is a ZeroTier link-server task name.
const ZERO_TIER_TASK = /^mars-ram-links-zerotier-([0-9]{1,3})-([0-9]{1,3})-([0-9]{1,3})-([0-9]{1,3})$/;
const ZERO_TIER_TASK_QUERY = "$ErrorActionPreference = 'Stop'; Get-ScheduledTask | Where-Object { $_.TaskPath -eq '\\' -and $_.TaskName -cmatch '^mars-ram-links-zerotier-[0-9]{1,3}-[0-9]{1,3}-[0-9]{1,3}-[0-9]{1,3}$' } | ForEach-Object { $_.TaskName }";
/**
 * ZeroTier listeners that have a Windows task, found by name: a task outlives its identity file (the server removes
 * that file when it exits), and stop must still remove it. Every returned name is validated again here.
 */
export async function windowsZeroTierTasks(exec: LaunchIO["exec"]): Promise<ListenAddress[]> {
	const result = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ZERO_TIER_TASK_QUERY]);
	const stdout = result && typeof result === "object" && "stdout" in result ? String(result.stdout) : "";
	const ips = stdout.split(/\r?\n/).map(line => ZERO_TIER_TASK.exec(line.trim())?.slice(1).join(".")).filter((ip): ip is string => !!ip && isIpv4(ip));
	return [...new Set(ips)].slice(0, 16).map(ip => ({ ip, dnsName: ip, network: "zerotier" as const }));
}
export type PidRecord = { pid: number; startedAt: string; instance: string; ip: string; port: number; network?: "zerotier" };
export async function publishPid(root: string, record: PidRecord): Promise<() => Promise<void>> {
	const path = join(root, pidFileName(record));
	// Only called after binding successfully: another listener cannot own this endpoint.
	try { await readRegular(path, 4096); await unlink(path); }
	catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
	await writePrivate(path, JSON.stringify(record));
	return async () => {
		try {
			const current = JSON.parse((await readRegular(path, 4096)).toString()) as PidRecord;
			if (current.instance === record.instance) await unlink(path);
		} catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
	};
}
function probe(ip: string, port: number, instance: string): Promise<boolean> {
	return new Promise(resolve => {
		const finish = (value: boolean) => { clearTimeout(deadline); resolve(value); };
		const req = request({ host: ip, port, path: "/", method: "HEAD", timeout: 1000, agent: false }, res => {
			const matches = res.statusCode === 404 && res.headers["x-mars-links-instance"] === instance;
			res.resume(); res.once("end", () => finish(matches)); res.once("error", () => finish(false));
		});
		const deadline = setTimeout(() => { req.destroy(); finish(false); }, 1000);
		req.on("timeout", () => { req.destroy(); finish(false); });
		req.on("error", () => finish(false)); req.end();
	});
}
/** io replaces the platform and the Windows command runner in tests. */
export function createLauncher(root: string, main: string, io?: { platform: NodeJS.Platform; exec: LaunchIO["exec"] }): ServerLauncher & { recorded(): Promise<ListenAddress[]>; stop(port: number, address?: ListenAddress): Promise<{ stopped: boolean }>; stopAll(port: number): Promise<{ stopped: boolean }> } {
	async function confirmed(port: number, address: ListenAddress): Promise<PidRecord | undefined> {
		try {
			const record = JSON.parse((await readRegular(join(root, pidFileName(address)), 4096)).toString()) as PidRecord;
			if (!Number.isSafeInteger(record.pid) || record.pid <= 0 || record.port !== port || record.ip !== address.ip
				|| (record.network === "zerotier") !== (address.network === "zerotier")
				|| !Number.isFinite(Date.parse(record.startedAt)) || Date.parse(record.startedAt) > Date.now()
				|| !/^[A-Za-z0-9_-]{22}$/.test(record.instance)) return undefined;
			process.kill(record.pid, 0);
			// A live pid alone is insufficient: this boot's random public identity must answer.
			return await probe(address.ip, port, record.instance) ? record : undefined;
		} catch { return undefined; }
	}
	const platform = io?.platform ?? process.platform;
	const windowsExec: LaunchIO["exec"] = io?.exec ?? ((file, args) => promisify(execFile)(file, args, { timeout: 10000, windowsHide: true }));
	async function isRunning(port: number, address: ListenAddress) { return !!await confirmed(port, address); }
	async function recorded(): Promise<ListenAddress[]> {
		let names: string[];
		try { names = await readdir(root); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
		return names.map(name => ZERO_TIER_RECORD.exec(name)?.[1]).filter((ip): ip is string => !!ip && isIpv4(ip)).slice(0, 16)
			.map(ip => ({ ip, dnsName: ip, network: "zerotier" as const }));
	}
	async function stop(port: number, address?: ListenAddress) {
		const cleanupTask = (confirmed: boolean) => platform === "win32" ? stopWindowsTask(confirmed, windowsExec, taskName(address)) : Promise.resolve();
		const unconfirmed = async () => { await cleanupTask(false); return { stopped: false }; };
		if (!address) {
			try {
				const saved = JSON.parse((await readRegular(join(root, "server.pid.json"), 4096)).toString()) as PidRecord;
				const octets = typeof saved.ip === "string" ? saved.ip.split(".").map(Number) : [];
				if (octets.length !== 4 || octets[0] !== 100 || octets[1]! < 64 || octets[1]! > 127 || !octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) return unconfirmed();
				address = { ip: saved.ip, dnsName: "" };
			} catch { return unconfirmed(); }
		}
		const record = await confirmed(port, address);
		if (!record) return unconfirmed();
		// Never signal a PID based solely on the private file or liveness.
		if (platform === "win32") {
			await cleanupTask(true);
		} else process.kill(record.pid, "SIGTERM");
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline) {
			if (!await probe(address.ip, port, record.instance)) return { stopped: true };
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		throw new Error("Link server did not stop within the deadline.");
	}
	return {
		isRunning,
		recorded,
		stop,
		/** The Tailscale listener as before, then every recorded ZeroTier listener and, on Windows, every ZeroTier task. */
		async stopAll(port) {
			let stopped = (await stop(port)).stopped;
			const addresses = await recorded();
			if (platform === "win32") for (const task of await windowsZeroTierTasks(windowsExec)) if (!addresses.some(a => a.ip === task.ip)) addresses.push(task);
			for (const address of addresses) if ((await stop(port, address)).stopped) stopped = true;
			return { stopped };
		},
		async start(port, address) {
			await launchServer(process.platform, process.execPath, main, port, {
				exec: (file, args) => promisify(execFile)(file, args, { timeout: 15000, windowsHide: true }),
				spawn: (file, args, options) => {
					const child = spawn(file, args, options);
					// The readiness probe below reports failure; suppress unhandled spawn errors.
					child.on("error", () => {}); return child;
				},
			}, address);
			for (let attempt = 0; attempt < 100; attempt++) {
				if (await isRunning(port, address)) return;
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			throw new Error(address.network === "zerotier"
				? "Link server did not start. Check ZeroTier, port availability, and (Windows) an interactive user login."
				: "Link server did not start. Check Tailscale, port availability, and (Windows) an interactive user login.");
		},
	};
}
