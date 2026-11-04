import { describe, expect, it, vi } from "vitest";
import { ATTACHMENT_MAX_BYTES, decodeResponse, UploadName } from "@workspace/protocol";
import { addAttachment, removeAttachment, uploadName, type Attachment } from "../src/core/attachment-draft";

const file = (extra: Partial<Attachment> = {}) => ({ id: "a", sourceUri: "content://a", displayName: "photo.png", size: null, mimeType: "image/png", kind: "image" as const, ...extra });

describe("attachment draft", () => {
	it("uses the phone's local calendar, including a different day from UTC", () => {
		const parts = { getFullYear: 2025, getMonth: 11, getDate: 31, getHours: 21, getMinutes: 4, getSeconds: 5 } as const;
		const spies = Object.entries(parts).map(([method, value]) => vi.spyOn(Date.prototype, method as keyof typeof parts).mockReturnValue(value));
		try {
			const name = uploadName("photo.png", () => Date.UTC(2026, 0, 1, 0, 4, 5), () => 0.5);
			expect(name).toMatch(/^20251231-210405-/);
			expect(decodeResponse(UploadName, name).ok).toBe(true);
		} finally { spies.forEach(spy => spy.mockRestore()); }
	});
	it("accepts exactly 25 MB, rejects one byte more with the file name, and never mutates the draft", () => {
		const draft: Attachment[] = [];
		const added = addAttachment(draft, file({ size: ATTACHMENT_MAX_BYTES }));
		expect(added.ok).toBe(true);
		expect(draft).toEqual([]);
		expect(addAttachment(draft, file({ size: ATTACHMENT_MAX_BYTES + 1 }))).toEqual({ ok: false, message: expect.stringMatching(/photo.png.*25 MB/) });
	});
	it("classifies only supported image MIME types, accepts unknown sizes, caps at ten, and removes by id", () => {
		let draft: readonly Attachment[] = [];
		for (let i = 0; i < 10; i++) {
			const result = addAttachment(draft, file({ id: String(i), mimeType: i === 0 ? "image/svg+xml" : "image/webp" }));
			if (!result.ok) throw new Error(result.message);
			draft = result.items;
		}
		expect(draft[0]?.kind).toBe("file");
		expect(draft[1]?.kind).toBe("image");
		expect(addAttachment(draft, file())).toEqual({ ok: false, message: expect.stringContaining("10") });
		expect(removeAttachment(draft, "0")).toHaveLength(9);
		expect(draft).toHaveLength(10);
	});
	it.each(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"])("classifies %s", mimeType => {
		const result = addAttachment([], file({ mimeType }));
		expect(result).toMatchObject({ ok: true, items: [{ kind: mimeType === "application/pdf" ? "file" : "image" }] });
	});
	it.each([
		"", "你好", "x".repeat(400) + ".jpeg", ".part", "file.PART", "CON.txt", "a / : b.png", "trailing.",
		"x".repeat(176) + "_" + "y".repeat(30), "x".repeat(172) + ".part" + "z".repeat(30),
	])("generates protocol-safe names for %s", name => {
		const generated = uploadName(name, () => new Date(2026, 0, 2, 3, 4, 5).getTime(), () => 0.5);
		expect(generated).toMatch(/^20260102-030405-[a-z0-9]{6}-/);
		expect(decodeResponse(UploadName, generated).ok).toBe(true);
		expect(generated.length).toBeLessThanOrEqual(200);
		if (name.endsWith(".jpeg")) expect(generated).toMatch(/\.jpeg$/);
	});
});
