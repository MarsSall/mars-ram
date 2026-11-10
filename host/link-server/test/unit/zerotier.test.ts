import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { LinkService } from "../../src/core/links.ts";
import type { Link, ListenAddress, Ports } from "../../src/core/ports.ts";
import { createZeroTier } from "../../src/adapters/zerotier.ts";
import { createLauncher, launchServer, pidFileName, publishPid, stopWindowsTask, windowsTaskCommand } from "../../src/adapters/launcher.ts";
import { startHttp } from "../../src/adapters/http.ts";
import { createNotifyStore } from "../../src/adapters/notify-store.ts";
import { notifiedBy, registrationNetworks } from "../../src/core/notify-registration.ts";

const ZT = "10.147.20.49";
const zeroTierAddress: ListenAddress = { ip: ZT, dnsName: ZT, network: "zerotier" };
const v4 = (address: string, netmask = "255.255.255.0") => ({ address, family: "IPv4" as const, internal: false, netmask, mac: "00:00:00:00:00:00", cidr: `${address}/24` });

function fixture(choice?: { network: "zerotier"; address: string }) {
	const links: Link[] = [];
	const started: ListenAddress[] = [];
	const tailscaleCalls: string[] = [];
	let running = false;
	const ports: Ports = {
		clock: () => Date.parse("2026-01-01T00:00:00Z"),
		random: bytes => bytes === 9 ? "abcdefghijkl" : "a".repeat(43),
		store: {
			all: async () => [...links], invalidCount: async () => 0,
			create: async (name, metadata) => { const link: Link = { ...metadata, fileName: name, size: 5, contentKind: "download", mime: "application/octet-stream" }; links.push(link); return link; },
			delete: async id => { const i = links.findIndex(l => l.id === id); if (i >= 0) links.splice(i, 1); },
			read: async () => Buffer.from("hello"), open: async () => { throw new Error("unused"); },
		},
		tailscale: { address: async () => { tailscaleCalls.push("tailscale"); return { ip: "100.64.1.2", dnsName: "pc.tail.ts.net" }; } },
		zerotier: createZeroTier(() => ({ eth0: [v4("192.168.1.20")], ztexample0: [v4(ZT)] }), "linux"),
		launcher: { isRunning: async () => running, start: async (_port, address) => { started.push(address); running = true; } },
	};
	return { service: new LinkService(ports, 47811, async () => false, choice), links, started, tailscaleCalls, ports };
}

describe("links over ZeroTier", () => {
	it("creates and lists links at the ZeroTier address and binds only that address", async () => {
		const f = fixture({ network: "zerotier", address: ZT });
		const created = await f.service.create("file.txt");
		expect(created).toEqual({ id: "abcdefghijkl", url: `http://${ZT}:47811/l/${"a".repeat(43)}`, expiresAt: "2026-01-02T00:00:00.000Z" });
		expect(f.started).toEqual([zeroTierAddress]);
		expect(await f.service.ensure()).toEqual({ serving: true });
		const listed = await f.service.list();
		expect(listed).toEqual({ serving: true, links: [{ ...created, fileName: "file.txt", size: 5, createdAt: "2026-01-01T00:00:00.000Z" }] });
		expect(f.tailscaleCalls).toEqual([]);
	});
	it("keeps Tailscale URLs for the same links when no network is asked", async () => {
		const f = fixture({ network: "zerotier", address: ZT });
		await f.service.create("file.txt");
		const tailscale = new LinkService(f.ports);
		expect((await tailscale.list()).links.map(link => link.url)).toEqual([`http://pc.tail.ts.net:47811/l/${"a".repeat(43)}`]);
	});
	it.each(["192.168.1.20", "10.147.20.50", "0.0.0.0", "127.0.0.1"])("refuses %s, which is not a ZeroTier address of this computer, before storing or binding", async address => {
		const f = fixture({ network: "zerotier", address });
		await expect(f.service.create("file.txt")).rejects.toThrow(/^ZeroTier /);
		await expect(f.service.ensure()).rejects.toThrow(/^ZeroTier /);
		await expect(f.service.list()).rejects.toThrow(/^ZeroTier /);
		expect(f.links).toEqual([]);
		expect(f.started).toEqual([]);
	});
	it("refuses when ZeroTier has no address at all", async () => {
		const zerotier = createZeroTier(() => ({ eth0: [v4("192.168.1.20")] }), "linux");
		await expect(zerotier.address(ZT)).rejects.toThrow(/^ZeroTier /);
		expect(await createZeroTier(() => ({ ztabc: [v4(ZT)] }), "linux").address(ZT)).toEqual(zeroTierAddress);
	});
	it("reports serving when only a recorded ZeroTier listener answers", async () => {
		const f = fixture();
		f.ports.tailscale.address = async () => { throw new Error("Tailscale is down"); };
		f.ports.launcher = { isRunning: async (_port, address) => address.ip === ZT && address.network === "zerotier", start: async () => {}, recorded: async () => [zeroTierAddress] };
		expect(await new LinkService(f.ports).status()).toEqual({ serving: true, links: 0, invalid: 0 });
	});
	it("reports which listeners serve, per network, for the doctor", async () => {
		const f = fixture(); const other = { ...zeroTierAddress, ip: "10.147.20.50", dnsName: "10.147.20.50" };
		f.ports.launcher = { isRunning: async (_port, address) => address.ip === ZT || address.ip === "100.64.1.2", start: async () => {}, recorded: async () => [zeroTierAddress, other] };
		expect(await new LinkService(f.ports).listeners()).toEqual({ tailscale: true, zerotier: [ZT] });
		f.ports.tailscale.address = async () => { throw new Error("Tailscale is down"); };
		f.ports.launcher.recorded = async () => { throw new Error("unreadable"); };
		expect(await new LinkService(f.ports).listeners()).toEqual({ tailscale: false, zerotier: [] });
	});
});

