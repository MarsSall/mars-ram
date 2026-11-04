import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ source: new Uint8Array(), reportedSize: null as number | null, written: 0, deleted: false, closed: 0 }));
vi.mock("expo-file-system", () => {
 class Directory { uri = "file:///private/sent-attachments"; create() {} }
 class File {
  uri: string;
  exists = false;
  constructor(parent: string | Directory, name?: string) { this.uri = typeof parent === "string" ? parent : `${parent.uri}/${name}`; }
  create() { this.exists = true; }
  delete() { this.exists = false; state.deleted = true; }
  open(mode: string) {
   let offset = 0;
   return {
    size: state.reportedSize,
    close() { state.closed++; },
    async readBytes(length: number) { const bytes = state.source.slice(offset, offset + length); offset += bytes.length; return bytes; },
    async writeBytes(bytes: Uint8Array) { state.written += bytes.length; },
   };
  }
 }
 return { Directory, File, FileMode: { ReadOnly: "r", WriteOnly: "w" }, Paths: { document: "file:///private" } };
});
import { expoAttachmentStorage } from "../src/adapters/expo-attachment-storage";

describe("private image copy adapter", () => {
 beforeEach(() => { state.source = new Uint8Array(); state.reportedSize = null; state.written = 0; state.deleted = false; state.closed = 0; });
 it("copies an unknown-size URI up to the exact cap and closes both handles", async () => {
  state.source = new Uint8Array(10);
  expect(await expoAttachmentStorage.copy("content://photo", "photo.png", 10)).toBe("file:///private/sent-attachments/photo.png");
  expect(state.written).toBe(10);
  expect(state.closed).toBe(2);
  expect(state.deleted).toBe(false);
 });
 it("rejects a growing/unknown-size source without ever writing more than the cap", async () => {
  state.source = new Uint8Array(70000);
  state.reportedSize = 1;
  await expect(expoAttachmentStorage.copy("content://photo", "photo.png", 65536)).rejects.toThrow("too large");
  expect(state.written).toBe(65536);
  expect(state.closed).toBe(2);
  expect(state.deleted).toBe(true);
 });
 it("rejects a known oversized source before writing", async () => {
  state.reportedSize = 11;
  await expect(expoAttachmentStorage.copy("content://photo", "photo.png", 10)).rejects.toThrow("too large");
  expect(state.written).toBe(0);
  expect(state.closed).toBe(1);
 });
 it("rejects path traversal before touching storage", async () => {
  await expect(expoAttachmentStorage.copy("content://photo", "../private", 10)).rejects.toThrow("Invalid copy name");
  expect(state.closed).toBe(0);
 });
});
