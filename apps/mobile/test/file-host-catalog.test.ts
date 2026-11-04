import { beforeEach, expect, it, vi } from "vitest";
import { fileHostCatalog } from "../src/adapters/file-host-catalog";
import { savedHost } from "./fakes";
const { files, failing } = vi.hoisted(() => ({ files: new Map<string, string>(), failing: { write: false } }));
vi.mock("expo-file-system", () => ({
 Paths: { document: "private-documents" },
 File: class {
  path: string;
  constructor(...parts: string[]) { this.path = parts.join("/"); }
  get uri() { return this.path; }
  get exists() { return files.has(this.path); }
  create() { files.set(this.path, ""); }
  async text() { return files.get(this.path)!; }
  async write(text: string) { await Promise.resolve(); if (failing.write) throw new Error("disk full"); files.set(this.path, text); }
  async move(to: { path: string }) { await Promise.resolve(); files.set(to.path, files.get(this.path)!); files.delete(this.path); }
 },
}));
beforeEach(() => { files.clear(); failing.write = false; });
it("migrates legacy hosts and persists aliases in version 2 on the next atomic write", async () => {
 files.set("private-documents/hosts.json", JSON.stringify({ version: 1, hosts: [savedHost("a")] }));
 const [host] = await fileHostCatalog.list();
 expect(host).toMatchObject({ keyAlias: "app-ssh-key", rotation: { phase: "done" } });
 await fileHostCatalog.save(host);
 expect(JSON.parse(files.get("private-documents/hosts.json")!).version).toBe(2);
 expect([...files.keys()]).toEqual(["private-documents/hosts.json"]);
});
it("fails closed when a failed catalog checkpoint leaves an unreadable part", async () => {
 await fileHostCatalog.save(savedHost("a", { keyAlias: "app-ssh-key" }));
 failing.write = true;
 await expect(fileHostCatalog.save(savedHost("a", { keyAlias: "app-ssh-key-1" }))).rejects.toThrow();
 await expect(fileHostCatalog.list()).rejects.toMatchObject({ code: "CREDENTIAL_METADATA_DAMAGED" });
 expect(JSON.parse(files.get("private-documents/hosts.json")!).hosts[0].keyAlias).toBe("app-ssh-key");
});
it.each(["invalid JSON", JSON.stringify({ version: 2, hosts: [savedHost("a"), { id: "broken" }] }), JSON.stringify({ version: 3, hosts: [] })])("fails closed rather than hiding possible alias dependencies in a damaged catalog", async text => {
 files.set("private-documents/hosts.json", text);
 await expect(fileHostCatalog.list()).rejects.toThrow("catalog could not be read");
 await expect(fileHostCatalog.save(savedHost("b"))).rejects.toThrow("catalog could not be read");
 expect(files.get("private-documents/hosts.json")).toBe(text);
});
