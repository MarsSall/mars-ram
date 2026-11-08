import { describe, expect, it } from "vitest";
import { LinkService, validName } from "../../src/core/links.ts";
import type { Link, Ports } from "../../src/core/ports.ts";
import { windowsTaskCommand, launchServer } from "../../src/adapters/launcher.ts";
import { parseTailscale } from "../../src/adapters/tailscale.ts";

function fixture() {
	let now = Date.parse("2026-01-01T00:00:00Z");
	const links: Link[] = [];
	let running = false;
	let starts = 0;
	const ports: Ports = {
		clock: () => now,
		random: bytes => bytes === 9 ? "abcdefghijkl" : "a".repeat(43),
		store: {
			all: async () => [...links],
			invalidCount: async () => 0,
			create: async (name, metadata) => {
				const link: Link = { ...metadata, fileName: name, size: 5, contentKind: "download", mime: "application/octet-stream" };
				links.push(link); return link;
			},
			delete: async id => { const i = links.findIndex(l => l.id === id); if (i >= 0) links.splice(i, 1); },
			read: async () => Buffer.from("hello"),
			open: async () => { throw new Error("unused"); },
		},
		tailscale: { address: async () => ({ ip: "100.64.1.2", dnsName: "pc.tail.ts.net" }) },
		launcher: {
			isRunning: async () => running,
			start: async () => { starts++; running = true; },
		},
	};
	return { service: new LinkService(ports), links, ports, advance: () => { now += 86400000; }, starts: () => starts };
}

describe("link use cases with port fakes", () => {
 it('stays alive for registered phones and restores link expiry when disabled', async () => {
  const f = fixture(); let enabled = true;
  const service = new LinkService(f.ports, 47811, async () => enabled);
  expect(await service.shouldExit()).toBe(false);
  enabled = false;
  expect(await service.shouldExit()).toBe(true);
 });
	it("creates a one-day copy, ensures once, lists without raw token, deletes idempotently", async () => {
		const f = fixture();
		const created = await f.service.create("file.txt");
		expect(created).toEqual({ id: "abcdefghijkl", url: `http://pc.tail.ts.net:47811/l/${"a".repeat(43)}`, expiresAt: "2026-01-02T00:00:00.000Z" });
		expect(await f.service.ensure()).toEqual({ serving: true });
		expect(f.starts()).toBe(1);
		const listed = await f.service.list();
		expect(listed.serving).toBe(true);
		expect(listed.links[0]).toEqual({ ...created, fileName: "file.txt", size: 5, createdAt: "2026-01-01T00:00:00.000Z" });
		expect(await f.service.delete(created.id)).toEqual({ ok: true });
		expect(await f.service.delete(created.id)).toEqual({ ok: true });
		expect(await f.service.shouldExit()).toBe(true);
	});
	it("expires at the deadline, deletes copies, and does not start without valid links", async () => {
		const f = fixture();
		expect(await f.service.ensure()).toEqual({ serving: false });
		await f.service.create("a"); f.advance();
		expect(await f.service.active()).toEqual([]);
		expect(f.links).toHaveLength(0);
		expect(await f.service.shouldExit()).toBe(true);
	});
	it("does not register a file when Tailscale is down", async () => {
		const f = fixture(); f.ports.tailscale.address = async () => { throw new Error("Tailscale is down"); };
		await expect(f.service.create("a")).rejects.toThrow("Tailscale");
		expect(f.links).toHaveLength(0); expect(f.starts()).toBe(0);
	});
	it.each(["../x", "a/b", "a\\b", ".hidden", "a..b", "a.part", "A.PART", "a".repeat(201), "CON.txt", "a\n", "a\r", "a\r\n", "a b", "a:"])("rejects staged name %j before store access", async name => {
		expect(validName(name)).toBe(false);
		await expect(fixture().service.create(name)).rejects.toThrow("staged name");
	});
	it.each(["../x", "", "a".repeat(13), "a/b", ".staging"])("rejects management id %j", async id => {
		await expect(fixture().service.delete(id)).rejects.toThrow("id");
	});
	it("propagates start failure rather than reporting availability", async () => {
		const f = fixture(); f.ports.launcher.start = async () => { throw new Error("Cannot bind"); };
		await expect(f.service.create("a")).rejects.toThrow("Cannot bind");
	});
});

describe("platform boundaries", () => {
	it("selects only Tailscale IPv4 and strips DNS trailing dot", () => {
		expect(parseTailscale({ BackendState: "Running", Self: { TailscaleIPs: ["fd7a::1", "100.64.1.2"], DNSName: "pc.tail.ts.net." } })).toEqual({ ip: "100.64.1.2", dnsName: "pc.tail.ts.net" });
	});
	it.each([{}, { BackendState: "Stopped" }, { BackendState: "Running", Self: { TailscaleIPs: ["127.0.0.1"], DNSName: "pc." } }])("refuses unusable Tailscale status", status => {
		expect(() => parseTailscale(status)).toThrow("Tailscale");
	});
	it("quotes Windows executable and script paths without invoking a shell", () => {
		expect(windowsTaskCommand("C:\\Program Files\\node.exe", "C:\\User Files\\main.ts", 47811)).toBe('"C:\\Program Files\\node.exe" "C:\\User Files\\main.ts" serve --port 47811');
		expect(() => windowsTaskCommand('C:\\bad"path', "main.ts", 47811)).toThrow();
	});
	it("creates, runs then disables the LIMITED Windows task", async () => {
		const calls: [string, string[]][] = [];
		await launchServer("win32", "C:\\node.exe", "C:\\main.ts", 47811, {
			exec: async (file, args) => { calls.push([file, args]); },
			spawn: () => { throw new Error("not used"); },
		});
		expect(calls.map(c => c[1][0])).toEqual(["/create", "/run", "/change"]);
		expect(calls[0]?.[1]).toContain("LIMITED"); expect(calls[2]?.[1]).toContain("/disable");
	});
	it("uses detached no-shell Linux spawn and unrefs", async () => {
		let unref = false;
		await launchServer("linux", "/node", "/main.ts", 47811, {
			exec: async () => { throw new Error("not used"); },
			spawn: (file, args, options) => {
				expect(file).toBe("/node"); expect(args).toEqual(["/main.ts", "serve", "--port", "47811"]);
				expect(options).toEqual({ detached: true, stdio: "ignore", windowsHide: true });
				return { unref: () => { unref = true; } };
			},
		});
		expect(unref).toBe(true);
	});
});
