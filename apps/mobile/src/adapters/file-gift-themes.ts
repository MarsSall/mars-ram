// Gift themes unlocked on this phone, kept in the app's private documents.
import { File, Paths } from "expo-file-system";
import { parseUnlockedGifts, serializeUnlockedGifts, type UnlockedGift } from "../core/gift-themes";

const file = () => new File(Paths.document, "gift-themes.json");
/** Unreadable or damaged storage reads as nothing unlocked. */
export function readGiftThemes(): UnlockedGift[] {
 try { const current = file(); return parseUnlockedGifts(current.exists ? current.textSync() : null); }
 catch { return []; }
}
let queue: Promise<unknown> = Promise.resolve();
export function writeGiftThemes(list: readonly UnlockedGift[]): Promise<void> {
 const text = serializeUnlockedGifts(list);
 const write = async () => { const current = file(); if (!current.exists) current.create(); await current.write(text); };
 const next = queue.then(write, write);
 queue = next.catch(() => undefined);
 return next;
}
