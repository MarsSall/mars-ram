// Removes attachment folders without ever following a link or recursing: only regular files directly inside
// (including unfinished .part uploads), then the folder once it is empty. A linked folder loses only the link.
import { lstatSync, readdirSync, rmdirSync, unlinkSync, type Stats } from "node:fs";
import { dirname, join } from "node:path";
import { checkUploadsFolder, currentHost, uploadsFolderPath, type UploadsFolderHost } from "@workspace/protocol/uploads-folder";

function entry(path: string): Stats | undefined {
	try { return lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

/** "removed" also covers a link removed in place of the folder; "kept" leaves what mars-ram does not own. */
function emptyFolder(dir: string): "absent" | "removed" | "kept" {
	const folder = entry(dir);
	if (!folder) return "absent";
	if (folder.isSymbolicLink()) { unlinkSync(dir); return "removed"; }
	if (!folder.isDirectory()) return "kept";
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (!entry(path)?.isFile()) continue;
		// The folder must still be the one inspected: a swapped-in link would redirect the unlink.
		const now = entry(dir);
		if (!now || now.isSymbolicLink() || now.dev !== folder.dev || now.ino !== folder.ino) return "kept";
		unlinkSync(path);
	}
	try { rmdirSync(dir); return "removed"; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOTEMPTY" || (error as NodeJS.ErrnoException).code === "EEXIST") return "kept"; throw error; }
}

/** Install: no coexistence with the folder apps before protocol 1.7 used. Returns the line to print, if any. */
export function removeLegacyUploads(home: string, spanish: boolean, folder: string = uploadsFolderPath()): string | undefined {
	const root = entry(join(home, ".mars-ram"));
	if (!root?.isDirectory()) return undefined;
	const state = emptyFolder(join(home, ".mars-ram", "uploads"));
	if (state === "absent") return undefined;
	if (state === "removed") return spanish
		? `Se eliminó la carpeta anterior de adjuntos ~/.mars-ram/uploads (ahora los adjuntos están en ${folder}).`
		: `Removed old attachments folder ~/.mars-ram/uploads (attachments now live in ${folder}).`;
	return spanish
		? `Se conservó ~/.mars-ram/uploads: tiene carpetas o enlaces que mars-ram no elimina; borrala vos (ahora los adjuntos están en ${folder}).`
		: `Kept ~/.mars-ram/uploads: it holds folders or links that mars-ram does not remove; delete it yourself (attachments now live in ${folder}).`;
}

/** Uninstall: the private temp folder, only when it passes the same policy the CLI and bridge use. */
export async function removeUploadsFolder(spanish: boolean, host: UploadsFolderHost = currentHost()): Promise<string | undefined> {
	const state = await checkUploadsFolder(host);
	if (!state.ok && state.error === "missing") return undefined;
	if (!state.ok) return spanish ? `Se conservó la carpeta de adjuntos ${state.path}: ${state.message}` : `Kept attachments folder ${state.path}: ${state.message}`;
	if (emptyFolder(state.path) !== "removed") return spanish
		? `Se conservó la carpeta de adjuntos ${state.path}: tiene carpetas o enlaces que mars-ram no elimina.`
		: `Kept attachments folder ${state.path}: it holds folders or links that mars-ram does not remove.`;
	// The per-user parent was created for this folder only; leave it if anything else is inside.
	try { rmdirSync(dirname(state.path)); } catch { /* Not empty or already gone. */ }
	return spanish ? `Se eliminó la carpeta de adjuntos ${state.path}.` : `Removed attachments folder ${state.path}.`;
}
