import { describe, expect, it } from "vitest";
import {
	ATTACHMENT_MAX_BYTES,
	decodeResponse,
	EVENT_SCHEMAS,
	MAX_ATTACHMENTS,
	PROTOCOL_VERSION,
	SendMessageRequest,
	SendMessageResponse,
	supportsAttachments,
	TerminalInputRequest,
	UPLOADS_DIRECTORY,
	UploadName,
} from "../src/index.ts";

const envelope = { protocolVersion: PROTOCOL_VERSION, bridgeInstanceId: "inst-1", sessionId: "sess-1" };
const check = (schema: Parameters<typeof decodeResponse>[0], data: unknown) => decodeResponse(schema, data).ok;
const name = "20261023-101500-a1b2c3-screenshot.png";

describe("protocol version", () => {
	it("is 1.5, adding optional pane identity without changing older routes", () => {
		expect(PROTOCOL_VERSION).toBe("1.5");
	});

	it("supports attachments from 1.2 on, so the app never sends them to a bridge that would drop them", () => {
		expect(supportsAttachments("1.0")).toBe(false);
		expect(supportsAttachments("1.1")).toBe(false);
		expect(supportsAttachments("1.2")).toBe(true);
		expect(supportsAttachments("1.10")).toBe(true);
		expect(supportsAttachments("2.0")).toBe(false);
		expect(supportsAttachments("bad")).toBe(false);
	});
});

describe("uploads", () => {
	it("live in the app folder of the user's home, with a 25 MB limit per file", () => {
		expect(UPLOADS_DIRECTORY).toBe(".mars-ram/uploads");
		expect(ATTACHMENT_MAX_BYTES).toBe(25 * 1024 * 1024);
	});
});

describe("UploadName", () => {
	it.each([name, "a", "report.final.pdf", "log_2026-10-23.txt"])("accepts %s", (value) => {
		expect(check(UploadName, value)).toBe(true);
	});

	it.each([
		["an empty name", ""],
		["a parent reference", ".."],
		["a hidden name", ".bashrc"],
		["a slash", "a/b.png"],
		["a backslash", "a\\b.png"],
		["a drive", "C:x.png"],
		["a space", "my file.png"],
		["a trailing dot", "name."],
		["an unfinished upload", `${name}.part`],
		["an unfinished upload in capitals, the same file on Windows", `${name}.PART`],
		["a Windows device name", "CON"],
		["a Windows device name with an extension", "nul.png"],
		["a numbered Windows device", "COM1.txt"],
		["a name over 200 characters", "x".repeat(201)],
	])("rejects %s", (_label, value) => {
		expect(check(UploadName, value)).toBe(false);
	});

	it("accepts a name of exactly 200 characters", () => {
		expect(check(UploadName, "x".repeat(200))).toBe(true);
	});
});

describe("SendMessageRequest attachments", () => {
	it("accepts text with attachments, attachments alone, and the 1.1 shapes", () => {
		expect(check(SendMessageRequest, { text: "look", attachments: [name] })).toBe(true);
		expect(check(SendMessageRequest, { attachments: [name] })).toBe(true);
		expect(check(SendMessageRequest, { text: "hi" })).toBe(true);
	});

	it(`accepts at most ${MAX_ATTACHMENTS} attachments`, () => {
		const names = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => `f${i}.txt`);
		expect(check(SendMessageRequest, { attachments: names.slice(0, MAX_ATTACHMENTS) })).toBe(true);
		expect(check(SendMessageRequest, { attachments: names })).toBe(false);
	});

	it("rejects an attachment name that could leave the uploads folder", () => {
		expect(check(SendMessageRequest, { attachments: ["../secret"] })).toBe(false);
	});
});

describe("SendMessageResponse attachments", () => {
	it("accepts the 1.1 response without attachment details", () => {
		expect(check(SendMessageResponse, { ...envelope, status: "submitted" })).toBe(true);
	});

	it.each(["none", "model", "blocked"])("accepts images withheld as %s", (withheld) => {
		expect(check(SendMessageResponse, { ...envelope, status: "queued", attachments: { files: 2, imagesAttached: 1, imagesWithheld: withheld } })).toBe(true);
	});

	it("rejects an unknown reason for withholding images", () => {
		expect(check(SendMessageResponse, { ...envelope, status: "submitted", attachments: { files: 1, imagesAttached: 0, imagesWithheld: "other" } })).toBe(false);
	});
});

describe("message_submitted attachments", () => {
	it("accepts the event with and without the attachment count", () => {
		const base = { seq: 1, at: 1, type: "message_submitted", queued: false, images: 0 };
		expect(check(EVENT_SCHEMAS.message_submitted, base)).toBe(true);
		expect(check(EVENT_SCHEMAS.message_submitted, { ...base, attachments: 2 })).toBe(true);
	});
});

describe("TerminalInputRequest attachments", () => {
	it("accepts text with attachments, and attachments with empty text", () => {
		expect(check(TerminalInputRequest, { kind: "text", text: "see", enter: true, attachments: [name] })).toBe(true);
		expect(check(TerminalInputRequest, { kind: "text", text: "", enter: true, attachments: [name] })).toBe(true);
	});

	it("still rejects empty text without attachments, and an empty attachment list", () => {
		expect(check(TerminalInputRequest, { kind: "text", text: "", enter: true })).toBe(false);
		expect(check(TerminalInputRequest, { kind: "text", text: "", enter: true, attachments: [] })).toBe(false);
	});

	it("rejects an attachment name that could leave the uploads folder", () => {
		expect(check(TerminalInputRequest, { kind: "text", text: "x", enter: true, attachments: ["..\\secret"] })).toBe(false);
	});
});
