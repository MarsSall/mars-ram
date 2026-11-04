import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUploadStore } from "../../src/adapters/upload-store.ts";

let root: string;
let uploads: string;

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "upload-store-test-")));
	uploads = join(root, "uploads");
	mkdirSync(uploads);
	writeFileSync(join(uploads, "shot.PNG"), Buffer.from([1, 2, 3]));
	writeFileSync(join(uploads, "notes.txt"), "hello");
	writeFileSync(join(root, "secret.txt"), "private");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("upload store", () => {
	it("resolves an upload to its absolute path, size, and image type", async () => {
		const store = createUploadStore(uploads);
		expect(await store.resolve("shot.PNG")).toEqual({ path: join(uploads, "shot.PNG"), size: 3, mimeType: "image/png" });
		expect(await store.resolve("notes.txt")).toEqual({ path: join(uploads, "notes.txt"), size: 5, mimeType: null });
	});

	it.each([
		["jpg", "image/jpeg"],
		["jpeg", "image/jpeg"],
		["gif", "image/gif"],
		["webp", "image/webp"],
	])("recognizes .%s as %s", async (extension, mimeType) => {
		writeFileSync(join(uploads, `a.${extension}`), "x");
		expect(await createUploadStore(uploads).resolve(`a.${extension}`)).toMatchObject({ mimeType });
	});

	it("reads an upload as base64", async () => {
		expect(await createUploadStore(uploads).readBase64(join(uploads, "shot.PNG"))).toBe("AQID");
	});

	it.each([
		["a missing file", "missing.txt"],
		["a parent reference", "../secret.txt"],
		["a hidden name", ".secret"],
		["an unfinished upload", "notes.txt.part"],
	])("resolves %s to nothing", async (_label, name) => {
		writeFileSync(join(uploads, "notes.txt.part"), "half");
		expect(await createUploadStore(uploads).resolve(name)).toBeNull();
	});

	it("resolves a folder to nothing", async () => {
		mkdirSync(join(uploads, "folder"));
		expect(await createUploadStore(uploads).resolve("folder")).toBeNull();
	});

	it.skipIf(process.platform === "win32")("resolves a link pointing outside the folder to nothing", async () => {
		symlinkSync(join(root, "secret.txt"), join(uploads, "link.txt"));
		expect(await createUploadStore(uploads).resolve("link.txt")).toBeNull();
	});

	it.skipIf(process.platform === "win32")("refuses to read a file swapped for a link after it was resolved", async () => {
		const store = createUploadStore(uploads);
		const resolved = await store.resolve("notes.txt");
		rmSync(join(uploads, "notes.txt"));
		symlinkSync(join(root, "secret.txt"), join(uploads, "notes.txt"));
		await expect(store.readBase64(resolved!.path)).rejects.toThrow();
	});

	it("resolves a file with a second name elsewhere to nothing, and refuses to read it", async () => {
		linkSync(join(root, "secret.txt"), join(uploads, "hard.txt"));
		const store = createUploadStore(uploads);
		expect(await store.resolve("hard.txt")).toBeNull();
		await expect(store.readBase64(join(uploads, "hard.txt"))).rejects.toThrow();
	});

	it.skipIf(process.platform === "win32")("resolves nothing when the uploads folder itself is a link", async () => {
		const elsewhere = join(root, "elsewhere");
		mkdirSync(elsewhere);
		writeFileSync(join(elsewhere, "notes.txt"), "x");
		symlinkSync(elsewhere, join(root, "linked"));
		expect(await createUploadStore(join(root, "linked")).resolve("notes.txt")).toBeNull();
	});

	it("resolves nothing when the uploads folder does not exist", async () => {
		expect(await createUploadStore(join(root, "none")).resolve("notes.txt")).toBeNull();
	});
});
