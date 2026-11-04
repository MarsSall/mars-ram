import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { pipeline } from "node:stream/promises";
import type { LinkService } from "../core/links.ts";
import { contentType, TOKEN_PATTERN } from "../core/links.ts";
import type { OpenCopy } from "../core/ports.ts";

const SECURITY = {
 "X-Content-Type-Options": "nosniff",
 "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
 "Cache-Control": "no-store",
 "Referrer-Policy": "no-referrer",
};
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
export async function startHttp(service: LinkService, options: {
 ip: string; port: number; instance?: string; sweepMs?: number; log?: (message: string) => void;
 maxDownloads?: number; responseMs?: number; stallMs?: number; shutdownMs?: number; expiryCheckMs?: number;
}) {
 let timer: ReturnType<typeof setInterval> | undefined;
 let closing = false, active = 0;
 const sockets = new Set<Socket>();
 const aborters = new Set<() => void>();
 let finish!: () => void;
 const closed = new Promise<void>(resolve => { finish = resolve; });
 const server = createServer(async (request, response) => {
  for (const [key, value] of Object.entries(SECURITY)) response.setHeader(key, value);
  // Public boot identity; this route must never access storage or trigger pruning.
  if (options.instance) response.setHeader("X-Mars-Links-Instance", options.instance);
  const notFound = () => { response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": "10" }); response.end("Not found\n"); };
  const match = /^\/l\/([A-Za-z0-9_-]{43})$/.exec(request.url ?? "");
  const token = match?.[1];
  if (!["GET", "HEAD"].includes(request.method ?? "") || !token || !TOKEN_PATTERN.test(token)) { notFound(); return; }
  // Admission precedes every metadata/content read and lasts through response completion.
  if (closing || active >= (options.maxDownloads ?? 4)) {
   response.writeHead(503, { "Retry-After": "1", "Connection": "close", "Content-Length": "0" }); response.end(); return;
  }
  active++;
  let copy: OpenCopy | undefined;
  let expiry: ReturnType<typeof setInterval> | undefined;
  let expiresAt: ReturnType<typeof setTimeout> | undefined;
  const abort = () => { copy?.stream.destroy(); response.destroy(); };
  aborters.add(abort);
  const deadline = setTimeout(abort, options.responseMs ?? 600000);
  response.setTimeout(options.stallMs ?? 30000, abort);
  let released = false, handlingDone = false, responseDone = false;
  const release = () => {
   responseDone = true;
   if (released || !handlingDone) return; released = true; active--; aborters.delete(abort);
   clearTimeout(deadline); clearInterval(expiry); clearTimeout(expiresAt);
   if (copy) void copy.close().catch(() => {});
   void sweep();
  };
  response.once("close", release);
  response.once("finish", release);
  try {
   const links = await service.active();
   const index = new Map(links.map(link => [digest(link.token), link]));
   const link = index.get(digest(token));
   if (!link || !timingSafeEqual(Buffer.from(link.token), Buffer.from(token))) { notFound(); return; }
   const headers = (size: number, type: { mime: string; contentKind: string }) => ({
    "Content-Type": type.mime, "Content-Length": size,
    "Content-Disposition": type.contentKind === "image" ? "inline" : `attachment; filename*=UTF-8''${encodeURIComponent(link.fileName.replace(/[^A-Za-z0-9._-]/g, "_"))}`,
   });
   // Registration derived these fields from checked bytes. HEAD opens no content handle.
   if (request.method === "HEAD") { if (!response.destroyed) { response.writeHead(200, headers(link.size, link)); response.end(); } return; }
   copy = await service.ports.store.open(link);
   if (response.destroyed) { await copy.close(); return; }
   if (!(await service.active()).some(l => l.id === link.id && l.token === link.token)) { await copy.close(); notFound(); return; }
   if (response.destroyed) { await copy.close(); return; }
   // Revoke ongoing responses at expiry or deletion, even when backpressure has paused file reads.
   // delete runs in another process and an open handle stays readable after unlink, so recheck the store.
   const remaining = Date.parse(link.expiresAt) - service.ports.clock();
   if (remaining <= 0) { await copy.close(); notFound(); return; }
   expiresAt = setTimeout(abort, remaining);
   let checking = false;
   expiry = setInterval(() => {
    if (service.ports.clock() >= Date.parse(link.expiresAt)) { abort(); return; }
    if (checking) return;
    checking = true;
    service.active().then(
     links => { if (!links.some(l => l.id === link.id && l.token === link.token)) abort(); },
     () => abort(),
    ).finally(() => { checking = false; });
   }, options.expiryCheckMs ?? 1000);
   response.writeHead(200, headers(copy.size, contentType(copy.prefix)));
   await pipeline(copy.stream, response);
  } catch {
   if (!response.destroyed) {
    options.log?.("Link request could not be served.");
    if (!response.headersSent) notFound(); else response.destroy();
   }
  } finally {
   handlingDone = true;
   if (responseDone || response.destroyed || response.writableFinished) release();
  }
 });
 server.maxConnections = 32;
 server.requestTimeout = 15000;
 server.headersTimeout = 10000;
 server.keepAliveTimeout = 1000;
 server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
 async function close() {
  if (!closing) {
   closing = true; clearInterval(timer);
   const force = setTimeout(() => {
    for (const abort of aborters) abort();
    server.closeAllConnections();
    for (const socket of sockets) socket.destroy();
   }, options.shutdownMs ?? 3000);
   server.close(() => { clearTimeout(force); finish(); });
   server.closeIdleConnections();
  }
  await closed;
 }
 let sweeping = false;
 async function sweep() {
  if (sweeping || closing) return;
  sweeping = true;
  try { if (await service.shouldExit()) await close(); }
  catch { options.log?.("Link expiry sweep failed."); }
  finally { sweeping = false; }
 }
 await new Promise<void>((resolve, reject) => {
  server.once("error", () => reject(new Error("Cannot bind link server to the Tailscale address. Check Tailscale and the port.")));
  server.listen(options.port, options.ip, resolve);
 });
 server.on("error", () => { options.log?.("Link server stopped after a listener error."); void close(); });
 timer = setInterval(() => { void sweep(); }, options.sweepMs ?? 60000);
 const address = server.address();
 if (!address || typeof address === "string") throw new Error("No listening address.");
 return { port: address.port, close, closed };
}