describe("ZeroTier listener process", () => {
	const cleanups: (() => Promise<void>)[] = [];
	afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
	it("keeps one identity file per address and never mixes Tailscale and ZeroTier records", async () => {
		expect(pidFileName({ ip: "100.64.1.2", dnsName: "pc" })).toBe("server.pid.json");
		expect(pidFileName(zeroTierAddress)).toBe(`server-zerotier-${ZT}.pid.json`);
		expect(() => pidFileName({ ip: "../x", dnsName: "../x", network: "zerotier" })).toThrow();
		const root = await mkdtemp(join(tmpdir(), "link-zt-pid-")); cleanups.push(() => rm(root, { recursive: true, force: true }));
		const record = { pid: process.pid, startedAt: new Date().toISOString(), instance: "a".repeat(22), ip: "127.0.0.1", port: 9 };
		const clear = await publishPid(root, { ...record, network: "zerotier" });
		expect(await readdir(root)).toEqual(["server-zerotier-127.0.0.1.pid.json"]);
		const launcher = createLauncher(root, "/unused.ts");
		expect(await launcher.recorded()).toEqual([{ ip: "127.0.0.1", dnsName: "127.0.0.1", network: "zerotier" }]);
		// A ZeroTier record never confirms the Tailscale listener.
		expect(await launcher.isRunning(9, { ip: "127.0.0.1", dnsName: "x" })).toBe(false);
		await clear();
		expect(await readdir(root)).toEqual([]);
	});
	it("launches with the explicit ZeroTier address and a separate Windows task", async () => {
		const spawned: string[][] = [];
		await launchServer("linux", "/node", "/main.ts", 47811, { exec: async () => { throw new Error("unused"); }, spawn: (_file, args) => { spawned.push(args); return { unref() {} }; } }, zeroTierAddress);
		expect(spawned).toEqual([["/main.ts", "serve", "--port", "47811", "--network", "zerotier", "--address", ZT]]);
		expect(windowsTaskCommand("C:\\node.exe", "C:\\main.ts", 47811, zeroTierAddress)).toBe(`"C:\\node.exe" "C:\\main.ts" serve --port 47811 --network zerotier --address ${ZT}`);
		const calls: string[][] = [];
		await launchServer("win32", "C:\\node.exe", "C:\\main.ts", 47811, { exec: async (_file, args) => { calls.push(args); }, spawn: () => { throw new Error("unused"); } }, zeroTierAddress);
		expect(calls.map(args => args[2])).toEqual(["mars-ram-links-zerotier-10-147-20-49", "mars-ram-links-zerotier-10-147-20-49", "mars-ram-links-zerotier-10-147-20-49"]);
		const stops: string[][] = [];
		await stopWindowsTask(false, async (_file, args) => { stops.push(args); }, "mars-ram-links-zerotier-10-147-20-49");
		expect(stops[0]?.join(" ")).toContain("schtasks.exe /delete /tn mars-ram-links-zerotier-10-147-20-49 /f");
		await expect(stopWindowsTask(false, async () => {}, "x'; evil")).rejects.toThrow();
	});
	it("finds Windows ZeroTier tasks by their exact name after the identity file is gone", async () => {
		const root = await mkdtemp(join(tmpdir(), "link-zt-task-")); cleanups.push(() => rm(root, { recursive: true, force: true }));
		const calls: string[][] = [];
		const listed = ["mars-ram-links-zerotier-10-147-20-49", "mars-ram-links", "mars-ram-links-zerotier-10-147-20-49", "mars-ram-links-zerotier-999-1-1-1",
			"mars-ram-links-zerotier-10-1-1-1-evil", "MARS-RAM-LINKS-ZEROTIER-10-1-1-2", "x'; evil", "mars-ram-links-zerotier-172-16-0-7"].join("\r\n");
		const launcher = createLauncher(root, "/unused.ts", { platform: "win32", exec: async (_file, args) => {
			calls.push(args);
			return { stdout: args.join(" ").includes("ForEach-Object") ? `${listed}\r\n` : "", stderr: "" };
		} });
		expect(await launcher.stopAll(47811)).toEqual({ stopped: false });
		const commands = calls.map(args => args.join(" "));
		// The query embeds no input and filters names strictly; Node validates every returned name again.
		const query = commands.find(c => c.includes("ForEach-Object"))!;
		expect(query).toContain("^mars-ram-links-zerotier-[0-9]{1,3}-[0-9]{1,3}-[0-9]{1,3}-[0-9]{1,3}$");
		expect(query).toContain("$_.TaskPath -eq '\\'");
		const deleted = commands.flatMap(c => [...c.matchAll(/schtasks\.exe \/delete \/tn (\S+) \/f/g)].map(m => m[1]));
		expect(deleted).toEqual(["mars-ram-links", "mars-ram-links-zerotier-10-147-20-49", "mars-ram-links-zerotier-172-16-0-7"]);
		// Unconfirmed boots are never ended, only their tasks removed.
		expect(commands.some(c => c.includes("schtasks.exe /end"))).toBe(false);
	});
	it("does not look for Windows tasks on Linux", async () => {
		const root = await mkdtemp(join(tmpdir(), "link-zt-task-")); cleanups.push(() => rm(root, { recursive: true, force: true }));
		const calls: string[][] = [];
		const launcher = createLauncher(root, "/unused.ts", { platform: "linux", exec: async (_file, args) => { calls.push(args); return { stdout: "", stderr: "" }; } });
		expect(await launcher.stopAll(47811)).toEqual({ stopped: false });
		expect(calls).toEqual([]);
	});
	it("names the ZeroTier address when it cannot bind", async () => {
		const service = new LinkService(fixture().ports);
		await expect(startHttp(service, { ip: "192.0.2.1", port: 0, network: "zerotier" })).rejects.toThrow("Cannot bind link server to the ZeroTier address. Check ZeroTier and the port.");
		await expect(startHttp(service, { ip: "192.0.2.1", port: 0 })).rejects.toThrow("Cannot bind link server to the Tailscale address. Check Tailscale and the port.");
	});
});

