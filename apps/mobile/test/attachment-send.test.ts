import { describe, expect, it, vi } from "vitest";
import { ATTACHMENT_MAX_BYTES, decodeResponse, UploadName } from "@workspace/protocol";
import { LiveSession } from "../src/core/live-session";
import type { BridgeHttp } from "../src/core/bridge-client";
import type { HostConnection } from "../src/core/ports";
import type { Attachment } from "../src/core/attachment-draft";
import { UPDATE_REQUIRED_MESSAGE } from "../src/core/uploads-folder";
import { FakeSsh, FakeUploadsFolder, TEMP_UPLOADS, failure } from "./fakes";

/** First bridge protocol that resolves attachments in the temp uploads folder. */
const TEMP_UPLOADS_PROTOCOL = "1.7";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const draft: readonly Attachment[] = [
	{ id: "a", sourceUri: "content://a", displayName: "a.png", size: null, mimeType: "image/png", kind: "image" },
	{ id: "b", sourceUri: "content://b", displayName: "b.txt", size: null, mimeType: "text/plain", kind: "file" },
];

async function setup(version = TEMP_UPLOADS_PROTOCOL, queued = false) {
	const ssh = new FakeSsh();
	const folder = new FakeUploadsFolder();
	ssh.sourceSizes.set("content://a", ATTACHMENT_MAX_BYTES);
	ssh.sourceSizes.set("content://b", 10);
	const upload = vi.spyOn(ssh, "uploadFile");
	const remove = vi.spyOn(ssh, "removeFile");
	const posts: unknown[] = [];
	const uploadedAtSend: number[] = [];
	let sendFails = false;
	const envelope = { protocolVersion: version, bridgeInstanceId: "b", sessionId: "s" };
	const http: BridgeHttp = { request: async (method, url, _token, body) => {
		const path = new URL(url).pathname;
		if (method === "POST") {
			posts.push(body);
			uploadedAtSend.push(ssh.uploadedFiles.size);
			if (sendFails) return { ok: false, message: "Connection reset" };
			return { ok: true, status: 200, data: { ...envelope, status: queued ? "queued" : "submitted", attachments: { files: 2, imagesAttached: 0, imagesWithheld: "model" } } };
		}
		const data = path === "/state" ? { ...envelope, idle: true, pendingMessages: false, pendingPrompt: null, model: null, lastSeq: 0, oldestSeq: null, lastActivityAt: null, terminal: true }
			: { ...envelope, messages: [] };
		return { ok: true, status: 200, data };
	} };
	const endpoint = { baseUrl: "http://localhost:5000", token: "t" };
	const timers = { set: () => 0, clear: () => {} };
	const uploads = { host: ssh as unknown as HostConnection, folder, connection: async () => ({ ok: true as const, connectionId: "conn" }), clock: () => 0, random: () => 0.5 };
	const session = new LiveSession({ http, endpoint: async () => endpoint, events: { open: () => () => {} }, timers, uploads });
	session.start();
	await flush();
	const progress = vi.fn();
	const send = (text: string, attachments: readonly Attachment[] = draft) => session.send(text, attachments, progress);
	return { ssh, folder, upload, remove, posts, uploadedAtSend, send, session, draft, progress, failSend: () => { sendFails = true; } };
}

