import type { Attachment } from "./attachment-draft";

export type AttachmentSource = "gallery" | "camera" | "clipboard" | "files";
export type SourceResult = { ok: true; items: Omit<Attachment, "kind">[] } | { ok: false; reason: "noImage" | "cameraDenied" | "sourceFailed" };
/** MediaSource and Clipboard ports: platform reads happen only after the user's explicit choice. */
export interface MediaSource { select(source: AttachmentSource): Promise<SourceResult>; }