describe("Siempre atento registrations by network", () => {
	let root: string;
	beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "notify-zt-")); });
	afterEach(async () => { await rm(root, { recursive: true, force: true }); });
	const secret = "ab".repeat(32);
	it("summarizes which networks have registrations, without phones or secrets", () => {
		const row = { address: "100.64.1.2", port: 47812, secret, hostKeyId: "host" };
		expect(registrationNetworks([])).toEqual({ tailscale: false, zerotier: [] });
		expect(registrationNetworks([row, { ...row, address: "10.147.20.20", network: "zerotier", hostAddress: ZT }, { ...row, address: "10.147.20.21", network: "zerotier", hostAddress: ZT }, { ...row, address: "10.1.1.2", network: "zerotier", hostAddress: "10.1.1.1" }]))
			.toEqual({ tailscale: true, zerotier: ["10.1.1.1", ZT] });
	});
	it("stores ZeroTier phones with their network and reads older records as Tailscale", async () => {
		const store = createNotifyStore(join(root, "notify"));
		await store.put({ address: "100.64.1.2", port: 47812, secret, hostKeyId: "host" });
		await store.put({ address: "10.147.20.20", port: 47812, secret, hostKeyId: "host", network: "zerotier", hostAddress: ZT });
		const rows = await store.all();
		expect(rows).toHaveLength(2);
		const zerotier = rows.find(row => row.address === "10.147.20.20")!;
		const tailscale = rows.find(row => row.address === "100.64.1.2")!;
		expect(zerotier).toEqual({ address: "10.147.20.20", port: 47812, secret, hostKeyId: "host", network: "zerotier", hostAddress: ZT });
		expect(tailscale.network).toBeUndefined();
		// Each listener process sends to its own phones only, so a notice never goes out twice.
		expect(notifiedBy(tailscale, {})).toBe(true);
		expect(notifiedBy(zerotier, {})).toBe(false);
		expect(notifiedBy(zerotier, { network: "zerotier", ip: ZT })).toBe(true);
		expect(notifiedBy(zerotier, { network: "zerotier", ip: "10.144.0.2" })).toBe(false);
		expect(notifiedBy(tailscale, { network: "zerotier", ip: ZT })).toBe(false);
		expect(await store.get("10.147.20.20")).toEqual(zerotier);
	});
	it.each([
		{ address: "10.147.20.20", network: "zerotier" },
		{ address: "10.147.20.20", network: "zerotier", hostAddress: "not-an-ip" },
		{ address: "10.147.20.20", network: "wifi", hostAddress: ZT },
		{ address: "10.147.20.20" },
		{ address: "100.64.1.2", hostAddress: ZT },
	])("never authorizes an invalid destination %j", async fields => {
		const store = createNotifyStore(join(root, "notify"));
		await store.put({ port: 47812, secret, hostKeyId: "host", ...fields } as never);
		expect(await store.all()).toEqual([]);
	});
});

