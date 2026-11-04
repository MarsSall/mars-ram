import { afterEach, expect, it, vi } from "vitest";
import { request } from "node:http";
import { Readable } from "node:stream";
import { startHttp } from "../../src/adapters/http.ts";
import { LinkService } from "../../src/core/links.ts";
import type { Link, Ports } from "../../src/core/ports.ts";

const token = "a".repeat(43);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function fixture(options = {}) {
 let now = 0;
 const link: Link = { id: "abcdefghijkl", token, fileName: "test", size: 25000000, mime: "application/octet-stream", contentKind: "download", createdAt: new Date(0).toISOString(), expiresAt: new Date(86400000).toISOString() };
 const sources: Readable[] = [];
 const store = { invalidCount: async () => 0, all: vi.fn(async () => [link]), delete: vi.fn(async () => {}), create: vi.fn(), read: vi.fn(async () => Buffer.from("old")), open: vi.fn(async () => {
  const stream = new Readable({ read() { this.push(Buffer.alloc(65536)); }, highWaterMark: 65536 }); sources.push(stream);
  return { size: link.size, prefix: Buffer.from("data"), stream, close: async () => { stream.destroy(); } };
 }) };
 const ports = { store, clock: () => now, random: () => token, launcher: { isRunning: async () => false, start: async () => {} }, tailscale: { address: async () => ({ ip: "127.0.0.1", dnsName: "test" }) } } satisfies Ports;
 const service = new LinkService(ports);
 const server = await startHttp(service, { ip: "127.0.0.1", port: 0, sweepMs: 10000, ...options });
 cleanups.push(server.close);
 function get(path = `/l/${token}`, method = "GET") {
  return new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
   const req = request({ host: "127.0.0.1", port: server.port, path, method, agent: false }, resolve); req.on("error", reject); req.end();
  });
 }
 return { server, service, store, sources, get, expire: () => { now = 86400000; } };
}
it("rejects route/method before accessing storage; HEAD reads no content", async () => {
 const f = await fixture();
 for (const [path, method] of [["/", "HEAD"], [`/l/${token}`, "POST"]]) { const res = await f.get(path, method); res.resume(); expect(res.statusCode).toBe(404); }
 expect(f.store.all).not.toHaveBeenCalled();
 const head = await f.get(`/l/${token}`, "HEAD"); head.resume(); expect(head.statusCode).toBe(200);
 expect(head.headers["content-length"]).toBe("25000000"); expect(f.store.read).not.toHaveBeenCalled(); expect(f.store.open).not.toHaveBeenCalled();
});
it("caps active downloads with explicit 503 and Retry-After", async () => {
 const f = await fixture({ maxDownloads: 1, shutdownMs: 30 });
 const first = await f.get(); first.on("error", () => {});
 const second = await f.get(); second.resume();
 expect(second.statusCode).toBe(503); expect(second.headers["retry-after"]).toBe("1"); expect(f.store.open).toHaveBeenCalledTimes(1);
 first.destroy();
});
it("streams the checked source and destroys it at mid-download expiry", async () => {
 const f = await fixture({ expiryCheckMs: 10, shutdownMs: 30 });
 const res = await f.get(); res.on("error", () => {}); f.expire();
 await vi.waitFor(() => expect(f.sources[0]?.destroyed).toBe(true), { timeout: 1000 }); res.destroy();
 expect(f.store.read).not.toHaveBeenCalled();
});
it("stops an ongoing download when its link is deleted while another link stays valid", async () => {
 const f = await fixture({ expiryCheckMs: 10, shutdownMs: 30 });
 const res = await f.get(); res.on("error", () => {});
 await vi.waitFor(() => expect(f.sources).toHaveLength(1));
 // delete runs in another process: the server only sees the store without this link.
 const other: Link = { id: "zyxwvutsrqpo", token: "b".repeat(43), fileName: "other", size: 1, mime: "application/octet-stream", contentKind: "download", createdAt: new Date(0).toISOString(), expiresAt: new Date(86400000).toISOString() };
 f.store.all.mockResolvedValue([other]);
 await vi.waitFor(() => expect(f.sources[0]?.destroyed).toBe(true), { timeout: 1000 }); res.destroy();
});
it.each([{ responseMs: 40, stallMs: 1000 }, { responseMs: 1000, stallMs: 40 }])("destroys a stalled response at its configured deadline %j", async limits => {
 const f = await fixture({ ...limits, shutdownMs: 30 });
 const res = await f.get(); res.on("error", () => {});
 await vi.waitFor(() => expect(f.sources[0]?.destroyed).toBe(true), { timeout: 2000 }); res.destroy();
});
it("bounds shutdown even with an active stalled socket", async () => {
 const f = await fixture({ shutdownMs: 30 }); const res = await f.get(); res.on("error", () => {});
 await Promise.race([f.server.close(), new Promise((_, reject) => setTimeout(() => reject(new Error("shutdown exceeded 500ms")), 500))]);
 expect(f.sources[0]?.destroyed).toBe(true); res.destroy();
});
it("status counts unexpired links without deleting anything", async () => {
 const f = await fixture(); f.expire();
 expect(await f.service.status()).toEqual({ serving: false, links: 0, invalid: 0 });
 expect(f.store.delete).not.toHaveBeenCalled();
});
