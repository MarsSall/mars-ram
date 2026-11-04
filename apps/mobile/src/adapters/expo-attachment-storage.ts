import { Directory, File, FileMode, Paths } from "expo-file-system";
import type { FileHandle } from "expo-file-system";
import type { AttachmentStorage } from "../core/attachment-storage";
import { readDurableSync, writeDurable } from "./durable-file";

const directory = () => new Directory(Paths.document, "sent-attachments");
const index = () => new File(directory(), "history.json");
const privateFile = (name: string) => {
 if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name) || name === "history.json") throw new Error("Invalid copy name");
 return new File(directory(), name);
};

export const expoAttachmentStorage: AttachmentStorage = {
 read() {
  return readDurableSync(index(), text => {
   const rows: unknown = JSON.parse(text);
   if (!Array.isArray(rows) || !rows.every(row => row && typeof row.name === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(row.name) && typeof row.uri === "string"
    && typeof row.displayName === "string" && typeof row.mimeType === "string" && Number.isFinite(row.createdAt))) throw new Error("Invalid attachment history");
   return text;
  });
 },
 async write(json) {
  directory().create({ idempotent: true, intermediates: true });
  await writeDurable(index(), json);
 },
 async copy(sourceUri, name, maxBytes) {
  directory().create({ idempotent: true, intermediates: true });
  const destination = privateFile(name);
  let input: FileHandle | undefined;
  let output: FileHandle | undefined;
  let complete = false;
  try {
   input = new File(sourceUri).open(FileMode.ReadOnly);
   if (input.size !== null && input.size > maxBytes) throw new Error("Image too large");
   destination.create({ overwrite: true });
   output = destination.open(FileMode.WriteOnly);
   let total = 0;
   // Bound the bytes actually written, not just the picker's possibly stale size.
   while (true) {
    const bytes = await input.readBytes(Math.min(65536, maxBytes - total + 1));
    if (!bytes.length) break;
    if (total + bytes.length > maxBytes) throw new Error("Image too large");
    await output.writeBytes(bytes);
    total += bytes.length;
   }
   complete = true;
   return destination.uri;
  } finally {
   try { input?.close(); } finally {
    try { output?.close(); } finally {
     if (!complete && destination.exists) destination.delete();
    }
   }
  }
 },
 hasCopy(name, uri) { const file = privateFile(name); return uri === file.uri && file.exists; },
 list() {
  const dir = directory();
  if (!dir.exists) return [];
  return dir.list().filter((entry): entry is File => entry instanceof File && entry.name !== "history.json" && entry.name !== "history.json.part")
   .map(file => ({ name: file.name, modifiedAt: file.modificationTime ?? 0 }));
 },
 async remove(name) { const file = privateFile(name); if (file.exists) file.delete(); },
};
