import { File } from "expo-file-system";

type Parse<T> = (text: string) => T;
const part = (file: File) => new File(`${file.uri}.part`);
/** Expo's overwrite is delete-then-rename, NOT atomic replacement. Keep a fully
 * written .part recoverable when a crash occurs after destination deletion. */
export async function writeDurable(file: File, text: string): Promise<void> {
 const pending = part(file);
 pending.create({ overwrite: true });
 await pending.write(text);
 await pending.move(file, { overwrite: true });
}
export function hasDurable(file: File): boolean { return file.exists || part(file).exists; }
/** Credential callers reject even unreadable stale parts: they may contain the
 * only record of a generation/dependent. Never turn damage into an empty list. */
export async function readDurable<T>(file: File, parse: Parse<T>, strict = false): Promise<T | null> {
 const pending = part(file);
 let recovered: T | null = null;
 if (pending.exists && (!file.exists || strict)) {
  try { recovered = parse(await pending.text()); }
  catch (error) { if (strict) throw error; }
 }
 if (file.exists) return parse(await file.text());
 if (recovered === null) return null;
 await pending.move(file, { overwrite: true });
 return recovered;
}
/** AttachmentHistory loads synchronously; use Expo's explicit synchronous move
 * so recovery completes (or throws) before returning the recovered metadata. */
export function readDurableSync<T>(file: File, parse: Parse<T>): T | null {
 if (file.exists) return parse(file.textSync());
 const pending = part(file);
 if (!pending.exists) return null;
 let recovered: T;
 try { recovered = parse(pending.textSync()); } catch { return null; }
 pending.moveSync(file, { overwrite: true });
 return recovered;
}
