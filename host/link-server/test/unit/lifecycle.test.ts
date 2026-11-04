import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createLauncher, publishPid, windowsTaskCommand, launchServer, stopWindowsTask } from "../../src/adapters/launcher.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; });
it("requires both a live pid and this boot's endpoint identity (not a reused pid)", async () => {
	const root = await mkdtemp(join(tmpdir(), "link-pid-test-"));
	cleanups.push(() => rm(root, { recursive: true, force: true }));
	const instance = "a".repeat(22);
	const server = createServer((_req, res) => { res.writeHead(404, { "X-Mars-Links-Instance": instance }); res.end(); });
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	cleanups.push(() => new Promise<void>(resolve => { server.close(() => resolve()); }));
	const address = server.address(); if (!address || typeof address === "string") throw new Error("missing address");
	const port = address.port;
	const tailnet = { ip: "127.0.0.1", dnsName: "test" };
	const launcher = createLauncher(root, "/unused.ts");
	expect(await launcher.isRunning(port, tailnet)).toBe(false);
	const record = { pid: process.pid, startedAt: new Date().toISOString(), instance, ip: tailnet.ip, port };
	const clear = await publishPid(root, record);
	expect(await launcher.isRunning(port, tailnet)).toBe(true);
	await writeFile(join(root, "server.pid.json"), JSON.stringify({ ...record, instance: "b".repeat(22) }));
	expect(await launcher.isRunning(port, tailnet)).toBe(false);
	// This PID is the test runner: an unchecked stop would terminate the suite.
	expect(await launcher.stop(port, tailnet)).toEqual({ stopped: false });
	await writeFile(join(root, "server.pid.json"), JSON.stringify({ ...record, pid: 2147483647 }));
	expect(await launcher.isRunning(port, tailnet)).toBe(false);
	await clear();
});
it("stops a confirmed boot and is idempotent afterward", async () => {
 const root = await mkdtemp(join(tmpdir(), "link-stop-test-")); cleanups.push(() => rm(root, { recursive: true, force: true }));
 const instance = "c".repeat(22);
 const child = spawn(process.execPath, ["-e", `const s=require('node:http').createServer((q,r)=>{r.writeHead(404,{'X-Mars-Links-Instance':'${instance}'});r.end()});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));process.on('SIGTERM',()=>s.close());`], { stdio: ["ignore", "pipe", "pipe"] });
 cleanups.push(async () => { child.kill(); });
 const port = await new Promise<number>((resolve, reject) => { child.stdout.once("data", data => resolve(Number(String(data).trim()))); child.once("error", reject); });
 await publishPid(root, { pid: child.pid!, instance, startedAt: new Date().toISOString(), ip: "127.0.0.1", port });
 const launcher = createLauncher(root, "/unused.ts");
 // This subprocess is POSIX; native Windows stop/task execution remains an integration check.
 if (process.platform !== "win32") {
  expect(await launcher.stop(port, { ip: "127.0.0.1", dnsName: "test" })).toEqual({ stopped: true });
  expect(await launcher.stop(port, { ip: "127.0.0.1", dnsName: "test" })).toEqual({ stopped: false });
 }
});
it.each([true, false])("Windows task cleanup only ends confirmed boots (%j)", async confirmed => {
 const calls: string[][] = [];
 await stopWindowsTask(confirmed, async (_file, args) => { calls.push(args); });
 expect(calls[0]?.join(" ")).toContain("schtasks.exe /delete /tn mars-ram-links /f");
 expect(calls[0]?.join(" ").includes("schtasks.exe /end")).toBe(confirmed);
});
it("does not remove a newer boot's pid record", async () => {
	const root = await mkdtemp(join(tmpdir(), "link-pid-test-")); cleanups.push(() => rm(root, { recursive: true, force: true }));
	const record = { pid: process.pid, startedAt: new Date().toISOString(), instance: "a".repeat(22), ip: "127.0.0.1", port: 12345 };
	const clear = await publishPid(root, record);
	await writeFile(join(root, "server.pid.json"), JSON.stringify({ ...record, instance: "b".repeat(22) }));
	await clear();
	const { readFile } = await import("node:fs/promises");
	expect(JSON.parse(await readFile(join(root, "server.pid.json"), "utf8")).instance).toBe("b".repeat(22));
});
it.each(["C:\\bad\nnode.exe", 'C:\\bad"node.exe', "C:\\directory\\"])("rejects ambiguous Windows command path", path => {
	expect(() => windowsTaskCommand(path, "C:\\main.ts", 47811)).toThrow();
});
it("keeps shell metacharacters as literal quoted path characters", () => {
	expect(windowsTaskCommand("C:\\A & B\\node.exe", "C:\\a (b)\\main.ts", 47811)).toBe('"C:\\A & B\\node.exe" "C:\\a (b)\\main.ts" serve --port 47811');
});
it("disables a Windows trigger even if task execution fails", async () => {
	const calls: string[] = [];
	await expect(launchServer("win32", "C:\\node.exe", "C:\\main.ts", 47811, {
		exec: async (_file, args) => { calls.push(args[0]!); if (args[0] === "/run") throw new Error("failed"); },
		spawn: () => { throw new Error("unused"); },
	})).rejects.toThrow("failed");
	expect(calls).toEqual(["/create", "/run", "/change"]);
});
