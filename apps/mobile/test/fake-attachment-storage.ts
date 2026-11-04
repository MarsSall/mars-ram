import type { AttachmentStorage } from "../src/core/attachment-storage";

export class FakeAttachmentStorage implements AttachmentStorage {
 json: string | null = null;
 copies = new Map<string, { uri: string; createdAt: number }>();
 failCopy = false;
 failSave = false;
 copiedLimits: number[] = [];
 read() { return this.json; }
 async write(json: string) { if (this.failSave) throw new Error("disk full"); this.json = json; }
 async copy(source: string, name: string, maxBytes: number) {
  this.copiedLimits.push(maxBytes);
  if (this.failCopy) throw new Error("unreadable");
  const uri = `file:///private/sent-attachments/${name}`;
  this.copies.set(name, { uri, createdAt: 1000 });
  return uri;
 }
 hasCopy(name: string, uri: string) { return this.copies.get(name)?.uri === uri; }
 list() { return [...this.copies].map(([name, copy]) => ({ name, modifiedAt: copy.createdAt })); }
 async remove(name: string) { this.copies.delete(name); }
}