describe("chat attachment send", () => {
	it("uploads the whole batch before sending only safe names and reports withheld chat images", async () => {
		const f = await setup();
		const result = await f.send("look");
		expect(result).toEqual({ ok: true, imagesWithheld: "model" });
		expect(f.upload).toHaveBeenCalledTimes(2);
		expect(f.progress.mock.calls).toEqual([[1, 2], [2, 2], [0, 2]]);
		const names = f.upload.mock.calls.map(call => call[3]);
		for (const call of f.upload.mock.calls) {
			expect(call[0]).toBe("conn");
			expect(call[2]).toBe(TEMP_UPLOADS.sftpPath);
			expect(call[4]).toBe(ATTACHMENT_MAX_BYTES);
			expect(call[5]).toBe(TEMP_UPLOADS.sftpPath);
			expect(decodeResponse(UploadName, call[3]).ok).toBe(true);
		}
		expect(f.posts).toEqual([{ text: "look", attachments: names }]);
		expect(f.uploadedAtSend).toEqual([2]);
	});
	it.each(["1.1", "1.6"])("asks to update before any upload when the bridge speaks %s", async version => {
		const f = await setup(version);
		expect(await f.send("look")).toEqual({ ok: false, message: UPDATE_REQUIRED_MESSAGE });
		expect(f.folder.calls).toEqual([]);
		expect(f.upload).not.toHaveBeenCalled();
		expect(f.posts).toEqual([]);
	});
	it.each([
		[{ ok: false as const, code: "UPDATE_REQUIRED" as const, message: UPDATE_REQUIRED_MESSAGE }, UPDATE_REQUIRED_MESSAGE],
		[{ ok: false as const, code: "PERMISSION_DENIED" as const, message: "Uploads folder refused: not private." }, "Uploads folder refused: not private."],
	])("sends nothing when the uploads folder lookup fails (%#)", async (result, message) => {
		const f = await setup();
		f.folder.result = result;
		expect(await f.send("look")).toEqual({ ok: false, message });
		expect(f.folder.calls).toEqual(["conn"]);
		expect(f.upload).not.toHaveBeenCalled();
		expect(f.posts).toEqual([]);
	});
	it.each(["TOO_LARGE", "SOURCE_UNREADABLE", "NOT_CONNECTED"] as const)("keeps the draft, sends nothing and removes earlier uploads after %s", async code => {
		const f = await setup();
		f.upload.mockImplementationOnce(async (...args) => FakeSsh.prototype.uploadFile.apply(f.ssh, args)).mockResolvedValueOnce(failure(code));
		expect(await f.send("look")).toEqual({ ok: false, message: code === "TOO_LARGE" ? expect.stringMatching(/b.txt.*25 MB/) : code === "SOURCE_UNREADABLE" ? expect.stringMatching(/select it again/i) : "NOT_CONNECTED" });
		expect(f.posts).toEqual([]);
		expect(f.progress.mock.calls).toEqual([[1, 2], [2, 2]]);
		expect(f.remove).toHaveBeenCalledTimes(1);
		expect(f.remove).toHaveBeenCalledWith("conn", `${TEMP_UPLOADS.sftpPath}/${f.upload.mock.calls[0]![3]}`, TEMP_UPLOADS.sftpPath);
		expect(f.ssh.uploadedFiles.size).toBe(0);
		expect(draft).toHaveLength(2);
		expect(await f.send("retry")).toMatchObject({ ok: true });
	});
	it("enforces the byte cap even for sources whose size was unknown in the draft", async () => {
		const f = await setup();
		f.ssh.sourceSizes.set("content://b", ATTACHMENT_MAX_BYTES + 1);
		expect(await f.send("look")).toEqual({ ok: false, message: expect.stringMatching(/b.txt.*25 MB/) });
		expect(f.posts).toEqual([]);
		expect(f.ssh.uploadedFiles.size).toBe(0);
	});
	it("sends nothing even when a failed batch's cleanup also fails", async () => {
		const f = await setup();
		f.ssh.sourceSizes.delete("content://b");
		f.remove.mockRejectedValueOnce(new Error("lost connection"));
		expect(await f.send("look")).toEqual({ ok: false, message: expect.stringMatching(/select it again/i) });
		expect(f.posts).toEqual([]);
		expect(draft).toHaveLength(2);
	});
	it("keeps the draft after bridge failure and preserves text-only payloads", async () => {
		const f = await setup();
		f.failSend();
		expect(await f.send("look")).toEqual({ ok: false, message: "Connection reset" });
		expect(draft).toHaveLength(2);
		const plain = await setup("1.1");
		expect(await plain.send("hello", [])).toEqual({ ok: true });
		expect(plain.upload).not.toHaveBeenCalled();
		expect(plain.posts).toEqual([{ text: "hello" }]);
	});
	it("keeps upload names on attachment-only queued messages for the shared renderer", async () => {
		const f = await setup(TEMP_UPLOADS_PROTOCOL, true);
		expect(await f.send("")).toMatchObject({ ok: true });
		const names = f.upload.mock.calls.map(call => call[3]);
		const stop = (f.session as LiveSession).subscribe(view => {
			expect(view.conversation?.outgoing).toEqual([{ key: "q1", text: "", files: names, state: "queued" }]);
		});
		stop();
	});
	it("allows an attachment-only send", async () => {
		const f = await setup();
		expect(await f.send("")).toMatchObject({ ok: true });
	});
});
