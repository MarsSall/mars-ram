import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, link, symlink, truncate, rm, utimes, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../../src/adapters/file-store.ts";
import { startHttp } from "../../src/adapters/http.ts";
import { LinkService, MAX_BYTES } from "../../src/core/links.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "link-server-test-")); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
const metadata = { id: "abcdefghijkl", token: "a".repeat(43), createdAt: new Date(0).toISOString(), expiresAt: new Date(86400000).toISOString() };
async function fixture(name = "file.txt") {
	const store = createFileStore(join(root, "links")); await store.init();
	const path = join(root, "links", ".staging", name); await writeFile(path, "hello");
	return { store, path };
}

describe("orphan recovery", () => {
	it.each(["invalid", "malformed", "missing", "pending", "symlink"])("reports %s metadata and sweeps only after 24 hours", async kind => {
		const { store } = await fixture();
		const dir = join(root, "links", metadata.id); await mkdir(dir);
		await writeFile(join(dir, "content"), "private");
		if (kind === "symlink") {
			const target = join(root, "metadata-target"); await writeFile(target, "{}"); await symlink(target, join(dir, "link.json"));
		} else if (kind !== "missing") {
			const createdAt = Date.now() + 86400000;
			const pending = { ...metadata, fileName: "file.txt", size: 7, contentKind: "download", mime: "application/octet-stream", createdAt: new Date(createdAt).toISOString(), expiresAt: new Date(createdAt + 86400000).toISOString() };
			await writeFile(join(dir, kind === "pending" ? "link.json.pending" : "link.json"), kind === "pending" ? JSON.stringify(pending) : kind === "malformed" ? "{" : "{}");
		}
		const before = Date.now() + 1000;
		const service = new LinkService({ store, clock: () => before, random: () => "", tailscale: { address: async () => { throw new Error("offline"); } }, launcher: { isRunning: async () => false, start: async () => {} } });
		expect(await service.status()).toEqual({ serving: false, links: 0, invalid: 1 });
		expect(await store.all()).toEqual([]);
		const server = await startHttp(service, { ip: "127.0.0.1", port: 0 });
		try {
			const response = await fetch(`http://127.0.0.1:${server.port}/l/${metadata.token}`, { headers: { Connection: "close" } });
			expect(response.status).toBe(404);
			expect(await response.text()).toBe("Not found\n");
		} finally { await server.close(); }
		expect(await service.list()).toEqual({ serving: false, links: [] });
		expect((await lstat(dir)).isDirectory()).toBe(true);
		// Advance the sweep clock: ctime cannot be backdated with utimes.
		const sweep = before + 86400000 + 1000;
		expect(await service.status()).toEqual({ serving: false, links: 0, invalid: 1 });
		expect((await lstat(dir)).isDirectory()).toBe(true); // Status remains read-only even for stale entries.
		expect(await store.all(sweep - 86400000)).toEqual([]);
		await expect(lstat(dir)).rejects.toMatchObject({ code: "ENOENT" });
		expect(await service.status()).toEqual({ serving: false, links: 0, invalid: 0 });
		if (kind === "symlink") expect(await readFile(join(root, "metadata-target"), "utf8")).toBe("{}");
	});
	it("cleans stale staging files, keeps fresh files and never follows symlinks", async () => {
		const { store, path } = await fixture();
		const outside = join(root, "outside"); await mkdir(outside); await writeFile(join(outside, "keep"), "safe");
		const unrelated = join(root, "links", "not-an-id"); await mkdir(unrelated); await utimes(unrelated, new Date(0), new Date(0));
		const entry = join(root, "links", metadata.id); await symlink(outside, entry, "dir");
		const stale = join(root, "links", ".staging", "upload.part"); await writeFile(stale, "old"); await utimes(stale, new Date(0), new Date(0));
		await symlink(join(outside, "keep"), join(root, "links", ".staging", "linked"));
		await store.all(Date.now() - 86400000);
		await expect(lstat(stale)).rejects.toMatchObject({ code: "ENOENT" });
		expect(await readFile(path, "utf8")).toBe("hello");
		expect(await readFile(join(outside, "keep"), "utf8")).toBe("safe");
		expect((await lstat(entry)).isSymbolicLink()).toBe(true);
		expect((await lstat(unrelated)).isDirectory()).toBe(true);
		expect((await lstat(join(root, "links", ".staging", "linked"))).isSymbolicLink()).toBe(true);
	});
});

