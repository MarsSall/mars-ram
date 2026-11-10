import { describe, expect, it } from "vitest";
import { AttachmentHistory, attachmentDisplayName, attachmentPresentation } from "../src/core/attachment-history";
import { uploadAttachments } from "../src/core/attachment-uploads";
import { FakeSsh, FakeUploadsFolder } from "./fakes";
import type { HostConnection } from "../src/core/ports";

import { FakeAttachmentStorage } from "./fake-attachment-storage";
import { ATTACHMENT_MAX_BYTES } from "@workspace/protocol";

const name = "20261023-145428-l2s0pk-photo.png";
describe("local attachment history", () => {
	it("copies images privately with a byte cap and reloads persisted metadata", async () => {
		const storage = new FakeAttachmentStorage();
		const history = new AttachmentHistory(storage, () => 1000);
		await history.remember(name, { uri: "content://photo", displayName: "Mi foto.png", mimeType: "image/png" });
		expect(storage.copiedLimits).toEqual([ATTACHMENT_MAX_BYTES]);
		const reopened = new AttachmentHistory(storage, () => 1000);
		expect(attachmentPresentation(reopened, name).uri).toBe(`file:///private/sent-attachments/${name}`);
		expect(reopened.get(name)?.displayName).toBe("Mi foto.png");
	});
	it.each([1, 7, 30, "never"] as const)("cleans old copies once on opening with retention %s", async retention => {
		const storage = new FakeAttachmentStorage();
		await new AttachmentHistory(storage, () => 1000).remember(name, { uri: "content://photo", displayName: "photo", mimeType: "image/jpeg" });
		const reopened = new AttachmentHistory(storage, () => 1000 + 31 * 86400000);
		await reopened.cleanup(retention);
		expect(storage.copies.has(name)).toBe(retention === "never");
		expect(attachmentPresentation(reopened, name).uri).toBe(retention === "never" ? `file:///private/sent-attachments/${name}` : undefined);
		await reopened.cleanup(1);
		expect(storage.copies.has(name)).toBe(retention === "never");
	});
	it("does not copy documents, and copy/storage failures never reject remembering", async () => {
		const storage = new FakeAttachmentStorage();
		const history = new AttachmentHistory(storage);
		await history.remember("notes.txt", { uri: "content://notes", displayName: "Notes", mimeType: "text/plain" });
		expect(storage.copies.size).toBe(0);
		storage.failCopy = true;
		storage.failSave = true;
		await expect(history.remember(name, { uri: "content://photo", displayName: "Photo", mimeType: "image/jpeg" })).resolves.toBeUndefined();
		expect(history.get(name)?.uri).toBe("content://photo");
	});
	it("ignores corrupt metadata and missing or substituted private copies", async () => {
		const storage = new FakeAttachmentStorage();
		storage.json = "not json";
		expect(new AttachmentHistory(storage).get(name)).toBeUndefined();
		await new AttachmentHistory(storage).remember(name, { uri: "content://photo", displayName: "Photo", mimeType: "image/jpeg" });
		storage.copies.clear();
		expect(attachmentPresentation(new AttachmentHistory(storage), name).uri).toBeUndefined();
	});
	it("sweeps orphaned copies after an interrupted index write and keeps fresh copies", async () => {
		const storage = new FakeAttachmentStorage();
		storage.failSave = true;
		await new AttachmentHistory(storage, () => 1000).remember(name, { uri: "content://photo", displayName: "Photo", mimeType: "image/jpeg" });
		const freshName = "fresh.png";
		storage.copies.set(freshName, { uri: "file:///private/fresh.png", createdAt: 31 * 86400000 });
		await new AttachmentHistory(storage, () => 31 * 86400000).cleanup(7);
		expect([...storage.copies.keys()]).toEqual([freshName]);
	});
	it("keeps the original name of documents across reopening without persisting a URI grant", async () => {
		const storage = new FakeAttachmentStorage();
		await new AttachmentHistory(storage).remember("notes.txt", { uri: "content://private", displayName: "Notas originales.txt", mimeType: "text/plain" });
		expect(storage.json).not.toContain("content://");
		expect(attachmentPresentation(new AttachmentHistory(storage), "notes.txt")).toEqual({ displayName: "Notas originales.txt", image: false, uri: undefined });
	});
	it("does not trust paths or external URIs in persisted metadata", () => {
		const storage = new FakeAttachmentStorage();
		storage.json = JSON.stringify([
			{ name: "../outside", uri: "file:///outside", displayName: "Outside", mimeType: "image/png", createdAt: 1000 },
			{ name, uri: "https://example.invalid/private", displayName: "Photo", mimeType: "image/jpeg", createdAt: 1000 },
		]);
		const history = new AttachmentHistory(storage);
		expect(history.get("../outside")).toBeUndefined();
		expect(attachmentPresentation(history, name).uri).toBeUndefined();
	});
	it("still uploads and records a sendable name when private copying fails", async () => {
		const storage = new FakeAttachmentStorage();
		storage.failCopy = true;
		storage.failSave = true;
		const host = new FakeSsh();
		host.sourceSizes.set("content://photo", 10);
		const result = await uploadAttachments({ host: host as unknown as HostConnection, folder: new FakeUploadsFolder(), history: new AttachmentHistory(storage), connection: async () => ({ ok: true, connectionId: "conn" }), clock: () => 0, random: () => 0.5 }, "1.7",
			[{ id: "p", sourceUri: "content://photo", displayName: "photo.png", mimeType: "image/png", size: 10, kind: "image" }]);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.names).toHaveLength(1);
	});
	it("offers a thumbnail only for a known local image and falls back after an image error", () => {
		const history = new AttachmentHistory();
		history.remember(name, { uri: "content://photo", displayName: "Mi foto.png", mimeType: "image/png" });
		expect(attachmentPresentation(history, name)).toEqual({ displayName: "Mi foto.png", image: true, uri: "content://photo" });
		expect(attachmentPresentation(history, name, true)).toEqual({ displayName: "Mi foto.png", image: true, uri: undefined });
		expect(attachmentPresentation(new AttachmentHistory(), name)).toEqual({ displayName: "photo.png", image: true, uri: undefined });
		history.remember("notes.txt", { uri: "content://notes", displayName: "Notas.txt", mimeType: "text/plain" });
		expect(attachmentPresentation(history, "notes.txt")).toEqual({ displayName: "Notas.txt", image: false, uri: undefined });
	});
	it("removes only the generated prefix for a fallback card", () => {
		expect(attachmentDisplayName(name)).toBe("photo.png");
		expect(attachmentDisplayName("original-name.pdf")).toBe("original-name.pdf");
	});
	it("retains original metadata after uploading, independently of session and draft", async () => {
		const history = new AttachmentHistory();
		const host = new FakeSsh();
		host.sourceSizes.set("content://photo", 10);
		const result = await uploadAttachments({ host: host as unknown as HostConnection, folder: new FakeUploadsFolder(), history, connection: async () => ({ ok: true, connectionId: "conn" }), clock: () => 0, random: () => 0.5 }, "1.7",
			[{ id: "p", sourceUri: "content://photo", displayName: "Mi foto.png", mimeType: "image/png", size: 10, kind: "image" }]);
		if (!result.ok) throw new Error(result.message);
		expect(history.get(result.names[0]!)).toEqual({ uri: "content://photo", displayName: "Mi foto.png", mimeType: "image/png" });
		expect(new AttachmentHistory().get(result.names[0]!)).toBeUndefined();
	});
});
