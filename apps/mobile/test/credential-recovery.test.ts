import { beforeEach, expect, it, vi } from "vitest";
import { fileHostCatalog } from "../src/adapters/file-host-catalog";
import { fileKeySecurity } from "../src/adapters/file-key-security";
import { fileLinkHistory } from "../src/adapters/file-link-history";
import { expoAttachmentStorage } from "../src/adapters/expo-attachment-storage";
import { KeySecurity, type KeySecurityState } from "../src/core/key-security";
import type { HostConnection } from "../src/core/ports";
import { FakeSsh, failure, savedHost } from "./fakes";
const { files, crash } = vi.hoisted(() => ({ files: new Map<string, string>(), crash: { move: false } }));
vi.mock("expo-file-system", () => {
 class Directory { path: string; constructor(...parts: string[]) { this.path = parts.join("/"); } create() {} }
 class File {
  path: string;
  constructor(...parts: (string | Directory)[]) { this.path = parts.map(p => typeof p === "string" ? p : p.path).join("/"); }
  get uri() { return this.path; }
  get exists() { return files.has(this.path); }
  create() { files.set(this.path, ""); }
  textSync() { return files.get(this.path)!; }
  async text() { return this.textSync(); }
  async write(text: string) { await Promise.resolve(); files.set(this.path, text); }
  async move(to: File) { await Promise.resolve(); this.moveSync(to); }
  moveSync(to: File) {
   // Expo Android replacement deletes the destination BEFORE attempting rename.
   files.delete(to.path);
   if (crash.move) throw new Error("process stopped after delete");
   files.set(to.path, files.get(this.path)!); files.delete(this.path);
  }
 }
 return { File, Directory, Paths: { document: "private" } };
});
const pending: KeySecurityState = { version: 1, requireUnlock: false,
 current: { alias: "app-ssh-key-1", publicKey: "ssh-ed25519 BBBB", requireUnlock: false },
 previous: { alias: "app-ssh-key", publicKey: "ssh-ed25519 AAAA", requireUnlock: true }, next: 2 };
