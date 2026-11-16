import { beforeEach, expect, it, vi } from "vitest";
import { fileTourFlags } from "../src/adapters/file-tour-flags";
const { files } = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock("expo-file-system", () => ({
 Paths: { document: "private-documents" },
 File: class {
  path: string;
  constructor(...parts: string[]) { this.path = parts.join("/"); }
  get uri() { return this.path; }
  get exists() { return files.has(this.path); }
  create() { files.set(this.path, ""); }
  async text() { return files.get(this.path)!; }
  async write(text: string) { files.set(this.path, text); }
  async move(to: { path: string }) { files.set(to.path, files.get(this.path)!); files.delete(this.path); }
 },
}));
const path = "private-documents/tour-flags.json";
beforeEach(() => files.clear());

it("reads a missing file as nothing recorded", async () => {
 expect(await fileTourFlags.read()).toEqual({ kind: "none" });
});

it("writes durably and reads back only the flags", async () => {
 await fileTourFlags.write({ tourSeen: true, tips: ["terminal"] });
 expect([...files.keys()]).toEqual([path]);
 expect(JSON.parse(files.get(path)!)).toEqual({ version: 1, tourSeen: true, tips: ["terminal"] });
 expect(await fileTourFlags.read()).toEqual({ kind: "saved", flags: { tourSeen: true, tips: ["terminal"] } });
});

it("reports a corrupt file as damaged without erasing it", async () => {
 files.set(path, "{not json");
 expect(await fileTourFlags.read()).toEqual({ kind: "damaged" });
 expect(files.get(path)).toBe("{not json");
});

it("recovers a fully written .part left by a crash", async () => {
 files.set(`${path}.part`, JSON.stringify({ version: 1, tourSeen: true, tips: [] }));
 expect(await fileTourFlags.read()).toEqual({ kind: "saved", flags: { tourSeen: true, tips: [] } });
 expect(files.has(path)).toBe(true);
});
