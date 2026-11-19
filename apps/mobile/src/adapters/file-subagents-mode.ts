import { File, Paths } from "expo-file-system";
import { DEFAULT_SUBAGENTS_MODE, parseSubagentsMode, type SubagentsMode } from "../core/subagents-mode";

const file = () => new File(Paths.document, "subagents-mode.json");
export function readSubagentsMode(): SubagentsMode {
 try { const current = file(); return parseSubagentsMode(current.exists ? current.textSync() : null); }
 catch { return DEFAULT_SUBAGENTS_MODE; }
}
let queue: Promise<unknown> = Promise.resolve();
export function writeSubagentsMode(value: SubagentsMode): Promise<void> {
 const write = async () => { const current = file(); if (!current.exists) current.create(); await current.write(JSON.stringify(value)); };
 const next = queue.then(write, write);
 queue = next.catch(() => undefined);
 return next;
}
