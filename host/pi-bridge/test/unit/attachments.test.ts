import { beforeEach, describe, expect, it } from "vitest";
import { ATTACHMENT_MAX_BYTES, PROTOCOL_VERSION, TERMINAL_TEXT_MAX_LENGTH } from "@workspace/protocol";
import { BridgeSession } from "../../src/core/bridge-session.ts";
import type { OutgoingContent, PiSessionPort } from "../../src/core/ports.ts";
import { FakeTerminal } from "../fakes/terminal.ts";
import { FakeUploads } from "../fakes/uploads.ts";

class FakePi implements PiSessionPort {
	idle = true;
	acceptsImages = true;
	blocked = false;
	sent: { content: OutgoingContent; steer: boolean }[] = [];
	sessionId = () => "sess";
	isIdle = () => this.idle;
	hasPendingMessages = () => false;
	model = () => ({ id: "m", provider: "p", acceptsImages: this.acceptsImages });
	imagesBlocked = () => this.blocked;
	history = () => [];
	send(content: OutgoingContent, steer: boolean) {
		this.sent.push({ content, steer });
	}
	abort() {}
}

const envelope = { protocolVersion: PROTOCOL_VERSION, bridgeInstanceId: "inst", sessionId: "sess" };
const dir = "/home/u/.mars-ram/uploads";
let pi: FakePi;
let uploads: FakeUploads;
let terminal: FakeTerminal;
let bridge: BridgeSession;

beforeEach(() => {
	pi = new FakePi();
	uploads = new FakeUploads();
	terminal = new FakeTerminal();
	bridge = new BridgeSession({ pi, uploads, terminal, instanceId: "inst", capacity: 10, clock: () => 1 });
	uploads.add("shot.png", { mimeType: "image/png", data: "PNGDATA" });
	uploads.add("app.log");
});

