// Host-only path policy for attachments, shared by the CLI (`mars-ram uploads-dir`) and the Pi bridge.
// POSIX: /tmp/mars-ram-<uid>/uploads (TMPDIR is ignored so the CLI and the bridge agree). Each component is created 0700 when missing, then must be a real
// folder (not a link) owned by this user with no group or other permissions. An existing component is never
// chmod-ed or chown-ed into place: someone else may control it, so it is refused instead. A sticky /tmp keeps
// other users from replacing a verified component.
// Windows: %TEMP%\mars-ram\uploads, refusing symbolic links and junctions (Node's lstat reports junctions and symbolic links
// as links). The user's temp folder already grants only that user, SYSTEM and Administrators, and new
// folders inherit that access list, so no mode or owner check applies there.
import { lstat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { posix, win32 } from "node:path";
import { APP_ID } from "./index.ts";

export type FolderEntry = { isDirectory(): boolean; isSymbolicLink(): boolean; uid: number; mode: number };

export interface UploadsFolderFs {
	/** Without following a link; undefined when nothing is there. */
	lstat(path: string): Promise<FolderEntry | undefined>;
	/** Creates one folder; fails with EEXIST when something is already there. */
	mkdir(path: string, mode: number): Promise<void>;
}

export type UploadsFolderHost = { platform: NodeJS.Platform; tmpdir: string; uid?: number };

export type UnsafeReason = "link" | "not_folder" | "owner" | "permissions";

export type UploadsFolderState =
	| { ok: true; path: string }
	/** Only from `checkUploadsFolder`, which never creates. */
	| { ok: false; error: "missing"; path: string }
	| { ok: false; error: "unsafe_folder"; path: string; component: string; reason: UnsafeReason; message: string }
	| { ok: false; error: "unavailable"; path: string; message: string };

const nodeFs: UploadsFolderFs = {
	async lstat(path) {
		try { return await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
	},
	async mkdir(path, mode) { await mkdir(path, { mode }); },
};

export function currentHost(): UploadsFolderHost {
	const uid = process.getuid?.();
	// POSIX ignores TMPDIR: the CLI (SSH session) and the bridge (inside Pi) must agree on one folder.
	return { platform: process.platform, tmpdir: process.platform === "win32" ? tmpdir() : "/tmp", ...(uid === undefined ? {} : { uid }) };
}

function components(host: UploadsFolderHost): string[] {
	const path = host.platform === "win32" ? win32 : posix;
	const parent = path.join(host.tmpdir, host.platform === "win32" ? APP_ID : `${APP_ID}-${host.uid}`);
	return [parent, path.join(parent, "uploads")];
}

/** The absolute folder for attachments; prepare or check it before use. */
export function uploadsFolderPath(host: UploadsFolderHost = currentHost()): string {
	return components(host)[1]!;
}

const reasons: Record<UnsafeReason, string> = {
	link: "is a link",
	not_folder: "is not a folder",
	owner: "belongs to another user",
	permissions: "can be opened by other users",
};

function unsafe(host: UploadsFolderHost, entry: FolderEntry): UnsafeReason | undefined {
	if (entry.isSymbolicLink()) return "link";
	if (!entry.isDirectory()) return "not_folder";
	if (host.platform === "win32") return undefined;
	if (entry.uid !== host.uid) return "owner";
	if ((entry.mode & 0o077) !== 0) return "permissions";
	return undefined;
}

async function inspect(host: UploadsFolderHost, fs: UploadsFolderFs, create: boolean): Promise<UploadsFolderState> {
	const path = uploadsFolderPath(host);
	const absolute = (host.platform === "win32" ? win32 : posix).isAbsolute(host.tmpdir);
	if (!absolute || (host.platform !== "win32" && host.uid === undefined)) {
		return { ok: false, error: "unavailable", path, message: `Could not prepare the attachments folder ${path} (no user temp folder).` };
	}
	try {
		for (const component of components(host)) {
			let entry = await fs.lstat(component);
			if (!entry) {
				if (!create) return { ok: false, error: "missing", path };
				// Someone may create it first: whatever is there afterwards is checked, never trusted.
				try { await fs.mkdir(component, 0o700); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
				entry = await fs.lstat(component);
				if (!entry) throw Object.assign(new Error("Folder vanished."), { code: "ENOENT" });
			}
			const reason = unsafe(host, entry);
			if (reason) return { ok: false, error: "unsafe_folder", path, component, reason, message: `The attachments folder ${component} ${reasons[reason]}. Remove it and try again.` };
		}
		return { ok: true, path };
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code ?? "error";
		return { ok: false, error: "unavailable", path, message: `Could not prepare the attachments folder ${path} (${code}).` };
	}
}

/** Creates missing components privately, then verifies both. */
export function prepareUploadsFolder(host: UploadsFolderHost = currentHost(), fs: UploadsFolderFs = nodeFs): Promise<UploadsFolderState> {
	return inspect(host, fs, true);
}

/** Verifies without creating anything, for the bridge and diagnostics. */
export function checkUploadsFolder(host: UploadsFolderHost = currentHost(), fs: UploadsFolderFs = nodeFs): Promise<UploadsFolderState> {
	return inspect(host, fs, false);
}
