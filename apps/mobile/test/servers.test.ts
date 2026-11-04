import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildServersCommand, parseServersList, serverOpenable, serverRemoteHost, beginServersRefresh, finishServersRefresh, serverNavigation, Servers, ServerTunnel } from "../src/core/servers";
import { FakeSsh, savedHost } from "./fakes";
import { openBridge } from "../src/core/bridge-discovery";
import { PROTOCOL_VERSION } from "@workspace/protocol";
import { HerdrSwitcher } from "../src/core/herdr-switcher";
const record = { node: "/usr/bin/node", cli: "/work/host cli/main.ts" };
const row = { port: 3000, address: "127.0.0.1", scope: "loopback" as const, process: "vite", pid: 12, cwd: "/work", web: true };
const output = (servers: unknown[] = [row], truncated: unknown = false) => JSON.stringify({ version: 1, servers, truncated });
const connections = { connection: async () => ({ ok: true as const, connectionId: "ssh" }) };
describe("servers", () => {
 it("shows a server's own HTTP error page instead of reporting it as not responding", () => {
  const viewer = readFileSync(new URL("../src/ui/server-viewer.tsx", import.meta.url), "utf8");
  expect(viewer).not.toContain("onHttpError");
  expect(viewer).toContain("onError={() => setFailed(true)}");
 });
 it("builds only the fixed verb using Herdr's validated quoting", () => {
  expect(buildServersCommand(record)).toBe("'/usr/bin/node' '/work/host cli/main.ts' servers list");
  expect(buildServersCommand({ node: "C:\\Program Files\\node.exe", cli: "C:\\host\\main.ts" })).toBe('"C:\\Program Files\\node.exe" "C:\\host\\main.ts" servers list');
  for (const node of ["/bin/../node", "/bin/$(node)", "/bin/node;id", "C:\\node.exe"]) expect(() => buildServersCommand({ ...record, node })).toThrow();
 });
 it("parses valid nullable metadata and explicit truncation", () => {
  expect(parseServersList(output())).toEqual({ servers: [row], truncated: false });
  expect(parseServersList(output([{ ...row, process: null, pid: null, cwd: null }], true)).truncated).toBe(true);
 });
 it("rejects malformed, wrong-version, truncated JSON and unbounded payloads", () => {
  for (const text of ["{}", "bad", output().slice(0, -1), output().replace('"version":1', '"version":2'), output([], "yes"), output([row, row]), output(Array(65).fill(row)), " ".repeat(1048577)]) expect(() => parseServersList(text)).toThrow();
  for (const patch of [{ port: 0 }, { port: 65536 }, { port: 1.5 }, { pid: -1 }, { pid: 1.5 }, { address: "evil.example" }, { scope: "invalid" }, { scope: "all" }, { web: "true" }, { cwd: "x".repeat(4097) }, { process: "bad\ntext" }, { process: "x".repeat(513) }]) expect(() => parseServersList(output([{ ...row, ...patch }]))).toThrow();
 });
 it("only opens web listeners on loopback/all and chooses IPv6 exactly", () => {
  expect(serverOpenable(row)).toBe(true);
  expect(serverOpenable({ ...row, scope: "other" })).toBe(false);
  expect(serverOpenable({ ...row, web: false })).toBe(false);
  expect(serverRemoteHost({ ...row, address: "::1" })).toBe("::1");
  expect(serverRemoteHost({ ...row, address: "::" })).toBe("::1");
  expect(serverRemoteHost({ ...row, address: "0.0.0.0" })).toBe("127.0.0.1");
  expect(serverRemoteHost({ ...row, address: "127.0.0.1" })).toBe("127.0.0.1");
 });
 it("preserves last-known data including empty snapshots after refresh failure", () => {
  const good = finishServersRefresh(undefined, { ok: true, value: { servers: [], truncated: false } });
  expect(beginServersRefresh(good)).toBe(good);
  expect(finishServersRefresh(good, { ok: false, code: "SERVERS_FAILED" })).toEqual({ ...good, refreshError: true });
  expect(beginServersRefresh()).toEqual({ state: "loading" });
 });
 it("executes over the selected computer connection and refuses malformed records/results", async () => {
  const commands: string[] = []; let stdout = output(); let content = JSON.stringify(record);
  const service = new Servers({ connections, host: { readFile: async () => ({ ok: true, content }), exec: async (_id, command) => { commands.push(command); return { ok: true, stdout, stderr: "", exitStatus: 0 }; } } });
  expect((await service.list(savedHost("a"))).ok).toBe(true);
  expect(commands).toEqual([buildServersCommand(record)]);
  stdout = "{}"; expect((await service.list(savedHost("b"))).ok).toBe(false);
  content = "{}"; expect(await service.list(savedHost("a"))).toEqual({ ok: false, code: "CLI_MISSING" });
 });
 it("allows only the exact local HTTP origin, external HTTPS, and blocks other schemes", () => {
  expect(serverNavigation("http://127.0.0.1:51000/path?q=1", 51000)).toBe("allow");
  expect(serverNavigation("https://example.com", 51000)).toBe("external");
  for (const url of ["http://localhost:51000", "http://127.0.0.1:51001", "http://127.0.0.1:51000@evil.com", "file:///etc/passwd", "javascript:alert(1)", "intent://x", "about:blank"]) expect(serverNavigation(url, 51000)).toBe("block");
 });
 it("closes the owned forward exactly once on close, including an in-flight open", async () => {
  const closed: string[] = []; const forwarded: string[] = [];
  const tunnel = new ServerTunnel({ connections, host: { forwardLocal: async (_id, _port, remoteHost) => { forwarded.push(remoteHost!); return { ok: true, forwardId: "f", localPort: 51000 }; }, closeForward: async id => { closed.push(id); }, isConnected: () => true } });
  expect((await tunnel.open(savedHost("a"), { ...row, address: "::1" })).ok).toBe(true);
  expect(forwarded).toEqual(["::1"]); await tunnel.close(); await tunnel.close(); expect(closed).toEqual(["f"]);
  let resolve!: (value: { ok: true; forwardId: string; localPort: number }) => void;
  const racing = new ServerTunnel({ connections, host: { forwardLocal: () => new Promise(done => { resolve = done; }), closeForward: async id => { closed.push(id); }, isConnected: () => true } });
  const pending = racing.open(savedHost("a"), row);
  await Promise.resolve(); await Promise.resolve();
  await racing.close(); resolve({ ok: true, forwardId: "raced", localPort: 51001 }); await pending;
  expect(closed).toEqual(["f", "raced"]);
 });
 it("reports disconnect and releases the forward; refuses disabled listeners without connecting", async () => {
  let connected = true; const closed: string[] = []; let opens = 0;
  const tunnel = new ServerTunnel({ connections, host: { forwardLocal: async () => { ++opens; return { ok: true, forwardId: "f", localPort: 51000 }; }, closeForward: async id => { closed.push(id); }, isConnected: () => connected } });
  expect(await tunnel.open(savedHost("a"), { ...row, web: false })).toEqual({ ok: false });
  expect(opens).toBe(0);
  await tunnel.open(savedHost("a"), row); expect(tunnel.connected()).toBe(true);
  connected = false; expect(tunnel.connected()).toBe(false);
  await tunnel.close(); expect(closed).toEqual(["f"]);
 });
 it("rejects nonascending ports, missing fields and invalid addresses but accepts wildcard and IPv6", () => {
  expect(() => parseServersList(output([row, { ...row, port: 1000 }]))).toThrow();
  for (const field of Object.keys(row)) { const copy: Record<string, unknown> = { ...row }; delete copy[field]; expect(() => parseServersList(output([copy]))).toThrow(); }
  for (const address of ["127.0.0.999", "127.00.0.1", "::g", "::1%lo", "localhost", ""]) expect(() => parseServersList(output([{ ...row, address }]))).toThrow();
  for (const [address, scope] of [["::1", "loopback"], ["::", "all"], ["0.0.0.0", "all"], ["100.64.0.1", "other"]]) expect(parseServersList(output([{ ...row, address, scope }])).servers[0].address).toBe(address);
 });
 it("keeps bridge discovery on IPv4 loopback by default", async () => {
  const host = new FakeSsh();
  await openBridge(host, "ssh", { protocolVersion: PROTOCOL_VERSION, bridgeInstanceId: "b", sessionId: "s", port: 40000, token: "t".repeat(64), pid: 1, cwd: "/work", startedAt: 1 });
  expect(host.serverForwards.map(f => f.remoteHost)).toEqual(["127.0.0.1"]);
 });
 it("keeps the Herdr switcher listing independently", async () => {
  const service = new HerdrSwitcher({ connections, host: { readFile: async () => ({ ok: true, content: JSON.stringify(record) }), exec: async () => ({ ok: true, stdout: '{"version":1,"workspaces":[]}', stderr: "", exitStatus: 0 }) } });
  expect(await service.list(savedHost("a"))).toEqual({ ok: true, value: { workspaces: [], truncated: false } });
 });
});