describe("sendMessage with attachments", () => {
	it("attaches images natively and appends every file's path to the text", async () => {
		const result = await bridge.sendMessage({ text: "look at these", attachments: ["shot.png", "app.log"] });
		expect(result).toEqual({ ok: true, value: { ...envelope, status: "submitted", attachments: { files: 2, imagesAttached: 1, imagesWithheld: "none" } } });
		expect(pi.sent).toEqual([
			{
				content: { text: `look at these\n\nAttached files:\n${dir}/shot.png\n${dir}/app.log`, images: [{ data: "PNGDATA", mimeType: "image/png" }] },
				steer: false,
			},
		]);
		expect(bridge.eventsSince(0).events).toEqual([{ seq: 1, at: 1, type: "message_submitted", queued: false, images: 1, attachments: 2 }]);
	});

	it("sends attachments without text", async () => {
		await bridge.sendMessage({ attachments: ["app.log"] });
		expect(pi.sent[0]?.content).toEqual({ text: `Attached files:\n${dir}/app.log`, images: [] });
	});

	it("queues as steering while the agent is busy", async () => {
		pi.idle = false;
		const result = await bridge.sendMessage({ text: "also", attachments: ["app.log"] });
		expect(result).toMatchObject({ ok: true, value: { status: "queued" } });
		expect(pi.sent[0]?.steer).toBe(true);
	});

	it("sends images only as paths when the model does not accept them", async () => {
		pi.acceptsImages = false;
		const result = await bridge.sendMessage({ text: "see", attachments: ["shot.png"] });
		expect(result).toMatchObject({ ok: true, value: { attachments: { files: 1, imagesAttached: 0, imagesWithheld: "model" } } });
		expect(pi.sent[0]?.content).toEqual({ text: `see\n\nAttached files:\n${dir}/shot.png`, images: [] });
	});

	it("sends images only as paths when Pi's settings block images, even if the model accepts them", async () => {
		pi.blocked = true;
		const result = await bridge.sendMessage({ attachments: ["shot.png"] });
		expect(result).toMatchObject({ ok: true, value: { attachments: { imagesAttached: 0, imagesWithheld: "blocked" } } });
		expect(pi.sent[0]?.content.images).toEqual([]);
	});

	it("reports nothing withheld when no attachment is an image", async () => {
		pi.acceptsImages = false;
		const result = await bridge.sendMessage({ attachments: ["app.log"] });
		expect(result).toMatchObject({ ok: true, value: { attachments: { files: 1, imagesAttached: 0, imagesWithheld: "none" } } });
	});

	it("keeps images sent inline as before", async () => {
		await bridge.sendMessage({ text: "x", images: [{ data: "INLINE", mimeType: "image/jpeg" }], attachments: ["shot.png"] });
		expect(pi.sent[0]?.content.images).toEqual([
			{ data: "INLINE", mimeType: "image/jpeg" },
			{ data: "PNGDATA", mimeType: "image/png" },
		]);
	});

	it("sends nothing when an attachment is missing, naming only the upload", async () => {
		const result = await bridge.sendMessage({ text: "x", attachments: ["app.log", "gone.txt"] });
		expect(result).toMatchObject({ ok: false, error: { error: { code: "not_found", message: "An attachment is not on the computer: gone.txt. Attach it again." } } });
		expect(pi.sent).toEqual([]);
		expect(bridge.eventsSince(0).events).toEqual([]);
	});

	it("sends nothing when an attachment is over the size limit", async () => {
		uploads.add("big.zip", { size: ATTACHMENT_MAX_BYTES + 1 });
		const result = await bridge.sendMessage({ attachments: ["big.zip"] });
		expect(result).toMatchObject({ ok: false, error: { error: { code: "too_large", message: "big.zip is larger than 25 MB." } } });
		expect(pi.sent).toEqual([]);
		expect(bridge.eventsSince(0).events).toEqual([]);
	});

	it("sends nothing when the images together are over the inline limit, before reading any", async () => {
		uploads.add("a.png", { mimeType: "image/png", size: 25 * 1024 * 1024 });
		uploads.add("b.png", { mimeType: "image/png", size: 25 * 1024 * 1024 });
		uploads.add("c.png", { mimeType: "image/png", size: 1 });
		uploads.readFails = true;
		const result = await bridge.sendMessage({ attachments: ["a.png", "b.png", "c.png"] });
		expect(result).toMatchObject({ ok: false, error: { error: { code: "too_large", message: "The images in one message add up to more than 50 MB. Send fewer images at a time." } } });
		expect(pi.sent).toEqual([]);
		expect(bridge.eventsSince(0).events).toEqual([]);
	});

	it("attaches images that add up to exactly the inline limit", async () => {
		uploads.add("a.png", { mimeType: "image/png", size: 25 * 1024 * 1024 });
		uploads.add("b.png", { mimeType: "image/png", size: 25 * 1024 * 1024 });
		const result = await bridge.sendMessage({ attachments: ["a.png", "b.png"] });
		expect(result).toMatchObject({ ok: true, value: { attachments: { imagesAttached: 2 } } });
	});

	it("does not count images withheld by the model against the inline limit", async () => {
		pi.acceptsImages = false;
		uploads.add("a.png", { mimeType: "image/png", size: 25 * 1024 * 1024 });
		uploads.add("b.png", { mimeType: "image/png", size: 25 * 1024 * 1024 });
		uploads.add("c.png", { mimeType: "image/png", size: 1 });
		const result = await bridge.sendMessage({ attachments: ["a.png", "b.png", "c.png"] });
		expect(result).toMatchObject({ ok: true, value: { attachments: { imagesAttached: 0, imagesWithheld: "model" } } });
	});

	it("sends nothing and hides the path when an image cannot be read", async () => {
		uploads.readFails = true;
		const result = await bridge.sendMessage({ attachments: ["shot.png"] });
		expect(result).toMatchObject({ ok: false, error: { error: { code: "internal", message: "Could not read shot.png on the computer." } } });
		expect(JSON.stringify(result)).not.toContain(dir);
		expect(pi.sent).toEqual([]);
		expect(bridge.eventsSince(0).events).toEqual([]);
	});

	it("rejects an attachment name outside the uploads folder before resolving anything", async () => {
		const result = await bridge.sendMessage({ attachments: ["../.ssh/id_ed25519"] });
		expect(result).toMatchObject({ ok: false, error: { error: { code: "bad_request" } } });
		expect(pi.sent).toEqual([]);
	});

	it("still rejects a message with no text, image, or attachment", async () => {
		const result = await bridge.sendMessage({ text: "  " });
		expect(result).toMatchObject({ ok: false, error: { error: { code: "bad_request", message: "A message needs text, an image, or an attachment." } } });
	});

	it("leaves the 1.1 response unchanged when there are no attachments", async () => {
		expect(await bridge.sendMessage({ text: "hi" })).toEqual({ ok: true, value: { ...envelope, status: "submitted" } });
		expect(bridge.eventsSince(0).events).toEqual([{ seq: 1, at: 1, type: "message_submitted", queued: false, images: 0 }]);
	});
});

describe("terminal input with attachments", () => {
	it("types the text with the attachments' paths as one paste", async () => {
		const result = await bridge.terminalInput({ kind: "text", text: "check this", enter: true, attachments: ["shot.png", "app.log"] });
		expect(result).toEqual({ ok: true, value: { ...envelope, status: "sent" } });
		expect(terminal.calls).toEqual([["text", `check this\n\nAttached files:\n${dir}/shot.png\n${dir}/app.log`, true]]);
	});

	it("types only the paths when the text is empty", async () => {
		await bridge.terminalInput({ kind: "text", text: "", enter: false, attachments: ["app.log"] });
		expect(terminal.calls).toEqual([["text", `Attached files:\n${dir}/app.log`, false]]);
	});

	it("types nothing when an attachment is missing", async () => {
		const result = await bridge.terminalInput({ kind: "text", text: "x", enter: true, attachments: ["gone.txt"] });
		expect(result).toMatchObject({ ok: false, error: { error: { code: "not_found" } } });
		expect(terminal.calls).toEqual([]);
	});

	it("types nothing when the text with paths exceeds the terminal limit", async () => {
		const result = await bridge.terminalInput({ kind: "text", text: "x".repeat(TERMINAL_TEXT_MAX_LENGTH), enter: true, attachments: ["app.log"] });
		expect(result).toMatchObject({ ok: false, error: { error: { code: "bad_request", message: "The text and the attachment paths are too long for one terminal input." } } });
		expect(terminal.calls).toEqual([]);
	});
});
