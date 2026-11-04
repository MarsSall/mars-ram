import { beforeEach, expect, it, vi } from "vitest";
import { fileKeySecurity } from "../src/adapters/file-key-security";
import type { KeySecurityState } from "../src/core/key-security";
const { files, failing } = vi.hoisted(() => ({ files: new Map<string, string>(), failing: { write: false, move: false } }));
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
  async move(to: { path: string }) { await Promise.resolve(); if (failing.move) throw new Error("move failed"); files.set(to.path, files.get(this.path)!); files.delete(this.path); }
 },
}));
const state: KeySecurityState = { version: 1, requireUnlock: true, current: { alias: "app-ssh-key", publicKey: "ssh-ed25519 AAAA", requireUnlock: true }, next: 1 };
beforeEach(() => { files.clear(); failing.write = false; failing.move = false; });
it("awaits durable writes and serializes readers", async () => {
 expect(await fileKeySecurity.read()).toBeNull();
 const saving = fileKeySecurity.write(state);
 expect(await fileKeySecurity.read()).toEqual(state);
 await saving;
 expect([...files.keys()]).toEqual(["private-documents/key-security.json"]);
});
it.each(["write", "move"] as const)("preserves earlier bytes and rejects unreadable parts on %s failure", async step => {
 await fileKeySecurity.write(state);
 failing[step] = true;
 await expect(fileKeySecurity.write({ ...state, next: 2 })).rejects.toThrow("could not be saved");
 if (step === "write") await expect(fileKeySecurity.read()).rejects.toMatchObject({ code: "CREDENTIAL_METADATA_DAMAGED" });
 else expect(await fileKeySecurity.read()).toEqual(state);
 expect(JSON.parse(files.get("private-documents/key-security.json")!)).toEqual(state);
});
it.each(["invalid JSON", JSON.stringify({ ...state, requireUnlock: false }), JSON.stringify({ ...state, next: 0 }), JSON.stringify({ ...state, previous: state.current })])("fails closed on corrupt metadata without replacing it", async text => {
 files.set("private-documents/key-security.json", text);
 await expect(fileKeySecurity.read()).rejects.toThrow("could not be read");
 expect(files.get("private-documents/key-security.json")).toBe(text);
});
