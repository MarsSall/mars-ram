import type { AttachmentRetention } from "./attachment-retention";

export function parseRetention(raw: string | null): AttachmentRetention {
 try {
  const value: unknown = JSON.parse(raw ?? "null");
  return value === 1 || value === 7 || value === 30 || value === "never" ? value : 7;
 } catch { return 7; }
}
