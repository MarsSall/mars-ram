// UploadStore adapter: finds attachments the app copied into the uploads folder.
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { ATTACHMENT_MAX_BYTES, UploadName } from "@workspace/protocol";
import { Value } from "typebox/value";
import type { UploadStorePort } from "../core/ports.ts";

const IMAGE_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
};

/** Not following a link when opening; Windows has no such flag, so there the lstat check stands alone. */
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

/** `verify` re-checks the folder's own policy (owner, mode, links) before each lookup. */
export function createUploadStore(dir: string, verify?: () => Promise<boolean>): UploadStorePort {
	return {
		async resolve(name) {
			if (!Value.Check(UploadName, name)) return null;
			try {
				if (verify && !(await verify())) return null;
				// A linked uploads folder would serve files from wherever it points.
				if (!(await lstat(dir)).isDirectory()) return null;
				const root = await realpath(dir);
				const candidate = join(root, name);
				// lstat, so a link is never followed to a file outside the folder.
				const info = await lstat(candidate);
				// A second name (hard link) means the file also lives somewhere else.
				if (!info.isFile() || info.nlink !== 1) return null;
				const path = await realpath(candidate);
				if (dirname(path) !== root) return null;
				return { path, size: info.size, mimeType: IMAGE_TYPES[extname(name).toLowerCase()] ?? null };
			} catch {
				return null;
			}
		},
		async readBase64(path) {
			// The file may have changed since it was resolved: check what was actually opened.
			if (NO_FOLLOW === 0 && (await lstat(path)).isSymbolicLink()) throw new Error("The upload is a link.");
			const handle = await open(path, constants.O_RDONLY | NO_FOLLOW);
			try {
				const info = await handle.stat();
				if (!info.isFile() || info.nlink !== 1) throw new Error("The upload is not a single regular file.");
				if (info.size > ATTACHMENT_MAX_BYTES) throw new Error("The upload is over the size limit.");
				return (await handle.readFile()).toString("base64");
			} finally {
				await handle.close();
			}
		},
	};
}
