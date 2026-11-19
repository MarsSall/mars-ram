import { beforeEach, expect, it, vi } from "vitest";
import type { GiftThemeData } from "../src/core/gift-themes";
import { readGiftThemes, writeGiftThemes } from "../src/adapters/file-gift-themes";

const { files, failures } = vi.hoisted(() => ({ files: new Map<string, string>(), failures: { read: false, write: false } }));
vi.mock("expo-file-system", () => ({
 Paths: { document: "private-documents" },
 File: class {
  path: string;
  constructor(...parts: string[]) { this.path = parts.join("/"); }
  get exists() { return files.has(this.path); }
  create() { files.set(this.path, ""); }
  textSync() { if (failures.read) throw new Error("unavailable"); return files.get(this.path)!; }
  async write(text: string) { if (failures.write) throw new Error("disk full"); files.set(this.path, text); }
 },
}));
const path = "private-documents/gift-themes.json";
const theme: GiftThemeData = {
 id: "sample-gift", label: "Sample",
 greeting: { es: { title: "Hola", body: "Tuyo." }, en: { title: "Hi", body: "Yours." } },
 colors: {
  fileModified: "#E5B567", fileDeleted: "#F27A7A", fileUncommitted: "#93C9A0", fileLastCommit: "#9FC4EE", background: "#10141C", surface: "#151A24", surfaceRaised: "#1B2230", border: "#3E6FB0", text: "#EEF1F6", textMuted: "#97A3B5",
  accent: "#6FB3F0", accentText: "#9CCBFF", tabActive: "#9CCBFF", tabActiveIcon: "#7FA8D8", card: "rgba(27, 34, 48, 0.72)", onAccent: "#10141C", attention: "#E3C47F", working: "#ADE3C0", done: "#ADE3C0", danger: "#F27A7A", terminalBackground: "#10141C", terminalText: "#EEF1F6",
 },
 primaryFill: {},
};
beforeEach(() => { files.clear(); failures.read = false; failures.write = false; });

it("reads a missing file as nothing unlocked", () => {
 expect(readGiftThemes()).toEqual([]);
});

it("writes the unlocked list and reads it back", async () => {
 await writeGiftThemes([{ code: "TEST2345", theme }]);
 expect([...files.keys()]).toEqual([path]);
 expect(readGiftThemes()).toEqual([{ code: "TEST2345", theme }]);
});

it("reads damaged or unreadable storage as nothing unlocked", () => {
 files.set(path, "{not json");
 expect(readGiftThemes()).toEqual([]);
 files.set(path, "[]");
 failures.read = true;
 expect(readGiftThemes()).toEqual([]);
});

it("reports a failed write and keeps writing afterwards", async () => {
 failures.write = true;
 await expect(writeGiftThemes([{ code: "TEST2345", theme }])).rejects.toThrow("disk full");
 failures.write = false;
 await writeGiftThemes([{ code: "TEST2345", theme }]);
 expect(readGiftThemes()).toHaveLength(1);
});
