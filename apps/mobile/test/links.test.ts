import { describe, expect, it } from "vitest";
import { LinkService, buildLinkCommand, type LinkHistoryEntry } from "../src/core/links";
import { HostConnections } from "../src/core/host-connections";
import type { HostConnection } from "../src/core/ports";
import { FakeSsh, failure, savedHost } from "./fakes";

const config = { node: "/opt/Node Runtime/node", linkServer: "/home/dev/link server/main.ts", linkPort: 47811 };
const id = "abcdefghijkl";
const now = Date.parse("2026-10-25T12:00:00.000Z");
const created = { id, url: `http://pc.tail.ts.net:47811/l/${"x".repeat(43)}`, expiresAt: new Date(now + 86400000).toISOString() };
const entry: LinkHistoryEntry = { ...created, computerId: "a", fileName: "photo.png", size: 5, createdAt: new Date(now).toISOString() };
const source = { id: "pick", sourceUri: "content://pick", displayName: "photo.png", size: 5, mimeType: "image/png", kind: "image" as const };
class LinkSsh extends FakeSsh {
 record: unknown = config;
 output: unknown = created;
 stdout: string | null = null;
 exitStatus = 0;
 commands: string[] = [];
 removed: string[] = [];
 override async readFile(_id: string, path: string, cap: number) {
  expect(path).toBe(".mars-ram/host.json"); expect(cap).toBe(4096);
  return this.record === null ? failure("NOT_FOUND") : { ok: true as const, content: typeof this.record === "string" ? this.record : JSON.stringify(this.record) };
 }
 async exec(_id: string, command: string) { this.commands.push(command); return { ok: true as const, stdout: command.includes(" ensure ") ? JSON.stringify({ serving: true }) : this.stdout ?? JSON.stringify(this.output) + "\n", stderr: "secret stderr", exitStatus: this.exitStatus }; }
 override async removeFile(connectionId: string, path: string) { this.removed.push(path); return super.removeFile(connectionId, path); }
}
function setup(entries: LinkHistoryEntry[] = []) {
 const ssh = new LinkSsh(); ssh.sourceSizes.set(source.sourceUri, 5);
 const store = { list: async (computerId: string) => entries.filter(e => e.computerId === computerId), save: async (value: LinkHistoryEntry) => { entries = [...entries.filter(e => e.computerId !== value.computerId || e.id !== value.id), value]; }, remove: async (computerId: string, linkId: string) => { entries = entries.filter(e => e.computerId !== computerId || e.id !== linkId); } };
 const host = ssh as unknown as HostConnection;
 const connections = new HostConnections({ host, keyAlias: "key", unlock: async () => false });
 const service = new LinkService({ host, connections, history: store, clock: () => now, random: () => 0.2 }, savedHost("a"));
 return { ssh, service, store, connections };
}
describe("private links", () => {
 it("quotes POSIX/fish and cmd paths with spaces", () => {
  expect(buildLinkCommand(config, "create", "photo.png")).toBe("'/opt/Node Runtime/node' '/home/dev/link server/main.ts' create --staged photo.png --port 47811");
  expect(buildLinkCommand({ node: "C:\\Program Files\\node.exe", linkServer: "C:\\Users\\Dev User\\main.ts", linkPort: 47811 }, "delete", id)).toBe('"C:\\Program Files\\node.exe" "C:\\Users\\Dev User\\main.ts" delete abcdefghijkl --port 47811');
 });
 it.each(["/tmp/n'ode/node", "/tmp/$x/node", "/tmp/a;bad/node", "/tmp/a&bad/node", "/tmp/a`bad/node", "/tmp/a\n/node", "/tmp/../node", "node", "C:\\%USER%\\node.exe", "/tmp/not-node"])("rejects unsafe path %s", node => {
  expect(() => buildLinkCommand({ ...config, node }, "list")).toThrow();
 });
 it.each(["../x", "x..txt", "a.part", "CON", "a;cmd", "a\"cmd"])("rejects staged name %s", name => expect(() => buildLinkCommand(config, "create", name)).toThrow());
 it("rejects backslashes or colons in POSIX paths and slashes or extra colons in Windows paths", () => {
  for (const node of ["/opt/a\\\\b/node", "/opt/a:b/node"]) expect(() => buildLinkCommand({ ...config, node }, "list")).toThrow();
  const windows = { node: "C:\\nodejs\\node.exe", linkServer: "C:\\Users\\me\\.mars-ram\\link-server\\src\\main.ts", linkPort: 47811 };
  expect(buildLinkCommand(windows, "list")).toBe('"C:\\nodejs\\node.exe" "C:\\Users\\me\\.mars-ram\\link-server\\src\\main.ts" list --port 47811');
  for (const node of ["C:\\node/js\\node.exe", "C:\\a:b\\node.exe"]) expect(() => buildLinkCommand({ ...windows, node }, "list")).toThrow();
 });
 it("rejects unsafe ids, ports, mixed shells and subcommands", () => {
  expect(() => buildLinkCommand(config, "delete", "x;whoami")).toThrow();
  for (const linkPort of [0, 1023, 65536, 1.2]) expect(() => buildLinkCommand({ ...config, linkPort }, "list")).toThrow();
  expect(() => buildLinkCommand({ ...config, linkServer: "C:\\main.ts" }, "list")).toThrow();
  expect(() => buildLinkCommand(config, "evil" as "list")).toThrow();
 });
 it.each([null, "bad json", {}, { ...config, linkPort: "47811" }, { ...config, linkServer: "/tmp/main.ts;bad" }])("reports missing/invalid installation safely: %j", async record => {
  const { ssh, service } = setup(); ssh.record = record;
  expect(await service.ensure()).toEqual({ ok: false, code: "LINK_NOT_INSTALLED", message: "Link server not installed. Run mars-ram install on the computer." });
  expect(ssh.commands).toHaveLength(0);
 });
 it("uploads a bounded staged copy, creates and persists history", async () => {
  const { ssh, service, store } = setup();
  expect(await service.create(source)).toMatchObject({ ok: true, value: { ...created, computerId: "a", size: 5 } });
  expect(ssh.commands[0]).toContain(" ensure --port 47811");
  expect(ssh.commands[1]).toMatch(/ create --staged [A-Za-z0-9._-]+ --port 47811$/);
  expect([...ssh.uploadedFiles.keys()][0]).toMatch(/^\.mars-ram\/links\/\.staging\//);
  expect(await store.list("a")).toHaveLength(1);
  expect(await store.list("b")).toHaveLength(0);
 });
 it.each(["oops token-secret", JSON.stringify({ ...created, url: "https://pc/l/token-secret" }), JSON.stringify({ ...created, id: "bad" }), JSON.stringify({ ...created, expiresAt: "tomorrow" }), JSON.stringify(created) + "\n{}", JSON.stringify({ ...created, extra: true })])("cleans staging and never echoes malformed output", async stdout => {
  const { ssh, service, store } = setup(); ssh.stdout = stdout;
  const result = await service.create(source);
  expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain("token-secret");
  expect(ssh.uploadedFiles.size).toBe(0); expect(ssh.removed).toHaveLength(1); expect(await store.list("a")).toHaveLength(0);
 });
 it("cleans staged data on nonzero exit and thrown exec", async () => {
  for (const throws of [false, true]) {
   const { ssh, service } = setup();
   let calls = 0; const exec = ssh.exec.bind(ssh);
   ssh.exec = async (connectionId, command) => { if (++calls === 2) { if (throws) throw new Error("secret"); ssh.exitStatus = 1; } return exec(connectionId, command); };
   expect((await service.create(source)).ok).toBe(false); expect(ssh.uploadedFiles.size).toBe(0); expect(ssh.removed).toHaveLength(1);
  }
 });
 it("rejects oversized or unreadable sources without creating a link", async () => {
  const { service, ssh } = setup();
  expect((await service.create({ ...source, size: 25 * 1024 * 1024 + 1 })).ok).toBe(false);
  ssh.sourceSizes.set(source.sourceUri, 25 * 1024 * 1024 + 1);
  expect((await service.create({ ...source, size: null })).ok).toBe(false);
  ssh.sourceSizes.clear(); expect((await service.create(source)).ok).toBe(false);
  expect(ssh.commands.every(c => !c.includes(" create "))).toBe(true);
 });
 it("does not remove another upload when a staged name already exists", async () => {
  const { ssh, service } = setup();
  await service.create(source);
  const files = [...ssh.uploadedFiles.keys()];
  expect(files).toHaveLength(1);
  expect((await service.create(source)).ok).toBe(false);
  expect([...ssh.uploadedFiles.keys()]).toEqual(files);
 });
 it("treats failed management commands and malformed ensure as safe failures", async () => {
  const { ssh, service } = setup();
  ssh.exec = async () => ({ ok: true, stdout: '{"serving":"secret-token"}', stderr: "secret-token", exitStatus: 0 });
  expect(await service.ensure()).toEqual({ ok: false, code: "LINK_FAILED", message: "The link operation could not be completed. Please try again." });
  ssh.exec = async () => ({ ok: true, stdout: '{"serving":true}', stderr: "secret-token", exitStatus: 1 });
  expect((await service.ensure()).ok).toBe(false);
 });
 it("marks unreachable history unavailable without dropping records", async () => {
  const { ssh, service, store } = setup([entry]); ssh.refuse = failure("UNREACHABLE");
  expect((await service.history())[0].status).toBe("unavailable");
  expect(await store.list("a")).toEqual([entry]);
 });
 it("parses list, delete and ensure strictly", async () => {
  const { ssh, service } = setup(); ssh.output = { serving: true, links: [{ ...entry, computerId: undefined }] };
  expect(await service.list()).toMatchObject({ ok: true, value: { serving: true, links: [{ id }] } });
  ssh.output = { serving: "yes", links: [] }; expect((await service.list()).ok).toBe(false);
  ssh.output = { serving: true }; expect(await service.ensure()).toEqual({ ok: true, value: { serving: true } });
  ssh.output = { ok: false }; expect((await service.delete(id)).ok).toBe(false);
  ssh.output = { ok: true }; expect(await service.delete(id)).toEqual({ ok: true, value: { ok: true } });
 });
 it("merges history as valid, expired, deleted, or unavailable without discarding it", async () => {
  const expired = { ...entry, id: "expired12345", expiresAt: new Date(now - 1).toISOString() };
  const absent = { ...entry, id: "deleted12345" };
  const { service, ssh, store } = setup([entry, expired, absent]);
  ssh.output = { serving: true, links: [{ ...entry, computerId: undefined }] };
  expect((await service.history()).map(e => e.status)).toEqual(["valid", "expired", "deleted"]);
  ssh.output = { serving: false, links: [{ ...entry, computerId: undefined }] };
  expect((await service.history())[0].status).toBe("unavailable");
  ssh.refuse = failure("UNREACHABLE"); await service.history();
  ssh.stdout = "invalid"; expect((await service.history()).map(e => e.status)).toEqual(["unavailable", "expired", "unavailable"]);
  expect(await store.list("a")).toHaveLength(3);
 });
 it("shows locked history unavailable", async () => {
  const { ssh, service } = setup([entry]); ssh.locked = true;
  expect((await service.history())[0].status).toBe("unavailable");
 });
 it("removes expired history locally, deletes valid copies first and retains history on failure", async () => {
  const { ssh, service, store } = setup([entry]); ssh.output = { ok: false };
  expect((await service.remove(id)).ok).toBe(false); expect(await store.list("a")).toHaveLength(1);
  ssh.output = { ok: true }; expect((await service.remove(id)).ok).toBe(true); expect(await store.list("a")).toHaveLength(0);
  const expired = setup([{ ...entry, expiresAt: new Date(now - 1).toISOString() }]); expired.ssh.locked = true;
  expect((await expired.service.remove(id)).ok).toBe(true); expect(expired.ssh.connects).toHaveLength(0);
 });
 it("removes a row the computer already deleted from the phone only, without connecting", async () => {
  const { ssh, service, store } = setup([entry]); ssh.locked = true;
  expect((await service.remove(id, "deleted")).ok).toBe(true);
  expect(ssh.connects).toHaveLength(0); expect(await store.list("a")).toHaveLength(0);
 });
 it("deletes the new link on the computer when the phone cannot save it to history", async () => {
  const { ssh, service, store } = setup();
  store.save = async () => { throw new Error("disk full"); };
  expect((await service.create(source)).ok).toBe(false);
  expect(ssh.commands.at(-1)).toMatch(/ delete abcdefghijkl --port 47811$/);
  // The computer consumed the staged copy; its path may already hold another upload.
  expect(ssh.removed).toEqual([]);
 });
 it("runs best-effort restart once after first connection, only with unexpired history", async () => {
  for (const entries of [[entry], [], [{ ...entry, expiresAt: new Date(now - 1).toISOString() }]]) {
   const { ssh, service: _service, store } = setup(entries);
   const service = new LinkService({ host: ssh as unknown as HostConnection, connections: { connection: async () => ({ ok: true, connectionId: "c" }) }, history: store, clock: () => now, random: () => 0 }, savedHost("a"));
   const connections = new HostConnections({ host: ssh as unknown as HostConnection, keyAlias: "k", unlock: async () => true, afterFirstConnect: (computer, connectionId) => service.restore(connectionId) });
   ssh.output = { serving: true };
   await connections.connection(savedHost("a")); await new Promise(resolve => setTimeout(resolve, 0));
   await connections.drop("a"); await connections.connection(savedHost("a")); await new Promise(resolve => setTimeout(resolve, 0));
   expect(ssh.commands).toHaveLength(entries.some(e => Date.parse(e.expiresAt) > now) ? 1 : 0);
  }
 });
});

describe("private link from a project file (project-files S2, L9)", () => {
 const staged = "20261031-120000-abcdef-servers.ts";
 it("ensures storage, stages the host copy, then creates and records the link", async () => {
  const { ssh, service, store } = setup(); const order: string[] = [];
  const result = await service.createFromHost(async () => { order.push(`stage after ${ssh.commands.length} commands`); return { ok: true, staged, size: 3100 }; });
  expect(result).toEqual({ ok: true, value: { ...created, computerId: "a", fileName: staged, size: 3100, createdAt: new Date(now).toISOString() } });
  expect(order).toEqual(["stage after 1 commands"]);
  expect(ssh.commands).toEqual([buildLinkCommand(config, "ensure"), buildLinkCommand(config, "create", staged)]);
  expect(await store.list("a")).toEqual([result.ok ? result.value : null]);
 });
 it("creates nothing when staging fails or names an invalid file", async () => {
  for (const stage of [async () => ({ ok: false as const }), async () => ({ ok: true as const, staged: "../x", size: 1 })]) {
   const { ssh, service, store } = setup();
   expect((await service.createFromHost(stage)).ok).toBe(false);
   expect(ssh.commands).toEqual([buildLinkCommand(config, "ensure")]);
   expect(await store.list("a")).toEqual([]);
  }
 });
});
