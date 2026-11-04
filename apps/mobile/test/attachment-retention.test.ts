import { describe, expect, it, vi } from "vitest";
import { UPLOADS_DIRECTORY } from "@workspace/protocol";
import { cleanupUploads, type AttachmentRetention } from "../src/core/attachment-retention";
import { HostConnections } from "../src/core/host-connections";
import type { HostConnection } from "../src/core/ports";
import { FakeSsh, failure, savedHost } from "./fakes";

const hour = 60 * 60 * 1000;
const day = 24 * hour;
const now = 100 * day;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const port = (ssh: FakeSsh) => ssh as unknown as HostConnection;
function add(ssh: FakeSsh, name: string, age: number, isFile = true) {
	ssh.uploadedFiles.set(`${UPLOADS_DIRECTORY}/${name}`, { name, isFile, size: 1, modifiedAt: now - age });
}

describe("upload retention", () => {
	it.each([1, 7, 30] as const)("removes only regular files strictly older than %i days", async retention => {
		const ssh = new FakeSsh();
		add(ssh, "old.txt", retention * day + 1);
		add(ssh, "boundary.txt", retention * day);
		add(ssh, "new.txt", 0);
		add(ssh, "directory", 90 * day, false);
		await cleanupUploads(port(ssh), "c", retention, () => now);
		expect([...ssh.uploadedFiles.keys()]).toEqual(["boundary.txt", "new.txt", "directory"].map(name => `${UPLOADS_DIRECTORY}/${name}`));
	});
	it.each([1, 7, 30, "never"] as const)("always removes stale .part files with choice %s, but not the exact hour boundary", async retention => {
		const ssh = new FakeSsh();
		add(ssh, "lost.part", hour + 1);
		add(ssh, "lost.PART", hour + 1);
		add(ssh, "active.part", hour);
		add(ssh, "keep.txt", 90 * day);
		await cleanupUploads(port(ssh), "c", retention, () => now);
		expect(ssh.uploadedFiles.has(`${UPLOADS_DIRECTORY}/lost.part`)).toBe(false);
		expect(ssh.uploadedFiles.has(`${UPLOADS_DIRECTORY}/lost.PART`)).toBe(false);
		expect(ssh.uploadedFiles.has(`${UPLOADS_DIRECTORY}/active.part`)).toBe(true);
		expect(ssh.uploadedFiles.has(`${UPLOADS_DIRECTORY}/keep.txt`)).toBe(retention === "never");
	});
	it("treats a missing directory as success, and continues after a refused or thrown removal", async () => {
		const ssh = new FakeSsh();
		const list = vi.spyOn(ssh, "listDir").mockResolvedValueOnce(failure("NOT_FOUND"));
		await expect(cleanupUploads(port(ssh), "c", 7, () => now)).resolves.toBeUndefined();
		for (const name of ["a", "b", "c"]) add(ssh, name, 90 * day);
		const remove = vi.spyOn(ssh, "removeFile").mockResolvedValueOnce(failure("PERMISSION_DENIED")).mockRejectedValueOnce(new Error("disconnected"));
		await cleanupUploads(port(ssh), "c", 7, () => now);
		expect(remove).toHaveBeenCalledTimes(3);
		expect(ssh.uploadedFiles.has(`${UPLOADS_DIRECTORY}/c`)).toBe(false);
		expect(list).toHaveBeenCalledWith("c", UPLOADS_DIRECTORY);
	});
	it("never uses listing names to leave the uploads directory", async () => {
		const ssh = new FakeSsh();
		vi.spyOn(ssh, "listDir").mockResolvedValue({ ok: true, entries: ["../outside", "..\\outside", "/outside"].map(name => ({ name, isFile: true, size: 0, modifiedAt: 0 })) });
		const remove = vi.spyOn(ssh, "removeFile");
		await cleanupUploads(port(ssh), "c", 7, () => now);
		expect(remove).not.toHaveBeenCalled();
	});
	it("runs once per computer after success, reads the preference, and does not delay connection or turn cleanup failure into connection failure", async () => {
		const ssh = new FakeSsh();
		let finish!: (value: { ok: true; entries: [] }) => void;
		const list = vi.spyOn(ssh, "listDir").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockRejectedValueOnce(new Error("offline"));
		const retention = vi.fn<() => AttachmentRetention>(() => "never");
		const connections = new HostConnections({ host: port(ssh), keyAlias: "k", unlock: async () => true, retention, clock: () => now });
		ssh.refuse = failure("UNREACHABLE");
		expect((await connections.connection(savedHost("a"))).ok).toBe(false);
		expect(list).not.toHaveBeenCalled();
		ssh.refuse = null;
		expect((await connections.connection(savedHost("a"))).ok).toBe(true);
		await flush();
		expect(list).toHaveBeenCalledTimes(1);
		await connections.drop("a");
		await connections.connection(savedHost("a"));
		await connections.connection(savedHost("b"));
		await flush();
		expect(list).toHaveBeenCalledTimes(2);
		expect(retention).toHaveBeenCalledTimes(2);
		finish({ ok: true, entries: [] });
	});
	it("defaults to seven days on the first connection", async () => {
		const ssh = new FakeSsh();
		add(ssh, "old", 8 * day);
		add(ssh, "recent", 2 * day);
		const connections = new HostConnections({ host: port(ssh), keyAlias: "k", unlock: async () => true, clock: () => now });
		await connections.connection(savedHost("a"));
		await flush();
		expect(ssh.uploadedFiles.has(`${UPLOADS_DIRECTORY}/old`)).toBe(false);
		expect(ssh.uploadedFiles.has(`${UPLOADS_DIRECTORY}/recent`)).toBe(true);
	});
});
