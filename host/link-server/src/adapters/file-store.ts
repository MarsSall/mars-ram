import { constants } from "node:fs";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, rmdir, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { contentType, ID_PATTERN, MAX_BYTES, requireId, TOKEN_PATTERN, validName } from "../core/links.ts";
import type { Link, LinkStore, Metadata } from "../core/ports.ts";
import { restrict } from "./file-permissions.ts";

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
export async function privateDirectory(path: string): Promise<void> {
	try { await mkdir(path, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
	const info = await lstat(path);
	if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Link storage must be a real directory.");
	restrict(path, true);
}
async function checkedHandle(path: string, max = MAX_BYTES) {
	const before = await lstat(path);
	if (!before.isFile() || before.nlink !== 1) throw new Error("Link copy must be a single regular file.");
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const info = await handle.stat();
		if (!info.isFile() || info.nlink !== 1 || info.ino !== before.ino || info.dev !== before.dev || info.size > max) throw new Error("Invalid or oversized link copy.");
		return { handle, size: info.size };
	} catch (error) { await handle.close(); throw error; }
}
export async function readRegular(path: string, max = MAX_BYTES): Promise<Buffer> {
	const { handle, size } = await checkedHandle(path, max);
	try {
		// Bound reads even if another process grows the file while this handle is open.
		const info = { size };
		const data = Buffer.alloc(info.size + 1);
		let offset = 0;
		while (offset < data.length) {
			const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
			if (bytesRead === 0) break;
			offset += bytesRead;
		}
		if (offset !== info.size) throw new Error("Link copy changed during read.");
		return data.subarray(0, offset);
	} finally { await handle.close(); }
}
export async function writePrivate(path: string, data: string): Promise<void> {
	const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
	try { restrict(path, false); await handle.writeFile(data); } finally { await handle.close(); }
}
async function syncDirectory(path: string): Promise<void> {
	// Windows does not support opening directories for fsync through Node.
	if (process.platform === "win32") return;
	const handle = await open(path, constants.O_RDONLY);
	try { await handle.sync(); } finally { await handle.close(); }
}
function isLink(value: unknown, id: string): value is Link {
	if (!value || typeof value !== "object") return false;
	const l = value as Link;
	return l.id === id && ID_PATTERN.test(l.id) && typeof l.token === "string" && TOKEN_PATTERN.test(l.token)
		&& typeof l.fileName === "string" && validName(l.fileName) && Number.isSafeInteger(l.size) && l.size >= 0 && l.size <= MAX_BYTES
		&& Number.isFinite(Date.parse(l.createdAt)) && Date.parse(l.expiresAt) === Date.parse(l.createdAt) + 86400000
		&& ["image", "download"].includes(l.contentKind) && typeof l.mime === "string";
}
// Boundary hooks make cleanup and publication races deterministic in filesystem tests.
export function createFileStore(root: string, beforeCleanup?: (kind: "id" | "staging", path: string) => Promise<void>, registrationBoundary?: (phase: "temporary" | "ready" | "published", path: string) => Promise<void>): LinkStore & { init(): Promise<void> } {
	async function directory(path: string) {
		const stat = await lstat(path);
		if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Linked storage directory refused.");
		if (resolve(await realpath(path)) !== resolve(path)) throw new Error("Linked storage path refused.");
	}
	async function linkDirectory(id: string) { requireId(id); await directory(root); const dir = join(root, id); await directory(dir); return dir; }
	async function identity(path: string) {
		await directory(path);
		return lstat(path);
	}
	async function unchanged(path: string, original: Awaited<ReturnType<typeof lstat>>) {
		const current = await lstat(path);
		if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== original.dev || current.ino !== original.ino) {
			throw new Error("Storage directory changed during cleanup.");
		}
	}
	async function scan(pruneBefore?: number) {
		const rootInfo = await identity(root);
		const staging = join(root, ".staging");
		const stagingInfo = pruneBefore === undefined ? undefined : await identity(staging);
		async function guard() {
			await unchanged(root, rootInfo);
			if (stagingInfo) await unchanged(staging, stagingInfo);
		}
		async function registration(dir: string, id: string): Promise<Link | undefined> {
			try {
				await directory(dir);
				const value: unknown = JSON.parse((await readRegular(join(dir, "link.json"), 4096)).toString("utf8"));
				return isLink(value, id) ? value : undefined;
			} catch { return undefined; }
		}
		const known = ["content", "link.json", "link.json.pending"];
		const links: Link[] = [];
		let invalid = 0;
		for (const id of await readdir(root)) {
			const temporary = id.startsWith(".tmp-");
			if (!ID_PATTERN.test(id) && !temporary) continue;
			if (temporary && pruneBefore === undefined) continue;
			const dir = join(root, id);
			await guard();
			const value = temporary ? undefined : await registration(dir, id);
			if (value) { links.push(value); continue; }
			if (pruneBefore === undefined) { invalid++; continue; }
			await beforeCleanup?.("id", dir);
			await guard(); // Never swallow an ancestor identity failure as an invalid entry.
			const published = temporary ? undefined : await registration(dir, id);
			if (published) { links.push(published); continue; }
			let info;
			try { info = await lstat(dir); } catch (error) { if (missing(error)) continue; throw error; }
			if (!info.isDirectory() || info.isSymbolicLink()) { invalid++; continue; }
			let newest = Math.max(info.mtimeMs, info.ctimeMs);
			for (const name of known) {
				try {
					const file = await lstat(join(dir, name));
					newest = Math.max(newest, file.mtimeMs, file.ctimeMs);
				} catch (error) { if (!missing(error)) throw error; }
			}
			if (newest >= pruneBefore) { invalid++; continue; }
			for (const name of known) {
				await guard(); await unchanged(dir, info);
				try { await unlink(join(dir, name)); }
				catch (error) { if (!missing(error) && !["EISDIR", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
			}
			await guard(); await unchanged(dir, info);
			try { await rmdir(dir); }
			catch (error) {
				if (["ENOTEMPTY", "EEXIST", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) invalid++;
				else throw error;
			}
		}
		if (pruneBefore !== undefined) {
			await guard();
			for (const name of await readdir(staging)) {
				const path = join(staging, name);
				await guard();
				let info;
				try { info = await lstat(path); } catch (error) { if (missing(error)) continue; throw error; }
				if (!info.isFile() || info.nlink !== 1 || info.mtimeMs >= pruneBefore) continue;
				await beforeCleanup?.("staging", path);
				await guard();
				let current;
				try { current = await lstat(path); } catch (error) { if (missing(error)) continue; throw error; }
				if (!current.isFile() || current.nlink !== 1 || current.dev !== info.dev || current.ino !== info.ino
					|| current.size !== info.size || current.mtimeMs !== info.mtimeMs || current.ctimeMs !== info.ctimeMs) continue;
				await guard();
				await unlink(path);
			}
		}
		return { links, invalid };
	}
	return {
		async init() {
			await privateDirectory(dirname(root)); await privateDirectory(root); await privateDirectory(join(root, ".staging"));
			await directory(root); await directory(join(root, ".staging"));
		},
		async all(pruneBefore) { return (await scan(pruneBefore)).links; },
		async invalidCount() { return (await scan()).invalid; },
		async create(name: string, metadata: Metadata) {
			if (!validName(name)) throw new Error("Invalid staged name."); requireId(metadata.id);
			const rootInfo = await identity(root);
			const staging = join(root, ".staging");
			const stagingInfo = await identity(staging);
			const staged = join(staging, name);
			const stagedInfo = await lstat(staged);
			const data = await readRegular(staged);
			await unchanged(root, rootInfo);
			const dir = await mkdtemp(join(root, ".tmp-")); restrict(dir, true);
			// Leave interrupted private work for bounded, non-recursive grace-period cleanup.
			await registrationBoundary?.("temporary", dir);
			const handle = await open(join(dir, "content"), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
			try { restrict(join(dir, "content"), false); await handle.writeFile(data); await handle.sync(); }
			finally { await handle.close(); }
			let link: Link = { ...metadata, fileName: name, size: data.length, ...contentType(data) };
			for (;;) {
				// Only the private directory is mutable. A published id is never rewritten.
				const metadataHandle = await open(join(dir, "link.json"), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o600);
				try { restrict(join(dir, "link.json"), false); await metadataHandle.writeFile(JSON.stringify(link)); await metadataHandle.sync(); }
				finally { await metadataHandle.close(); }
				await syncDirectory(dir);
				await registrationBoundary?.("ready", dir);
				await unchanged(root, rootInfo);
				// POSIX rename can replace an empty directory. Avoid pre-existing ids;
				// concurrent registrations publish nonempty directories, so rename itself
				// rejects their collisions atomically (EEXIST/ENOTEMPTY).
				try {
					await lstat(join(root, link.id));
					link = { ...link, id: randomBytes(9).toString("base64url") };
					continue;
				} catch (error) { if (!missing(error)) throw error; }
				try { await rename(dir, join(root, link.id)); break; }
				catch (error) {
					if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
					link = { ...link, id: randomBytes(9).toString("base64url") };
				}
			}
			await syncDirectory(root);
			await registrationBoundary?.("published", join(root, link.id));
			await unchanged(root, rootInfo); await unchanged(staging, stagingInfo);
			// Do not remove a replacement upload, or fail an already-published registration
			// if cleanup consumed the old staging file while the checked copy was built.
			try {
				const current = await lstat(staged);
				if (current.isFile() && current.nlink === 1 && current.dev === stagedInfo.dev && current.ino === stagedInfo.ino
					&& current.size === stagedInfo.size && current.mtimeMs === stagedInfo.mtimeMs && current.ctimeMs === stagedInfo.ctimeMs) await unlink(staged);
			} catch (error) { if (!missing(error)) throw error; }
			return link;
		},
		async delete(id) {
			requireId(id);
			try { const dir = await linkDirectory(id); await rm(dir, { recursive: true, force: true }); }
			catch (e) { if (!missing(e)) throw e; }
		},
		async open(link) {
			const dir = await linkDirectory(link.id);
			const { handle, size } = await checkedHandle(join(dir, "content"));
			try {
				if (size !== link.size) throw new Error("Link copy changed size.");
				const prefix = Buffer.alloc(Math.min(12, size));
				await handle.read(prefix, 0, prefix.length, 0);
				// Fixed end bounds growth; the same verified handle supplies both magic and body.
				const stream = size ? handle.createReadStream({ start: 0, end: size - 1, highWaterMark: 64 * 1024, autoClose: true }) : Readable.from([]);
				if (!size) await handle.close();
				return { size, prefix, stream, close: async () => { stream.destroy(); await handle.close(); } };
			} catch (error) { await handle.close(); throw error; }
		},
		async read(link) {
			const dir = await linkDirectory(link.id);
			const bytes = await readRegular(join(dir, "content"));
			if (bytes.length !== link.size) throw new Error("Link copy changed size.");
			return bytes;
		},
	};
}
