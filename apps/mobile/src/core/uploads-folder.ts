// S3/S5: the host decides where phone attachments land (`uploads-dir --json`);
// the app only uses the absolute folder it reports, per connection.
import { decodeUploadsDir } from "@workspace/protocol";
import { hostCliPrefix } from "./herdr-switcher";
import { readHostRecord } from "./host-record";
import type { Failure, HostConnection } from "./ports";

/** path is native (terminal paste); sftpPath is what SFTP sees, e.g. /C:/Users/… on Windows. */
export type UploadsFolder = { path: string; sftpPath: string; windows: boolean };
export type UploadsFolderResult = { ok: true; folder: UploadsFolder } | Failure;
/** Port: the host's private uploads folder for one SSH connection. */
export interface UploadsFolderLookup {
	folder(connectionId: string): Promise<UploadsFolderResult>;
}

export const UPDATE_REQUIRED_MESSAGE = "Update the app and mars-ram to send files.";
export const FOLDER_REFUSED_PREFIX = "Uploads folder refused: ";
export const FOLDER_UNAVAILABLE_PREFIX = "Uploads folder unavailable: ";
const updateRequired = (): Failure => ({ ok: false, code: "UPDATE_REQUIRED", message: UPDATE_REQUIRED_MESSAGE });

export { supportsTempUploads } from "@workspace/protocol";

const component = (part: string) => part !== "" && part !== "." && part !== ".." && !/[\x00-\x1f\x7f]/.test(part);
/** Absolute POSIX or drive-letter Windows folder; never root, relative, UNC, `..` or empty components. */
export function uploadsFolder(value: unknown): UploadsFolder | null {
	if (typeof value !== "string" || value.length > 1024) return null;
	const drive = /^\/?([A-Za-z]):[\\/](.*)$/.exec(value);
	if (drive) {
		const parts = drive[2]!.split(/[\\/]/);
		if (!parts.every(part => component(part) && !/[:"<>|?*]/.test(part))) return null;
		const letter = drive[1]!.toUpperCase();
		return { path: `${letter}:\\${parts.join("\\")}`, sftpPath: `/${letter}:/${parts.join("/")}`, windows: true };
	}
	if (!value.startsWith("/")) return null;
	const parts = value.slice(1).split("/");
	// Same rule as the native SFTP scope: no backslash or colon outside a Windows drive.
	if (!parts.every(part => component(part) && !/[\\:]/.test(part))) return null;
	return { path: value, sftpPath: value, windows: false };
}

function hostMessage(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const text = value.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 300);
	return text || null;
}

type Exec = Awaited<ReturnType<HostConnection["exec"]>>;
/** Shared v1 decoder plus the app's path rules. A transport failure is passed through: it is not evidence of an old CLI. */
export function parseUploadsFolder(result: Exec): UploadsFolderResult {
	if (!result.ok) return result;
	if (result.stdout.length > 4096 || (result.exitStatus !== 0 && result.exitStatus !== 1)) return updateRequired();
	const decoded = decodeUploadsDir(result.stdout);
	if (!decoded || decoded.ok !== (result.exitStatus === 0)) return updateRequired();
	if (decoded.ok) {
		const folder = uploadsFolder(decoded.path);
		return folder ? { ok: true, folder } : updateRequired();
	}
	const message = hostMessage(decoded.message);
	if (!message) return updateRequired();
	return decoded.error === "unsafe_folder" ? { ok: false, code: "PERMISSION_DENIED", message: FOLDER_REFUSED_PREFIX + message }
		: { ok: false, code: "SSH_ERROR", message: FOLDER_UNAVAILABLE_PREFIX + message };
}

const CACHED_CONNECTIONS = 16;
/** Runs the installed CLI over SSH; successes are cached per connection, failures retried. */
export class HostUploadsFolder implements UploadsFolderLookup {
	private readonly cache = new Map<string, Promise<UploadsFolderResult>>();
	constructor(private readonly host: Pick<HostConnection, "exec" | "readFile">) {}

	folder(connectionId: string): Promise<UploadsFolderResult> {
		const cached = this.cache.get(connectionId);
		if (cached) return cached;
		const result = this.read(connectionId).then(value => {
			if (!value.ok && this.cache.get(connectionId) === result) this.cache.delete(connectionId);
			return value;
		});
		this.cache.set(connectionId, result);
		while (this.cache.size > CACHED_CONNECTIONS) this.cache.delete(this.cache.keys().next().value!);
		return result;
	}

	private async read(connectionId: string): Promise<UploadsFolderResult> {
		try {
			const record = await readHostRecord(this.host, connectionId);
			let command: string;
			try { command = `${hostCliPrefix(record)} uploads-dir --json`; } catch { return updateRequired(); }
			return parseUploadsFolder(await this.host.exec(connectionId, command));
		} catch {
			return { ok: false, code: "SSH_ERROR", message: "The uploads folder could not be checked." };
		}
	}
}
