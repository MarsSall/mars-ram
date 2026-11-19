import { beforeEach, expect, it, vi } from "vitest";
import { parseSubagentsMode } from "../src/core/subagents-mode";

// The «Subagentes en Inicio» choice (S3): saved on the phone, today's per-session view by default.
const { files } = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock("expo-file-system", () => ({
 Paths: { document: "private-documents" },
 File: class {
  path: string;
  constructor(...parts: string[]) { this.path = parts.join("/"); }
  get exists() { return files.has(this.path); }
  create() { files.set(this.path, ""); }
  textSync() { return files.get(this.path)!; }
  async write(text: string) { files.set(this.path, text); }
 },
}));
const { readSubagentsMode, writeSubagentsMode } = await import("../src/adapters/file-subagents-mode");
const path = "private-documents/subagents-mode.json";
beforeEach(() => files.clear());

it("parses the three modes and falls back to «Por sesión» for anything else", () => {
 for (const mode of ["session", "top", "hidden"] as const) expect(parseSubagentsMode(JSON.stringify(mode))).toBe(mode);
 for (const raw of [null, "", "{broken", "\"arriba\"", "1", "null", "[\"top\"]", "{\"mode\":\"top\"}"]) expect(parseSubagentsMode(raw)).toBe("session");
});

it("reads «Por sesión» when nothing is saved", () => {
 expect(readSubagentsMode()).toBe("session");
 expect(files.size).toBe(0);
});

it("persists the choice and reads it back", async () => {
 await writeSubagentsMode("top");
 expect(files.get(path)).toBe("\"top\"");
 expect(readSubagentsMode()).toBe("top");
 await writeSubagentsMode("hidden");
 expect(readSubagentsMode()).toBe("hidden");
});

it("reads a damaged file as the default without erasing it", () => {
 files.set(path, "{nope");
 expect(readSubagentsMode()).toBe("session");
 expect(files.get(path)).toBe("{nope");
});

it("keeps the last of quick successive choices", async () => {
 await Promise.all([writeSubagentsMode("top"), writeSubagentsMode("hidden"), writeSubagentsMode("session")]);
 expect(readSubagentsMode()).toBe("session");
});
