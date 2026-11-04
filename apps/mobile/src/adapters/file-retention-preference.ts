import { File, Paths } from "expo-file-system";
import type { AttachmentRetention } from "../core/attachment-retention";
import { parseRetention } from "../core/retention-preference";

const file = () => new File(Paths.document, "attachment-retention.json");
export function readRetention(): AttachmentRetention {
 try { const current = file(); return parseRetention(current.exists ? current.textSync() : null); }
 catch { return 7; }
}
let queue: Promise<unknown> = Promise.resolve();
export function writeRetention(value: AttachmentRetention): Promise<void> {
 const write = async () => { const current = file(); if (!current.exists) current.create(); await current.write(JSON.stringify(value)); };
 const next = queue.then(write, write);
 queue = next.catch(() => undefined);
 return next;
}
