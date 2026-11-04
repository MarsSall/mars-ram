import { ATTACHMENT_MAX_BYTES, MAX_ATTACHMENTS, type UploadName } from "@workspace/protocol";

export type Attachment = {
	id: string;
	sourceUri: string;
	displayName: string;
	size: number | null;
	mimeType: string;
	kind: "image" | "file";
};

export type AttachmentDraftResult = { ok: true; items: readonly Attachment[] } | { ok: false; message: string };

export function addAttachment(items: readonly Attachment[], source: Omit<Attachment, "kind">): AttachmentDraftResult {
	if (source.size !== null && source.size > ATTACHMENT_MAX_BYTES) return { ok: false, message: `${source.displayName} is over 25 MB. Choose a smaller file.` };
	if (items.length >= MAX_ATTACHMENTS) return { ok: false, message: `Attach at most ${MAX_ATTACHMENTS} files.` };
	const kind = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(source.mimeType) ? "image" : "file";
	return { ok: true, items: [...items, { ...source, kind }] };
}

export function removeAttachment(items: readonly Attachment[], id: string): readonly Attachment[] {
	return items.filter(item => item.id !== id);
}

/** Stamp uploads in the phone's local time. Entropy is supplied by the caller. */
export function uploadName(displayName: string, clock: () => number, random: () => number): UploadName {
	const date = new Date(clock());
	const pad = (value: number) => String(value).padStart(2, "0");
	const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
	const salt = Array.from({ length: 6 }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
	const prefix = `${stamp}-${salt}-`;
	let original = displayName.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/[^A-Za-z0-9]+$/g, "") || "file";
	if (/\.part$/i.test(original)) original += "-file";
	const budget = 200 - prefix.length;
	const suffix = original.match(/\.[A-Za-z0-9_-]+$/)?.[0] ?? "";
	const extension = suffix.length < budget ? suffix : "";
	if (original.length > budget) original = original.slice(0, budget - extension.length) + extension;
	// Truncating can expose an unsafe trailing character or a previously internal `.part`.
	original = original.replace(/[^A-Za-z0-9]+$/g, "");
	if (/\.part$/i.test(original)) original = original.slice(0, -5) + "-file";
	return prefix + original;
}