describe("link-server CLI network options", () => {
	const main = fileURLToPath(new URL("../../src/main.ts", import.meta.url));
	let home: string;
	beforeEach(async () => { home = await mkdtemp(join(tmpdir(), "link-zt-cli-")); });
	afterEach(async () => { await rm(home, { recursive: true, force: true }); });
	const cli = (args: string[]) => promisify(execFile)(process.execPath, [main, ...args], { env: { ...process.env, HOME: home, USERPROFILE: home } });
	it.each([
		["ensure", "--network", "zerotier"],
		["ensure", "--address", ZT],
		["ensure", "--network", "tailscale", "--address", ZT],
		["ensure", "--network", "zerotier", "--address", "10.1.1"],
		["ensure", "--network", "zerotier", "--address", "0.0.0.0/0"],
		["list", "--network", "zerotier", "--address", ZT, "--network", "zerotier"],
		["status", "--network", "zerotier", "--address", ZT],
		["stop", "--network", "zerotier", "--address", ZT],
	])("rejects %j", async (...args) => {
		await expect(cli(args)).rejects.toMatchObject({ code: 1 });
	});
	it("refuses an address that is not on a ZeroTier interface, naming ZeroTier", async () => {
		// TEST-NET-1 is never assigned to an interface.
		for (const args of [["ensure"], ["list"], ["create", "--staged", "file.txt"]]) {
			await expect(cli([...args, "--network", "zerotier", "--address", "192.0.2.1"])).rejects.toMatchObject({ code: 1, stderr: expect.stringMatching(/^ZeroTier /) });
		}
	});
	it("deletes with the network options without needing the interface", async () => {
		expect(JSON.parse((await cli(["delete", "abcdefghijkl", "--network", "zerotier", "--address", "192.0.2.1"])).stdout)).toEqual({ ok: true });
	});
});
