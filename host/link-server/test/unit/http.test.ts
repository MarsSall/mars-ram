import { afterEach, describe, expect, it } from "vitest";
import { request } from "node:http";
import { Readable } from "node:stream";
import { startHttp } from "../../src/adapters/http.ts";
import { LinkService, contentType } from "../../src/core/links.ts";
import type { Link, Ports } from "../../src/core/ports.ts";

const token = "a".repeat(43);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function fixture(data = Buffer.from("<html>hello</html>"), expireDuringRead = false, sweepMs = 10) {
	let now = 0;
	let links: Link[] = [{ id: "abcdefghijkl", token, fileName: "file.html", size: data.length, ...contentType(data), createdAt: new Date(0).toISOString(), expiresAt: new Date(86400000).toISOString() }];
	const logs: string[] = [];
	const ports: Ports = {
		clock: () => now, random: () => token,
		store: { invalidCount: async () => 0, all: async () => links, create: async () => { throw new Error("unused"); }, delete: async id => { links = links.filter(l => l.id !== id); }, read: async () => data, open: async () => { if (expireDuringRead) now = 86400000; const stream = Readable.from([data]); return { size: data.length, prefix: data.subarray(0, 12), stream, close: async () => { stream.destroy(); } }; } },
		tailscale: { address: async () => ({ ip: "100.64.1.2", dnsName: "pc.ts.net" }) },
		launcher: { start: async () => {}, isRunning: async () => false },
	};
	const server = await startHttp(new LinkService(ports), { ip: "127.0.0.1", port: 0, log: message => logs.push(message), sweepMs });
	cleanups.push(server.close);
	function get(path: string, method = "GET") {
		return new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: string }>((resolve, reject) => {
			const req = request({ host: "127.0.0.1", port: server.port, path, method }, res => {
				let body = ""; res.on("data", chunk => { body += chunk; });
				res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
			}); req.on("error", reject); req.end();
		});
	}
	return { get, logs, ports, deleteAll: () => { links = []; }, expire: () => { now = 86400000; }, server, remaining: () => links.length };
}

describe("tailnet HTTP adapter (loopback injected only by tests)", () => {
	it.each(["/", "/health", "/l/no", `/l/${"b".repeat(43)}`, "/l/../x", "/l/%2fetc", "/l/%2e%2e%2fx", `/l/${token}?x=1`])("returns fixed 404 for %s", async path => {
		const f = await fixture(); const res = await f.get(path);
		expect(res.status).toBe(404); expect(res.body).toBe("Not found\n");
		expect(res.headers["x-content-type-options"]).toBe("nosniff");
		expect(f.logs.join("")).not.toContain(token);
	});
	it("HTML downloads with all security headers; HEAD has no body; POST is 404", async () => {
		const f = await fixture(); const res = await f.get(`/l/${token}`);
		expect(res.status).toBe(200); expect(res.headers["content-type"]).toBe("application/octet-stream");
		expect(res.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''file.html");
		expect(res.headers["content-security-policy"]).toBe("default-src 'none'; img-src 'self'; sandbox");
		expect(res.headers["cache-control"]).toBe("no-store"); expect(res.headers["referrer-policy"]).toBe("no-referrer");
		const head = await f.get(`/l/${token}`, "HEAD"); expect(head.status).toBe(200); expect(head.body).toBe("");
		expect(head.headers["content-length"]).toBe(String(Buffer.byteLength(res.body)));
		expect((await f.get(`/l/${token}`, "POST")).status).toBe(404);
		expect(f.logs.join("")).not.toContain(token);
	});
	it.each([
		[Buffer.from("89504e470d0a1a0a00000000", "hex"), "image/png"],
		[Buffer.from("ffd8ffe00000", "hex"), "image/jpeg"],
		[Buffer.from("GIF89ahello"), "image/gif"],
		[Buffer.from("RIFF0000WEBPhello"), "image/webp"],
	])("detects image magic rather than the .html extension", async (data, mime) => {
		const f = await fixture(data); const res = await f.get(`/l/${token}`);
		expect(res.headers["content-type"]).toBe(mime); expect(res.headers["content-disposition"]).toBe("inline");
	});
	it("SVG downloads", async () => {
		const f = await fixture(Buffer.from("<svg onload='bad()'></svg>"));
		expect((await f.get(`/l/${token}`)).headers["content-type"]).toBe("application/octet-stream");
	});
	it("expired token returns 404 and deletes its copy then exits", async () => {
		// A slow sweep so the request, not the sweep, finds the expired link (10 ms raced it under load).
		const f = await fixture(undefined, false, 1000); f.expire();
		expect((await f.get(`/l/${token}`)).status).toBe(404); expect(f.remaining()).toBe(0);
		await f.server.closed;
	});
	it("does not serve a copy that expires while it is being read", async () => {
		const f = await fixture(Buffer.from("hello"), true);
		expect((await f.get(`/l/${token}`)).status).toBe(404);
		expect(f.remaining()).toBe(0);
	});
	it("sweep exits without a request when the last link expires", async () => {
		const f = await fixture(); f.expire(); await f.server.closed; expect(f.remaining()).toBe(0);
	});
	it("exits after management deletes the last link", async () => {
		const f = await fixture(); f.deleteAll(); await f.server.closed;
	});
	it("never logs a token even if a storage error contains it", async () => {
		const f = await fixture(); f.ports.store.open = async () => { throw new Error(`Cannot read ${token}`); };
		expect((await f.get(`/l/${token}`)).status).toBe(404);
		expect(f.logs).toEqual(["Link request could not be served."]);
		expect(f.logs.join("")).not.toContain(token);
	});
	it("binding an unavailable address refuses to start", async () => {
		const f = await fixture();
		await expect(startHttp({ shouldExit: async () => false } as LinkService, { ip: "192.0.2.123", port: 0 })).rejects.toThrow("Tailscale");
	});
});