describe("cleanup race boundaries", () => {
	const saved = { ...metadata, fileName: "file.txt", size: 5, contentKind: "download", mime: "application/octet-stream" };
	async function stale(hook: (kind: "id" | "staging", path: string) => Promise<void>) {
		await fixture();
		const dir = join(root, "links", metadata.id); await mkdir(dir);
		await writeFile(join(dir, "content"), "old");
		await writeFile(join(dir, "link.json"), "{}");
		// A future cutoff makes real ctimes stale without mocking the filesystem.
		const cutoff = Date.now() + 60000;
		const store = createFileStore(join(root, "links"), hook);
		return { store, dir, cutoff };
	}
	it.each(["id", "staging"] as const)("aborts after a %s ancestor swap without deleting outside", async kind => {
		const outside = join(root, "outside"); await mkdir(outside);
		await mkdir(join(outside, metadata.id)); await writeFile(join(outside, metadata.id, "content"), "safe");
		await writeFile(join(outside, "file.txt"), "safe");
		const { store, cutoff } = await stale(async phase => {
			if (phase !== kind) return;
			const ancestor = join(root, "links", ...(kind === "staging" ? [".staging"] : []));
			await rename(ancestor, `${ancestor}-original`);
			await symlink(outside, ancestor, "dir");
		});
		await expect(store.all(cutoff)).rejects.toThrow();
		expect(await readFile(join(outside, metadata.id, "content"), "utf8")).toBe("safe");
		expect(await readFile(join(outside, "file.txt"), "utf8")).toBe("safe");
	});
	it("keeps an entry published after inspection", async () => {
		const { store, dir, cutoff } = await stale(async (kind, path) => {
			if (kind === "id") await writeFile(join(path, "link.json"), JSON.stringify(saved));
		});
		await store.all(cutoff);
		expect(await readFile(join(dir, "content"), "utf8")).toBe("old");
		expect(await store.all()).toEqual([saved]);
	});
	it("keeps old directories with freshly rewritten invalid metadata", async () => {
		const { store, dir } = await stale(async () => {});
		await utimes(dir, new Date(0), new Date(0));
		await writeFile(join(dir, "link.json"), "{fresh but invalid");
		await store.all(Date.now() - 86400000);
		expect(await readFile(join(dir, "link.json"), "utf8")).toBe("{fresh but invalid");
	});
	it("keeps staging replaced after inspection", async () => {
		const { store, cutoff } = await stale(async (kind, path) => {
			if (kind !== "staging") return;
			await rename(path, `${path}.old`); await writeFile(path, "fresh upload");
		});
		await store.all(cutoff);
		expect(await readFile(join(root, "links", ".staging", "file.txt"), "utf8")).toBe("fresh upload");
	});
	it("leaves unknown contents and counts the directory as invalid", async () => {
		const { store, dir, cutoff } = await stale(async () => {});
		await writeFile(join(dir, "unknown"), "keep");
		await store.all(cutoff);
		expect(await readFile(join(dir, "unknown"), "utf8")).toBe("keep");
		expect(await store.invalidCount()).toBe(1);
	});
});

