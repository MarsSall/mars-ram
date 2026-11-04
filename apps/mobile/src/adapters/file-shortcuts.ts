import { File, Paths } from "expo-file-system";
import { addShortcut, parseStoredShortcuts, removeShortcut, type Shortcut } from "../core/shortcuts";
import { readDurable, writeDurable } from "./durable-file";

const file = () => new File(Paths.document, "shortcuts.json");
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
 const next = queue.then(task, task); queue = next.catch(() => undefined); return next;
}
async function read(): Promise<Shortcut[]> {
 return await readDurable(file(), parseStoredShortcuts, true) ?? [];
}
async function readForDisplay(): Promise<Shortcut[]> {
 try { return await read(); } catch { return []; }
}
async function write(shortcuts: Shortcut[]): Promise<void> {
 await writeDurable(file(), JSON.stringify({ version: 1, shortcuts }));
}
export const fileShortcuts = {
 list: () => serialized(readForDisplay),
 add: (item: Shortcut) => serialized(async () => { const result = addShortcut(await read(), item); await write(result); return result; }),
 remove: (id: string) => serialized(async () => { const result = removeShortcut(await read(), id); await write(result); return result; }),
};