const host = savedHost("offline", { keyAlias: "app-ssh-key", rotation: { phase: "pending" } });
function api() {
 const ssh = new FakeSsh(); ssh.refuse = failure("UNREACHABLE");
 const deleteKey = vi.fn(async () => {});
 const ensureKey = vi.fn(async () => ({ publicKey: "ssh-ed25519 AAAA" }));
 return { deleteKey, ensureKey, security: new KeySecurity({ store: fileKeySecurity, catalog: fileHostCatalog,
  host: ssh as unknown as HostConnection, credentials: { deleteKey, ensureKey, unlock: async () => true } }) };
}
beforeEach(() => { files.clear(); crash.move = false; });
it("establishes an explicit empty catalog before initializing pristine credentials", async () => {
 const f = api(); await f.security.current();
 expect(JSON.parse(files.get("private/hosts.json")!).hosts).toEqual([]);
 expect((await f.security.status()).perComputer).toEqual([]);
 expect(f.deleteKey).not.toHaveBeenCalled();
});
it.each(["rotated", "pending", "added", "verified", "legacy"])("checks %s catalog references before initializing missing metadata", async scenario => {
 await fileHostCatalog.save(savedHost("existing", { keyAlias: scenario === "rotated" ? "app-ssh-key-1" : "app-ssh-key",
  ...(scenario !== "rotated" && scenario !== "legacy" ? { rotation: { phase: scenario as "pending" | "added" | "verified" } } : {}) }));
 const f = api();
 if (scenario === "legacy") { await f.security.current(); expect(f.ensureKey).toHaveBeenCalledOnce(); }
 else {
  await expect(f.security.current()).rejects.toMatchObject({ code: "CREDENTIAL_METADATA_DAMAGED" });
  await expect(f.security.status()).rejects.toMatchObject({ code: "CREDENTIAL_METADATA_DAMAGED" });
  expect(f.ensureKey).not.toHaveBeenCalled();
 }
});
it("prefers a valid destination to a valid stale part", async () => {
 await fileHostCatalog.save(host);
 files.set("private/hosts.json.part", JSON.stringify({ version: 2, hosts: [] }));
 expect((await fileHostCatalog.list()).map(h => h.id)).toEqual(["offline"]);
 await fileKeySecurity.write(pending);
 files.set("private/key-security.json.part", JSON.stringify({ ...pending, previous: undefined }));
 expect(await fileKeySecurity.read()).toEqual(pending);
});
it("treats invalid noncredential orphan parts as absent without promoting them", async () => {
 files.set("private/link-history.json.part", "truncated");
 files.set("private/sent-attachments/history.json.part", JSON.stringify([{}]));
 expect(await fileLinkHistory.list("a")).toEqual([]);
 expect(expoAttachmentStorage.read()).toBeNull();
 expect(files.has("private/link-history.json")).toBe(false);
 expect(files.has("private/sent-attachments/history.json")).toBe(false);
});
it("recovers hosts from a delete-then-rename crash and retains the offline computer's old alias", async () => {
 await fileHostCatalog.save(host); await fileKeySecurity.write(pending);
 crash.move = true;
 await expect(fileHostCatalog.save(host)).rejects.toThrow();
 expect(files.has("private/hosts.json")).toBe(false);
 expect(files.has("private/hosts.json.part")).toBe(true);
 crash.move = false;
 const f = api(); await f.security.resume();
 expect((await fileHostCatalog.list()).map(h => h.id)).toEqual(["offline"]);
 expect(files.has("private/hosts.json.part")).toBe(false);
 expect(f.deleteKey).not.toHaveBeenCalled();
});
it("recovers the rotation intent after key-security replacement deletes its destination", async () => {
 await fileHostCatalog.save(host); await fileKeySecurity.write(pending);
 crash.move = true; await expect(fileKeySecurity.write(pending)).rejects.toThrow(); crash.move = false;
 const f = api(); await f.security.resume();
 expect(await fileKeySecurity.read()).toEqual(pending);
 expect(files.has("private/key-security.json.part")).toBe(false);
 expect(f.ensureKey).not.toHaveBeenCalled(); expect(f.deleteKey).not.toHaveBeenCalled();
});
it.each(["missing hosts", "broken hosts part", "broken key part", "unreadable stale hosts part", "unreadable stale key part"])("fails closed with typed credential damage: %s", async scenario => {
 await fileHostCatalog.save(host); await fileKeySecurity.write(pending);
 if (scenario === "missing hosts" || scenario === "broken hosts part") files.delete("private/hosts.json");
 if (scenario === "broken hosts part" || scenario === "unreadable stale hosts part") files.set("private/hosts.json.part", "truncated");
 if (scenario === "broken key part") files.delete("private/key-security.json");
 if (scenario === "broken key part" || scenario === "unreadable stale key part") files.set("private/key-security.json.part", "truncated");
 const f = api();
 await expect(f.security.resume()).rejects.toMatchObject({ code: "CREDENTIAL_METADATA_DAMAGED" });
 await expect(f.security.status()).rejects.toMatchObject({ code: "CREDENTIAL_METADATA_DAMAGED" });
 expect(f.deleteKey).not.toHaveBeenCalled(); expect(f.ensureKey).not.toHaveBeenCalled();
});
it("recovers link and attachment histories after delete-then-rename failures", async () => {
 files.set("private/link-history.json", "[]");
 crash.move = true;
 await expect(fileLinkHistory.remove("a", "missing")).rejects.toThrow();
 expect(files.has("private/link-history.json")).toBe(false);
 crash.move = false;
 expect(await fileLinkHistory.list("a")).toEqual([]);
 expect(files.get("private/link-history.json")).toBe("[]");
 await expoAttachmentStorage.write("[]");
 crash.move = true;
 await expect(expoAttachmentStorage.write("[]")).rejects.toThrow();
 expect(files.has("private/sent-attachments/history.json")).toBe(false);
 crash.move = false;
 expect(expoAttachmentStorage.read()).toBe("[]");
 expect(files.get("private/sent-attachments/history.json")).toBe("[]");
});
