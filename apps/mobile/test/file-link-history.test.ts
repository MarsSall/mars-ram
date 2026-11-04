import { beforeEach, expect, it, vi } from "vitest";
import { fileLinkHistory } from "../src/adapters/file-link-history";
import type { LinkHistoryEntry } from "../src/core/links";
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
  // Like expo-file-system: write is asynchronous and can reject.
  async write(text: string) { await new Promise(resolve => setTimeout(resolve, 1)); if (failing.write) throw new Error("disk full"); files.set(this.path, text); }
  move(to: { path: string }) { files.set(to.path, files.get(this.path)!); files.delete(this.path); }
 },
}));
const entry: LinkHistoryEntry = { computerId: "a", id: "abcdefghijkl", fileName: "file.png", size: 3, createdAt: "2026-10-25T12:00:00.000Z", expiresAt: "2026-10-26T12:00:00.000Z", url: `http://pc:47811/l/${"x".repeat(43)}` };
beforeEach(() => { files.clear(); failing.write = false; });
it("persists and isolates history per computer with serialized concurrent writes", async () => {
 await Promise.all([fileLinkHistory.save(entry), fileLinkHistory.save({ ...entry, computerId: "b" })]);
 expect(await fileLinkHistory.list("a")).toEqual([entry]);
 expect(await fileLinkHistory.list("b")).toEqual([{ ...entry, computerId: "b" }]);
 expect([...files.keys()]).toEqual(["private-documents/link-history.json"]);
 await fileLinkHistory.remove("a", entry.id);
 expect(await fileLinkHistory.list("a")).toEqual([]);
 expect(await fileLinkHistory.list("b")).toHaveLength(1);
});
it("rejects corrupt private history without erasing it", async () => {
 files.set("private-documents/link-history.json", "bad JSON secret");
 await expect(fileLinkHistory.list("a")).rejects.toThrow("Link history could not be read.");
 await expect(fileLinkHistory.save(entry)).rejects.toThrow("Link history could not be read.");
 expect(files.get("private-documents/link-history.json")).toBe("bad JSON secret");
});
it("rejects invalid entries safely", async () => {
 files.set("private-documents/link-history.json", JSON.stringify([{ ...entry, url: "javascript:bad" }]));
 await expect(fileLinkHistory.list("a")).rejects.toThrow("Link history could not be read.");
});
it("fails the save when the write fails and keeps the previous history", async () => {
 await fileLinkHistory.save(entry);
 failing.write = true;
 await expect(fileLinkHistory.save({ ...entry, computerId: "b" })).rejects.toThrow("Link history could not be saved.");
 failing.write = false;
 expect(await fileLinkHistory.list("a")).toEqual([entry]);
 expect(await fileLinkHistory.list("b")).toEqual([]);
});
