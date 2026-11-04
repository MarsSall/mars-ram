import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, REGISTRY_DIRECTORY, type RegistryEntry } from "@workspace/protocol";
import { discoverBridges, openBridge } from "../src/core/bridge-discovery";
import type { DirEntry, Failure, HostConnection } from "../src/core/ports";

const entry = (id: string, startedAt: number, extra: Partial<RegistryEntry> = {}): RegistryEntry => ({
	protocolVersion: PROTOCOL_VERSION,
	bridgeInstanceId: id,
	sessionId: `sess-${id}`,
	port: 40000,
	token: "t".repeat(64),
	pid: 10,
	cwd: "/work",
	startedAt,
	...extra,
});

class FakeHost implements HostConnection {
	files = new Map<string, string>();
	listFailure: Failure | null = null;
	readFailures = new Map<string, Failure>();
	forwards: number[] = [];
	closed: string[] = [];

	async connect(): Promise<never> {
		throw new Error("not used");
	}
	async homeDirectory(): Promise<never> {
		throw new Error("not used");
	}
	async exec(): Promise<never> {
		throw new Error("not used");
	}
	async uploadFile(): Promise<never> {
		throw new Error("not used");
	}
	async removeFile(): Promise<never> {
		throw new Error("not used");
	}
	async disconnect() {}
	isConnected() {
		return true;
	}
	async listDir(_id: string, path: string) {
		if (this.listFailure) return this.listFailure;
		const entries: DirEntry[] = [...this.files.keys()]
			.filter((file) => file.startsWith(`${path}/`))
			.map((file) => ({ name: file.slice(path.length + 1), isFile: true, size: this.files.get(file)!.length, modifiedAt: 0 }));
		return { ok: true as const, entries };
	}
	async readFile(_id: string, path: string) {
		const failure = this.readFailures.get(path);
		if (failure) return failure;
		return { ok: true as const, content: this.files.get(path)! };
	}
	async forwardLocal(_id: string, remotePort: number) {
		this.forwards.push(remotePort);
		return { ok: true as const, forwardId: "fwd-1", localPort: 51000 };
	}
	async closeForward(forwardId: string) {
		this.closed.push(forwardId);
	}

	put(name: string, content: unknown) {
		this.files.set(`${REGISTRY_DIRECTORY}/${name}`, typeof content === "string" ? content : JSON.stringify(content));
	}
}

describe("discoverBridges", () => {
	it("returns the valid bridges, newest first", async () => {
		const host = new FakeHost();
		host.put("a.json", entry("a", 1));
		host.put("b.json", entry("b", 2));
		const result = await discoverBridges(host, "conn");
		expect(result).toEqual({
			ok: true,
			bridges: [entry("b", 2), entry("a", 1)],
			skipped: [],
		});
	});

	it("treats a missing registry directory as no bridges, so Pi is simply not running", async () => {
		const host = new FakeHost();
		host.listFailure = { ok: false, code: "NOT_FOUND", message: "missing" };
		expect(await discoverBridges(host, "conn")).toEqual({ ok: true, bridges: [], skipped: [] });
	});

	it("ignores temporary files a bridge is still writing", async () => {
		const host = new FakeHost();
		host.put("a.json.123.tmp", "partial");
		expect(await discoverBridges(host, "conn")).toEqual({ ok: true, bridges: [], skipped: [] });
	});

	it.each([
		["invalid JSON", "{not json", "The entry is not valid JSON."],
		["a non-bridge entry", { hello: "world" }, "The entry is not a bridge registration."],
	])("skips %s with a reason and keeps the other bridges", async (_name, content, reason) => {
		const host = new FakeHost();
		host.put("bad.json", content);
		host.put("good.json", entry("good", 1));
		const result = await discoverBridges(host, "conn");
		expect(result).toEqual({
			ok: true,
			bridges: [entry("good", 1)],
			skipped: [{ path: `${REGISTRY_DIRECTORY}/bad.json`, reason }],
		});
	});

	it("skips a bridge that speaks another major protocol version, with the compatibility message", async () => {
		const host = new FakeHost();
		host.put("old.json", entry("old", 1, { protocolVersion: "2.0" }));
		const result = await discoverBridges(host, "conn");
		expect(result).toMatchObject({ ok: true, bridges: [] });
		expect(result.ok && result.skipped[0]?.reason).toMatch(/^The bridge speaks protocol 2.0/);
	});

	it("skips an entry that disappeared while reading, because its bridge just stopped", async () => {
		const host = new FakeHost();
		host.put("gone.json", entry("gone", 1));
		host.readFailures.set(`${REGISTRY_DIRECTORY}/gone.json`, { ok: false, code: "NOT_FOUND", message: "missing" });
		expect(await discoverBridges(host, "conn")).toEqual({ ok: true, bridges: [], skipped: [] });
	});

	it("fails when the connection fails, instead of reporting no bridges", async () => {
		const host = new FakeHost();
		const failure: Failure = { ok: false, code: "TIMEOUT", message: "stopped responding" };
		host.listFailure = failure;
		expect(await discoverBridges(host, "conn")).toEqual(failure);
	});
});

describe("openBridge", () => {
	it("tunnels to the bridge port on the host's loopback and returns how to call it", async () => {
		const host = new FakeHost();
		const bridge = await openBridge(host, "conn", entry("a", 1, { port: 40123 }));
		expect(host.forwards).toEqual([40123]);
		expect(bridge).toMatchObject({ ok: true, baseUrl: "http://127.0.0.1:51000", token: "t".repeat(64) });
		if (bridge.ok) await bridge.close();
		expect(host.closed).toEqual(["fwd-1"]);
	});
});
