import { beforeEach, expect, it, vi } from "vitest";
import { fileShortcuts } from "../src/adapters/file-shortcuts";
const { files, failing } = vi.hoisted(() => ({ files: new Map<string, string>(), failing: { read: false } }));
vi.mock("expo-file-system", () => ({ Paths: { document: "docs" }, File: class {
 path: string; constructor(...parts: string[]) { this.path = parts.join("/"); }
 get uri() { return this.path; } get exists() { return files.has(this.path); }
 create() { files.set(this.path, ""); }
 async text() { if (failing.read) throw Error("I/O error"); return files.get(this.path)!; }
 async write(text: string) { files.set(this.path, text); }
 async move(to: { path: string }) { files.set(to.path, files.get(this.path)!); files.delete(this.path); }
} }));
const a = { id: "a", computerId: "c", repoPath: "/a", repoName: "a", program: "pi" as const };
const b = { ...a, id: "b", repoPath: "/b" };
beforeEach(() => { files.clear(); failing.read = false; });
it("does not overwrite stored shortcuts when reading fails", async () => {
 const stored = JSON.stringify({ version: 1, shortcuts: [a] }); files.set("docs/shortcuts.json", stored); failing.read = true;
 expect(await fileShortcuts.list()).toEqual([]);
 await expect(fileShortcuts.add(b)).rejects.toThrow();
 await expect(fileShortcuts.remove("a")).rejects.toThrow();
 expect(files.get("docs/shortcuts.json")).toBe(stored);
 failing.read = false; expect(await fileShortcuts.list()).toEqual([a]);
});
it("preserves an over-limit file when listing or refusing an addition", async () => {
 const rows = Array.from({ length: 501 }, (_, i) => ({ ...a, id: String(i), repoPath: `/r${i}` }));
 const stored = JSON.stringify({ version: 1, shortcuts: rows }); files.set("docs/shortcuts.json", stored);
 expect(await fileShortcuts.list()).toHaveLength(501);
 await expect(fileShortcuts.add(b)).rejects.toThrow("SHORTCUT_LIMIT");
 expect(files.get("docs/shortcuts.json")).toBe(stored);
 await fileShortcuts.remove("0"); expect(await fileShortcuts.list()).toHaveLength(500);
});
it("allows missing and corrupt files to display empty", async () => {
 expect(await fileShortcuts.list()).toEqual([]);
 files.set("docs/shortcuts.json", "{"); expect(await fileShortcuts.list()).toEqual([]);
});
