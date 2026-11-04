import { execFile, spawn } from "node:child_process";
import { request } from "node:http";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import type { ServerLauncher, TailnetAddress } from "../core/ports.ts";
import { readRegular, writePrivate } from "./file-store.ts";

export function windowsTaskCommand(node: string, main: string, port: number): string {
	// Task Scheduler parses an executable command line directly (not cmd.exe).
	// Reject quotes/control chars; quote both absolute paths, including spaces and &.
	const quote = (path: string) => {
		if (!path || /["\x00-\x1f]/.test(path) || path.endsWith("\\")) throw new Error("Unsafe scheduled task path.");
		return `"${path}"`;
	};
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port.");
	return `${quote(node)} ${quote(main)} serve --port ${port}`;
}
type LaunchIO = {
	exec(file: string, args: string[]): Promise<unknown>;
	spawn(file: string, args: string[], options: { detached: true; stdio: "ignore"; windowsHide: true }): { unref(): void };
};
export async function launchServer(platform: NodeJS.Platform, node: string, main: string, port: number, io: LaunchIO): Promise<void> {
	if (platform === "win32") {
		await io.exec("schtasks.exe", ["/create", "/tn", "mars-ram-links", "/sc", "once", "/st", "23:59", "/tr", windowsTaskCommand(node, main, port), "/rl", "LIMITED", "/f"]);
		try { await io.exec("schtasks.exe", ["/run", "/tn", "mars-ram-links"]); }
		finally { await io.exec("schtasks.exe", ["/change", "/tn", "mars-ram-links", "/disable"]); }
	} else {
		// detached:true invokes setsid on POSIX; no shell or inherited SSH descriptors.
		io.spawn(node, [main, "serve", "--port", String(port)], { detached: true, stdio: "ignore", windowsHide: true }).unref();
	}
}
export async function stopWindowsTask(confirmed: boolean, exec: LaunchIO["exec"]): Promise<void> {
	// Enumerate successfully (fail on access errors), so an absent task is an idempotent no-op.
	// Removing a task does not terminate its process; /end is reserved for confirmed boots.
	await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
		"$ErrorActionPreference = 'Stop'; $task = Get-ScheduledTask | Where-Object { $_.TaskName -eq 'mars-ram-links' -and $_.TaskPath -eq '\\' }; if ($task) { "
		+ (confirmed ? "& schtasks.exe /end /tn mars-ram-links; if ($LASTEXITCODE -ne 0) { throw 'Task stop failed' }; " : "")
		+ "& schtasks.exe /delete /tn mars-ram-links /f; if ($LASTEXITCODE -ne 0) { throw 'Task removal failed' } }"]);
}
export type PidRecord = { pid: number; startedAt: string; instance: string; ip: string; port: number };
export async function publishPid(root: string, record: PidRecord): Promise<() => Promise<void>> {
	const path = join(root, "server.pid.json");
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
export function createLauncher(root: string, main: string): ServerLauncher & { stop(port: number, address?: TailnetAddress): Promise<{ stopped: boolean }> } {
	async function confirmed(port: number, address: TailnetAddress): Promise<PidRecord | undefined> {
		try {
			const record = JSON.parse((await readRegular(join(root, "server.pid.json"), 4096)).toString()) as PidRecord;
			if (!Number.isSafeInteger(record.pid) || record.pid <= 0 || record.port !== port || record.ip !== address.ip
				|| !Number.isFinite(Date.parse(record.startedAt)) || Date.parse(record.startedAt) > Date.now()
				|| !/^[A-Za-z0-9_-]{22}$/.test(record.instance)) return undefined;
			process.kill(record.pid, 0);
			// A live pid alone is insufficient: this boot's random public identity must answer.
			return await probe(address.ip, port, record.instance) ? record : undefined;
		} catch { return undefined; }
	}
	async function isRunning(port: number, address: TailnetAddress) { return !!await confirmed(port, address); }
	return {
		isRunning,
		async stop(port, address) {
			const cleanupTask = (confirmed: boolean) => process.platform === "win32"
				? stopWindowsTask(confirmed, (file, args) => promisify(execFile)(file, args, { timeout: 10000, windowsHide: true })) : Promise.resolve();
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
			if (process.platform === "win32") {
				await cleanupTask(true);
			} else process.kill(record.pid, "SIGTERM");
			const deadline = Date.now() + 5000;
			while (Date.now() < deadline) {
				if (!await probe(address.ip, port, record.instance)) return { stopped: true };
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			throw new Error("Link server did not stop within the deadline.");
		},
		async start(port, address) {
			await launchServer(process.platform, process.execPath, main, port, {
				exec: (file, args) => promisify(execFile)(file, args, { timeout: 15000, windowsHide: true }),
				spawn: (file, args, options) => {
					const child = spawn(file, args, options);
					// The readiness probe below reports failure; suppress unhandled spawn errors.
					child.on("error", () => {}); return child;
				},
			});
			for (let attempt = 0; attempt < 100; attempt++) {
				if (await isRunning(port, address)) return;
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			throw new Error("Link server did not start. Check Tailscale, port availability, and (Windows) an interactive user login.");
		},
	};
}
