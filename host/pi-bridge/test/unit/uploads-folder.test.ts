import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, supportsTempUploads } from "@workspace/protocol";
import { prepareUploadsFolder } from "@workspace/protocol/uploads-folder";
import { createUploadStore } from "../../src/adapters/upload-store.ts";
import { uploadsFolder } from "../../src/config.ts";
import { BridgeSession } from "../../src/core/bridge-session.ts";
import type { PiSessionPort } from "../../src/core/ports.ts";

let root: string;
let host: { platform: NodeJS.Platform; tmpdir: string; uid: number };
let folder: string;

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "bridge-uploads-")));
	mkdirSync(join(root, "tmp"));
	host = { platform: process.platform, tmpdir: join(root, "tmp"), uid: process.getuid?.() ?? 0 };
	folder = join(root, "tmp", `mars-ram-${host.uid}`, "uploads");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("bridge uploads folder", () => {
	it("advertises the protocol minor that reads attachments from the temp folder", () => {
		expect(supportsTempUploads(PROTOCOL_VERSION)).toBe(true);
	});

	it("is the shared policy's folder unless a test overrides it", () => {
		expect(uploadsFolder({}, host).dir).toBe(folder);
		expect(uploadsFolder({ PI_BRIDGE_UPLOADS_DIR: join(root, "override") }, host)).toEqual({ dir: join(root, "override") });
	});

	it.skipIf(process.platform === "win32")("resolves an upload in the private temp folder", async () => {
		expect(await prepareUploadsFolder(host)).toEqual({ ok: true, path: folder });
		writeFileSync(join(folder, "notes.txt"), "hello", { mode: 0o600 });
		const { dir, verify } = uploadsFolder({}, host);
		expect(await createUploadStore(dir, verify).resolve("notes.txt")).toEqual({ path: join(folder, "notes.txt"), size: 5, mimeType: null });
	});

	it.skipIf(process.platform === "win32")("resolves nothing once the folder fails the policy, without repairing it", async () => {
		await prepareUploadsFolder(host);
		writeFileSync(join(folder, "notes.txt"), "hello", { mode: 0o600 });
		chmodSync(join(root, "tmp", `mars-ram-${host.uid}`), 0o755);
		const { dir, verify } = uploadsFolder({}, host);
		expect(await createUploadStore(dir, verify).resolve("notes.txt")).toBeNull();
	});

	it("resolves nothing before the folder exists, and never creates it", async () => {
		const { dir, verify } = uploadsFolder({}, host);
		expect(await createUploadStore(dir, verify).resolve("notes.txt")).toBeNull();
		expect(() => realpathSync(folder)).toThrow();
	});

	it.skipIf(process.platform === "win32")("keeps refusing links inside the private folder", async () => {
		await prepareUploadsFolder(host);
		writeFileSync(join(root, "secret.txt"), "private");
		symlinkSync(join(root, "secret.txt"), join(folder, "link.txt"));
		const { dir, verify } = uploadsFolder({}, host);
		expect(await createUploadStore(dir, verify).resolve("link.txt")).toBeNull();
	});

	it("tells an old app that uploaded to ~/.mars-ram/uploads that the attachment is not on the computer", async () => {
		await prepareUploadsFolder(host);
		const legacy = join(root, "home", ".mars-ram", "uploads");
		mkdirSync(legacy, { recursive: true });
		writeFileSync(join(legacy, "old.png"), "x");
		const { dir, verify } = uploadsFolder({}, host);
		const pi: PiSessionPort = {
			sessionId: () => "sess", isIdle: () => true, hasPendingMessages: () => false, model: () => null, imagesBlocked: () => false,
			history: () => [], send: () => { throw new Error("must not send"); }, abort: () => {},
		};
		const bridge = new BridgeSession({ pi, uploads: createUploadStore(dir, verify), instanceId: "inst", capacity: 10, clock: () => 1 });
		expect(await bridge.sendMessage({ text: "look", attachments: ["old.png"] })).toMatchObject({ ok: false, error: { error: { code: "not_found", message: "An attachment is not on the computer: old.png. Attach it again." } } });
	});
});