describe("atomic registration", () => {
	it.each(["temporary", "ready"])("leaves work interrupted at %s invisible and cleans it only after grace", async interrupted => {
		await fixture();
		const store = createFileStore(join(root, "links"), undefined, async phase => { if (phase === interrupted) throw new Error("interrupted"); });
		await expect(store.create("file.txt", metadata)).rejects.toThrow("interrupted");
		const names = await readdir(join(root, "links"));
		const temporary = names.find(name => name.startsWith(".tmp-"));
		expect(temporary).toBeDefined();
		expect(names).not.toContain(metadata.id);
		const service = new LinkService({ store, clock: Date.now, random: () => "", tailscale: { address: async () => { throw new Error("offline"); } }, launcher: { isRunning: async () => false, start: async () => {} } });
		expect(await service.status()).toEqual({ serving: false, links: 0, invalid: 0 });
		expect(await service.list()).toEqual({ serving: false, links: [] });
		const server = await startHttp(service, { ip: "127.0.0.1", port: 0 });
		try { expect((await fetch(`http://127.0.0.1:${server.port}/l/${metadata.token}`, { headers: { Connection: "close" } })).status).toBe(404); }
		finally { await server.close(); }
		expect((await lstat(join(root, "links", temporary!))).isDirectory()).toBe(true);
		await store.all(Date.now() + 1000);
		await expect(lstat(join(root, "links", temporary!))).rejects.toMatchObject({ code: "ENOENT" });
	});
	it("publishes only a complete id directory and survives cleanup at every publication boundary", async () => {
		await fixture();
		const observed: string[] = [];
		const reader = createFileStore(join(root, "links"));
		const store = createFileStore(join(root, "links"), undefined, async (phase: string) => {
			observed.push(phase);
			const entries = await readdir(join(root, "links"));
			expect(entries.includes(metadata.id)).toBe(phase === "published");
			const links = await reader.all(Date.now() - 86400000);
			expect(links.length).toBe(phase === "published" ? 1 : 0);
			if (phase === "published") expect((await reader.read(links[0]!)).toString()).toBe("hello");
		});
		const saved = await store.create("file.txt", metadata);
		expect(observed).toEqual(["temporary", "ready", "published"]);
		expect(await reader.all()).toEqual([saved]);
	});
	it.each([false, true])("does not overwrite an existing id directory (populated: %s)", async populated => {
		const { store } = await fixture();
		const existing = join(root, "links", metadata.id); await mkdir(existing);
		if (populated) await writeFile(join(existing, "unknown"), "keep");
		const saved = await store.create("file.txt", metadata);
		expect(saved.id).not.toBe(metadata.id);
		expect(await readdir(existing)).toEqual(populated ? ["unknown"] : []);
		expect((await store.read(saved)).toString()).toBe("hello");
	});
	it("concurrent registrations do not interfere, including an id collision", async () => {
		const { store } = await fixture();
		await writeFile(join(root, "links", ".staging", "second.txt"), "second");
		const saved = await Promise.all([store.create("file.txt", metadata), createFileStore(join(root, "links")).create("second.txt", { ...metadata, token: "b".repeat(43) })]);
		expect(new Set(saved.map(link => link.id)).size).toBe(2);
		expect((await store.all()).length).toBe(2);
		expect(await Promise.all(saved.map(async link => (await store.read(link)).toString()))).toEqual(["hello", "second"]);
		expect((await readdir(join(root, "links"))).filter(name => name.startsWith(".tmp-"))).toEqual([]);
	});
});

