import { ATTACHMENT_MAX_BYTES, supportsAttachments, UPLOADS_DIRECTORY, type UploadName } from "@workspace/protocol";
import { addAttachment, uploadName, type Attachment } from "./attachment-draft";
import type { ConnectionResult } from "./host-connections";
import type { HostConnection } from "./ports";
import type { AttachmentHistory } from "./attachment-history";

/** AttachmentTransfer use case backed by the existing HostConnection port. */
export type AttachmentUploads = {
	host: HostConnection;
	connection(): Promise<ConnectionResult>;
	clock(): number;
	random(): number;
	history?: AttachmentHistory;
};

/** current=0 signals the batch is uploaded and the bridge send is starting. */
export type UploadProgress = (current: number, total: number) => void;

type UploadResult = { ok: true; names: UploadName[] } | { ok: false; message: string };

/** Never changes the caller's draft; only its owner may clear it after a confirmed send. */
export async function uploadAttachments(deps: AttachmentUploads | undefined, version: string, items: readonly Attachment[], progress?: UploadProgress): Promise<UploadResult> {
	if (!supportsAttachments(version)) return { ok: false, message: "Please update Mars-RAM on the computer to send attachments." };
	return uploadTerminalAttachments(deps, items, progress);
}

/** SFTP transfer without a bridge protocol requirement (raw terminal composer). */
export async function uploadTerminalAttachments(deps: AttachmentUploads | undefined, items: readonly Attachment[], progress?: UploadProgress): Promise<UploadResult> {
	if (!deps) return { ok: false, message: "The session is not connected for file uploads." };
	let checked: readonly Attachment[] = [];
	for (const item of items) {
		const result = addAttachment(checked, item);
		if (!result.ok) return result;
		checked = result.items;
	}
	const names: UploadName[] = [];
	let connectionId: string | null = null;
	const clean = async () => {
		if (connectionId === null) return;
		await Promise.all(names.map(async name => {
			try { await deps.host.removeFile(connectionId!, `${UPLOADS_DIRECTORY}/${name}`); } catch { /* Best effort after a failed batch. */ }
		}));
	};
	try {
		const connection = await deps.connection();
		if (!connection.ok) return { ok: false, message: connection.message };
		connectionId = connection.connectionId;
		for (const item of items) {
			progress?.(names.length + 1, items.length);
			const name = uploadName(item.displayName, deps.clock, deps.random);
			const result = await deps.host.uploadFile(connectionId, item.sourceUri, UPLOADS_DIRECTORY, name, ATTACHMENT_MAX_BYTES);
			if (!result.ok) {
				await clean();
				return { ok: false, message: result.code === "TOO_LARGE" ? `${item.displayName} is over 25 MB. Choose a smaller file.`
					: result.code === "SOURCE_UNREADABLE" ? `${item.displayName} could not be read. Please select it again.` : result.message };
			}
			names.push(name);
			await deps.history?.remember(name, { uri: item.sourceUri, displayName: item.displayName, mimeType: item.mimeType });
		}
		progress?.(0, items.length);
		return { ok: true, names };
	} catch {
		await clean();
		return { ok: false, message: "The file upload could not be completed. Keep your draft and try again." };
	}
}
