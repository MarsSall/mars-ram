import { expect, it } from "vitest";
import { KeySecurity, buildKeyCommand, type KeySecurityState, type KeySecurityStore } from "../src/core/key-security";
import { parseSavedHosts, serializeSavedHosts, type HostCatalog, type SavedHost } from "../src/core/host-catalog";
import { HostConnections } from "../src/core/host-connections";
import type { HostConnection, HostTarget } from "../src/core/ports";
import { FakeSsh, failure, savedHost } from "./fakes";

const pub = (n: string) => `ecdsa-sha2-nistp256 AAAA${n}`;
const publicFor = (alias: string) => pub(alias === "app-ssh-key" ? "OLD" : `NEW${alias.split("-").at(-1)}`);
class RotationSsh extends FakeSsh {
 commands: { alias: string; command: string }[] = [];
 authorized = new Map<string, Set<string>>();
 proven = new Set<string>();
 offline = new Set<string>();
 fail: "add" | "fresh" | "proof" | "remove" | "offline" | null = null;
 config: Record<string, unknown> = { node: "/usr/bin/node", cli: "/home/dev/.mars-ram/cli/src/main.ts" };
 override async readFile() { return { ok: true as const, content: JSON.stringify(this.config) }; }
 override async connect(target: HostTarget) {
  if (this.fail === "offline" || this.offline.has(target.host) || (this.fail === "fresh" && target.keyAlias !== "app-ssh-key")) return failure("UNREACHABLE");
  if (!this.authorized.has(target.host)) this.authorized.set(target.host, new Set([publicFor("app-ssh-key")]));
  if (!this.authorized.get(target.host)!.has(publicFor(target.keyAlias))) return failure("AUTH_FAILED");
  return super.connect(target);
 }
 async exec(id: string, command: string) {
  const alias = this.targets.get(id)!.keyAlias;
  this.commands.push({ alias, command });
  if ((this.fail === "add" && command.includes(" key add ")) || (this.fail === "remove" && command.includes(" key remove ")) || (this.fail === "proof" && command === "echo key-rotation-proof")) return failure("SSH_ERROR");
  const trusted = this.authorized.get(this.targets.get(id)!.host)!;
  if (command === "echo key-rotation-proof") this.proven.add(id);
  const material = /--key ['"]([^'"]+)['"]/.exec(command)?.[1];
  if (command.includes(" key add ")) trusted.add(material!);
  if (command.includes(" key remove ")) { expect(this.proven.has(id)).toBe(true); trusted.delete(material!); }
  return { ok: true as const, stdout: command.includes(" key add ") ? '{"added":true}\n' : command.includes(" key remove ") ? '{"removed":1}\n' : "key-rotation-proof\n", stderr: "", exitStatus: 0 };
 }
}
function setup(count = 1) {
 const ssh = new RotationSsh();
 const hosts = new Map<string, SavedHost>(Array.from({ length: count }, (_, i) => { const h = savedHost(String(i), { address: `100.64.0.${i + 1}`, keyAlias: "app-ssh-key", rotation: { phase: "done" } }); return [h.id, h]; }));
 let state: KeySecurityState | null = null;
 const checkpoints: string[] = [];
 const catalog: HostCatalog = { list: async () => structuredClone([...hosts.values()]), save: async h => { checkpoints.push(h.rotation!.phase); hosts.set(h.id, structuredClone(h)); }, remove: async id => { hosts.delete(id); } };
 const store: KeySecurityStore = { read: async () => structuredClone(state), write: async value => { state = structuredClone(value); } };
 const deleted: string[] = [];
 const ensured: { alias: string; policy: boolean }[] = [];
 let unlocks = 0;
 const deps = { host: ssh as unknown as HostConnection, catalog, store, credentials: { ensureKey: async (alias: string, policy: boolean) => { ensured.push({ alias, policy }); return { publicKey: publicFor(alias) + " phone" }; }, deleteKey: async (alias: string) => { deleted.push(alias); }, unlock: async () => { unlocks++; return true; } } };
 return { ssh, hosts, catalog, store, deleted, ensured, checkpoints, credentials: deps.credentials, make: () => new KeySecurity(deps), unlocks: () => unlocks };
}
it("migrates legacy computers and bumps the catalog version", () => {
 const h = savedHost("old");
 expect(parseSavedHosts(JSON.stringify({ version: 1, hosts: [h] })).hosts[0]).toMatchObject({ keyAlias: "app-ssh-key", rotation: { phase: "done" } });
 expect(JSON.parse(serializeSavedHosts([h])).version).toBe(2);
});
it("connects per host and does not reuse an old-alias pool entry", async () => {
 const ssh = new FakeSsh();
 const pool = new HostConnections({ host: ssh as unknown as HostConnection, keyAlias: "fallback", unlock: async () => true });
 await pool.connection(savedHost("a", { keyAlias: "old" }));
 await pool.connection(savedHost("a", { keyAlias: "new" }));
 expect(ssh.connects.map(t => t.keyAlias)).toEqual(["old", "new"]);
});
it("checkpoints add, fresh pinned proof, alias switch, remove, and only then deletes the old key", async () => {
 const f = setup(2); const api = f.make();
 expect(await api.setRequireUnlock(false)).toEqual({ ok: true });
 expect(f.checkpoints).toEqual(["pending", "added", "verified", "verified", "done", "pending", "added", "verified", "verified", "done"]);
 expect(f.ssh.commands.map(c => c.alias)).toEqual(["app-ssh-key", "app-ssh-key-1", "app-ssh-key-1", "app-ssh-key", "app-ssh-key-1", "app-ssh-key-1"]);
 expect(f.ssh.connects.every(t => t.expectedFingerprint === savedHost("0").hostKey)).toBe(true);
 expect(f.deleted).toEqual(["app-ssh-key"]);
 expect(f.unlocks()).toBe(1);
 expect(await api.status()).toMatchObject({ requireUnlock: false, perComputer: [{ phase: "done" }, { phase: "done" }] });
 expect((await api.current()).alias).toBe("app-ssh-key-1");
});
it.each([ ["add", "pending", "app-ssh-key"], ["fresh", "added", "app-ssh-key"], ["proof", "added", "app-ssh-key"], ["remove", "verified", "app-ssh-key-1"], ["offline", "pending", "app-ssh-key"] ] as const)("keeps a working alias after %s failure and resumes after restart", async (step, phase, alias) => {
 const f = setup(); f.ssh.fail = step;
 await f.make().setRequireUnlock(false);
 expect(f.hosts.get("0")).toMatchObject({ keyAlias: alias, rotation: { phase, lastError: expect.anything() } });
 expect(f.deleted).toEqual([]);
 const host = f.hosts.get("0")!;
 if (f.ssh.authorized.has(host.address)) expect(f.ssh.authorized.get(host.address)!.has(publicFor(host.keyAlias!))).toBe(true);
 f.ssh.fail = null;
 await f.make().resume();
 expect(f.hosts.get("0")).toMatchObject({ keyAlias: "app-ssh-key-1", rotation: { phase: "done" } });
 expect(f.deleted).toEqual(["app-ssh-key"]);
});
it("rejects a second toggle while pending without changing desired policy or creating another key", async () => {
 const f = setup(); const api = f.make(); f.ssh.fail = "offline";
 await api.setRequireUnlock(false);
 expect(await api.setRequireUnlock(true)).toMatchObject({ ok: false, code: "ROTATION_PENDING" });
 expect((await api.status()).requireUnlock).toBe(false);
 expect(f.ensured.filter(k => k.alias !== "app-ssh-key")).toHaveLength(1);
});
it("retains the previous alias until every computer is done", async () => {
 const f = setup(2); f.ssh.fail = "offline"; await f.make().setRequireUnlock(false);
 f.hosts.delete("1"); f.ssh.fail = null;
 await f.make().resume();
 expect(f.deleted).toEqual(["app-ssh-key"]);
});
it("returns a typed update requirement for older hosts without cli", async () => {
 const f = setup(); delete f.ssh.config.cli;
 await f.make().setRequireUnlock(false);
 expect((await f.make().status()).perComputer[0].lastError).toMatchObject({ code: "KEY_ROTATION_NOT_INSTALLED", message: expect.stringContaining("mars-ram install") });
 expect(f.ssh.commands).toEqual([]);
 expect(f.deleted).toEqual([]);
});
it.each([1, 2, 3, 4, 5])("recovers a crash before catalog checkpoint %i without removing the only working key", async checkpoint => {
 const f = setup(); const original = f.catalog.save;
 let writes = 0; let crashed = false;
 f.catalog.save = async h => { writes++; if (writes === checkpoint) crashed = true; if (crashed) throw new Error("process stopped"); await original(h); };
 await expect(f.make().setRequireUnlock(false)).rejects.toThrow("process stopped");
 const h = f.hosts.get("0")!;
 if (f.ssh.authorized.has(h.address)) expect(f.ssh.authorized.get(h.address)!.has(publicFor(h.keyAlias!))).toBe(true);
 expect(f.deleted).toEqual([]);
 crashed = false;
 await f.make().resume();
 expect(f.hosts.get("0")).toMatchObject({ keyAlias: "app-ssh-key-1", rotation: { phase: "done" } });
 expect(f.deleted).toEqual(["app-ssh-key"]);
});
it("recovers the exact alias/policy after a crash during generation creation", async () => {
 const f = setup(); const original = f.store.write; let count = 0;
 f.store.write = async state => { if (++count === 3) throw new Error("process stopped"); await original(state); };
 await expect(f.make().setRequireUnlock(false)).rejects.toThrow("process stopped");
 await f.make().resume();
 expect(f.ensured.filter(k => k.alias === "app-ssh-key-1").map(k => k.policy)).toEqual([false, false]);
 expect(f.deleted).toEqual(["app-ssh-key"]);
});
it("rotates reachable computers independently, retaining the old alias for an offline computer", async () => {
 const f = setup(2); f.ssh.offline.add("100.64.0.2");
 await f.make().setRequireUnlock(false);
 expect(f.hosts.get("0")?.rotation?.phase).toBe("done");
 expect(f.hosts.get("1")?.keyAlias).toBe("app-ssh-key");
 expect(f.deleted).toEqual([]);
 f.ssh.offline.clear(); await f.make().resume();
 expect(f.deleted).toEqual(["app-ssh-key"]);
});
it("can toggle back after completion using a new immutable alias and no unlock for the unprotected key", async () => {
 const f = setup(); const api = f.make();
 await api.setRequireUnlock(false); await api.setRequireUnlock(true);
 expect((await api.current()).alias).toBe("app-ssh-key-2");
 expect(f.ensured).toEqual([{ alias: "app-ssh-key", policy: true }, { alias: "app-ssh-key-1", policy: false }, { alias: "app-ssh-key-2", policy: true }]);
 expect(f.unlocks()).toBe(1);
 expect(f.deleted).toEqual(["app-ssh-key", "app-ssh-key-1"]);
});
it("cancelling unlock leaves policy, generation and all host keys unchanged", async () => {
 const f = setup(); f.credentials.unlock = async () => false;
 expect(await f.make().setRequireUnlock(false)).toMatchObject({ ok: false, code: "UNLOCK_REQUIRED" });
 expect((await f.make().status()).requireUnlock).toBe(true);
 expect(f.ensured).toHaveLength(1); expect(f.ssh.connects).toEqual([]); expect(f.deleted).toEqual([]);
});
it("does not checkpoint add or remove on malformed CLI success output", async () => {
 const f = setup(); const exec = f.ssh.exec.bind(f.ssh);
 f.ssh.exec = async (id, command) => {
  const result = await exec(id, command);
  return result.ok ? { ...result, stdout: "not JSON\n" } : result;
 };
 await f.make().setRequireUnlock(false);
 expect(f.hosts.get("0")).toMatchObject({ keyAlias: "app-ssh-key", rotation: { phase: "pending" } });
 expect(f.deleted).toEqual([]);
 f.ssh.exec = exec; await f.make().resume();
 expect(f.hosts.get("0")?.rotation?.phase).toBe("done");
});
it("does nothing on an unchanged setting", async () => {
 const f = setup(); await f.make().setRequireUnlock(true);
 expect(f.ensured).toHaveLength(1); expect(f.ssh.connects).toEqual([]); expect(f.unlocks()).toBe(0);
});
it("refuses a changed identity on the fresh connection and never removes the old key", async () => {
 const f = setup(); const connect = f.ssh.connect.bind(f.ssh);
 f.ssh.connect = async target => {
  if (target.keyAlias !== "app-ssh-key") return failure("HOST_KEY_CHANGED");
  return connect(target);
 };
 await f.make().setRequireUnlock(false);
 expect(f.hosts.get("0")).toMatchObject({ keyAlias: "app-ssh-key", rotation: { phase: "added", lastError: { code: "HOST_KEY_CHANGED" } } });
 expect(f.ssh.commands.some(c => c.command.includes(" key remove "))).toBe(false);
 expect(f.deleted).toEqual([]);
});
it("quotes allow-listed POSIX and Windows commands and rejects shell injection", () => {
 expect(buildKeyCommand({ node: "/usr/bin/node", cli: "/home/a b/main.ts" }, "add", pub("NEW"), pub("OLD"))).toBe(`'/usr/bin/node' '/home/a b/main.ts' key add --key '${pub("NEW")}' --like '${pub("OLD")}'`);
 expect(buildKeyCommand({ node: "C:\\Program Files\\node.exe", cli: "C:\\Users\\a\\main.ts" }, "remove", pub("OLD"), pub("NEW"))).toBe(`"C:\\Program Files\\node.exe" "C:\\Users\\a\\main.ts" key remove --key "${pub("OLD")}" --keep "${pub("NEW")}"`);
 for (const bad of ["x' ; bad", "ssh-ed25519 AAAA\ncommand", "ssh-ed25519 AAAA%PATH%", "ssh-ed25519 AAAA comment"]) expect(() => buildKeyCommand({ node: "/bin/node", cli: "/a/main.ts" }, "add", bad, pub("OLD"))).toThrow();
 expect(() => buildKeyCommand({ node: "/bin/node", cli: "/a/../main.ts" }, "add", pub("NEW"), pub("OLD"))).toThrow();
});