describe("real filesystem copy contract", () => {
	it("moves a private staged copy into id/file and link.json, reads and deletes", async () => {
		const { store, path } = await fixture(); const saved = await store.create("file.txt", metadata);
		expect(saved).toMatchObject({ ...metadata, fileName: "file.txt", size: 5, contentKind: "download", mime: "application/octet-stream" });
		await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
		expect(JSON.parse(await readFile(join(root, "links", metadata.id, "link.json"), "utf8"))).toEqual(saved);
		expect((await store.read(saved)).toString()).toBe("hello"); expect(await store.all()).toEqual([saved]);
		if (process.platform !== "win32") {
			expect((await lstat(join(root, "links"))).mode & 0o777).toBe(0o700);
			expect((await lstat(join(root, "links", metadata.id, "content"))).mode & 0o777).toBe(0o600);
			expect((await lstat(join(root, "links", metadata.id, "link.json"))).mode & 0o777).toBe(0o600);
		}
		await store.delete(metadata.id); expect(await store.all()).toEqual([]);
	});
	it.each(["hello", ""]) ("streams checked bytes including an empty copy (%j)", async data => {
		const { store, path } = await fixture(); await writeFile(path, data);
		const saved = await store.create("file.txt", metadata);
		const opened = await store.open(saved);
		expect(opened.size).toBe(Buffer.byteLength(data));
		const chunks: Buffer[] = []; for await (const chunk of opened.stream) chunks.push(chunk);
		expect(Buffer.concat(chunks).toString()).toBe(data); await opened.close();
	});
	it("accepts link.json as an upload name without metadata collision", async () => {
		const { store } = await fixture("link.json"); const saved = await store.create("link.json", metadata);
		expect((await store.read(saved)).toString()).toBe("hello"); expect(await store.all()).toEqual([saved]);
	});
	it("persists image kind from magic, not the staged extension", async () => {
		const { store, path } = await fixture("image.txt");
		await writeFile(path, Buffer.from("89504e470d0a1a0a", "hex"));
		expect(await store.create("image.txt", metadata)).toMatchObject({ contentKind: "image", mime: "image/png", size: 8 });
	});
	it.each(["symlink", "hardlink", "directory", "oversize"])("refuses %s staging without registering it", async kind => {
		const { store, path } = await fixture(); const staged = join(root, "links", ".staging", "bad");
		if (kind === "symlink") await symlink(path, staged);
		if (kind === "hardlink") await link(path, staged);
		if (kind === "directory") await mkdir(staged);
		if (kind === "oversize") { await writeFile(staged, ""); await truncate(staged, MAX_BYTES + 1); }
		await expect(store.create("bad", metadata)).rejects.toThrow(); expect(await store.all()).toEqual([]);
	});
	it("refuses a linked staging directory", async () => {
		await mkdir(join(root, "elsewhere")); await mkdir(join(root, "links"));
		await symlink(join(root, "elsewhere"), join(root, "links", ".staging"));
		await expect(createFileStore(join(root, "links")).init()).rejects.toThrow();
	});
	it("refuses replaced served copies and metadata symlinks", async () => {
		const { store } = await fixture(); const saved = await store.create("file.txt", metadata);
		await link(join(root, "links", metadata.id, "content"), join(root, "second-name"));
		await expect(store.read(saved)).rejects.toThrow();
		await expect(store.open(saved)).rejects.toThrow();
	});
});

describe("real Node CLI (no bind override or detached child)", () => {
	const main = fileURLToPath(new URL("../../src/main.ts", import.meta.url));
	async function cli(args: string[]) {
		return promisify(execFile)(process.execPath, [main, ...args], { env: { ...process.env, HOME: root, USERPROFILE: root } });
	}
	it("status creates no storage and preserves expired metadata/content", async () => {
		expect(JSON.parse((await cli(["status"])).stdout)).toEqual({ serving: false, links: 0, invalid: 0 });
		await expect(lstat(join(root, ".mars-ram"))).rejects.toMatchObject({ code: "ENOENT" });
		await mkdir(join(root, ".mars-ram"));
		const store = createFileStore(join(root, ".mars-ram/links")); await store.init();
		await writeFile(join(root, ".mars-ram/links/.staging/test"), "hello");
		await store.create("test", metadata);
		const path = join(root, ".mars-ram/links", metadata.id, "link.json"); const before = await readFile(path, "utf8");
		expect(JSON.parse((await cli(["status"])).stdout)).toEqual({ serving: false, links: 0, invalid: 0 });
		expect(await readFile(path, "utf8")).toBe(before);
		expect(await readFile(join(root, ".mars-ram/links", metadata.id, "content"), "utf8")).toBe("hello");
	});
	it("list/ensure with no links and idempotent delete have exact JSON outputs", async () => {
		expect(JSON.parse((await cli(["list"])).stdout)).toEqual({ serving: false, links: [] });
		expect(JSON.parse((await cli(["ensure"])).stdout)).toEqual({ serving: false });
		expect(JSON.parse((await cli(["delete", "abcdefghijkl"])).stdout)).toEqual({ ok: true });
	});
	it("invalid command, id, staged name and port exit nonzero without echoing arguments", async () => {
		for (const args of [["wat"], ["delete", "../x"], ["create", "--staged", "../x"], ["ensure", "--port", "0"], ["ensure", "--bind", "0.0.0.0"]]) {
			await expect(cli(args)).rejects.toMatchObject({ code: 1 });
		}
	});
});
