// Private phone persistence for LinkService. All computers share one serialized JSON document.
import { File, Paths } from "expo-file-system";
import { isLinkHistoryEntry, type LinkHistoryEntry, type LinkHistoryStore } from "../core/links";
import { readDurable, writeDurable } from "./durable-file";

const file = () => new File(Paths.document, "link-history.json");
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
 const next = queue.then(task, task);
 queue = next.catch(() => undefined);
 return next;
}
async function read(): Promise<LinkHistoryEntry[]> {
 try {
  return await readDurable(file(), text => {
   const value: unknown = JSON.parse(text);
   if (!Array.isArray(value) || !value.every(isLinkHistoryEntry)) throw new Error();
   return value;
  }) ?? [];
 } catch { throw new Error("Link history could not be read."); }
}
// A valid orphaned .part is recovered if replacement deleted the destination.
async function write(entries: LinkHistoryEntry[]): Promise<void> {
 try {
  await writeDurable(file(), JSON.stringify(entries));
 } catch { throw new Error("Link history could not be saved."); }
}
export const fileLinkHistory: LinkHistoryStore = {
 list: computerId => serialized(async () => (await read()).filter(e => e.computerId === computerId)),
 save: entry => serialized(async () => {
  if (!isLinkHistoryEntry(entry)) throw new Error("Link history could not be saved.");
  const entries = (await read()).filter(e => e.computerId !== entry.computerId || e.id !== entry.id);
  await write([...entries, entry]);
 }),
 remove: (computerId, id) => serialized(async () => write((await read()).filter(e => e.computerId !== computerId || e.id !== id))),
};
