import { beforeEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, REGISTRY_DIRECTORY, type RegistryEntry, type StateResponse } from "@workspace/protocol";
import type { BridgeHttp, HttpResult } from "../src/core/bridge-client";
import { HostConnections } from "../src/core/host-connections";
import type { DirEntry, Failure, HostConnection } from "../src/core/ports";
import { groupSessions, SessionLister, type ComputerSessions, type SessionSummary } from "../src/core/session-list";
import { orderSessions } from "../src/core/session-order";
import { FakeSsh, savedHost } from "./fakes";

const envelope = (id: string) => ({ protocolVersion: PROTOCOL_VERSION, bridgeInstanceId: id, sessionId: `sess-${id}` });

const entry = (id: string, port: number, cwd: string, startedAt = 100): RegistryEntry => ({
	...envelope(id),
	port,
	token: id.repeat(64).slice(0, 64),
	pid: 10,
	cwd,
	startedAt,
});

const state = (id: string, extra: Partial<StateResponse> = {}): StateResponse => ({
	...envelope(id),
	idle: true,
	pendingMessages: false,
	pendingPrompt: null,
	model: { id: "m", provider: "p", acceptsImages: true },
	lastSeq: 5,
	oldestSeq: 1,
	lastActivityAt: 5000,
	...extra,
});

const message = (role: string, text: string) => ({ entryId: `e-${text}`, role, text, images: 0, toolCalls: 0 });

/** One host whose registry files and tunnels are under the test's control. */
class FakeHost extends FakeSsh {
	files = new Map<string, Map<string, string>>();
	listFailure: Failure | null = null;
	forwards: { connectionId: string; remotePort: number; forwardId: string }[] = [];
	closedForwards: string[] = [];

	registry(hostAddress: string, ...entries: RegistryEntry[]) {
		this.files.set(hostAddress, new Map(entries.map((e) => [`${REGISTRY_DIRECTORY}/${e.bridgeInstanceId}.json`, JSON.stringify(e)])));
	}
	private filesOf(connectionId: string) {
		const target = this.targets.get(connectionId)!;
		return this.files.get(target.fallbackHost ?? target.host);
	}
	async listDir(connectionId: string, path: string) {
		if (this.listFailure) return this.listFailure;
		const files = this.filesOf(connectionId);
		if (!files) return { ok: false as const, code: "NOT_FOUND" as const, message: "missing" };
		const entries: DirEntry[] = [...files.keys()].map((file) => ({ name: file.slice(path.length + 1), isFile: true, size: 1, modifiedAt: 0 }));
		return { ok: true as const, entries };
	}
	async readFile(connectionId: string, path: string) {
		return { ok: true as const, content: this.filesOf(connectionId)!.get(path)! };
	}
	async forwardLocal(connectionId: string, remotePort: number) {
		const forwardId = `fwd-${this.forwards.length + 1}`;
		this.forwards.push({ connectionId, remotePort, forwardId });
		return { ok: true as const, forwardId, localPort: 50000 + remotePort };
	}
	async closeForward(forwardId: string) {
		this.closedForwards.push(forwardId);
	}
}

/** Bridges answer by remote port: the tunnel maps local 50000+port to it. */
class FakeHttp implements BridgeHttp {
	states = new Map<number, StateResponse>();
	histories = new Map<number, ReturnType<typeof message>[]>();
	down = new Set<number>();
	calls: string[] = [];

	async request(method: "GET" | "POST", url: string, token: string): Promise<HttpResult> {
		const parsed = new URL(url);
		const port = Number(parsed.port) - 50000;
		this.calls.push(`${method} ${port}${parsed.pathname} ${token.slice(0, 1)}`);
		if (this.down.has(port)) return { ok: false, message: "Connection refused" };
		if (parsed.pathname === "/state") return { ok: true, status: 200, data: this.states.get(port) };
		if (parsed.pathname === "/history") {
			const s = this.states.get(port)!;
			return { ok: true, status: 200, data: { protocolVersion: s.protocolVersion, bridgeInstanceId: s.bridgeInstanceId, sessionId: s.sessionId, messages: this.histories.get(port) ?? [] } };
		}
		return { ok: true, status: 404, data: null };
	}
}

const linux = savedHost("linux", { name: "devbox", address: "100.64.0.1" });
const windows = savedHost("win", { name: "Mars", address: "100.64.0.2" });

let host: FakeHost;
let http: FakeHttp;
let unlockAnswer: boolean;
let lister: SessionLister;

beforeEach(() => {
	host = new FakeHost();
	http = new FakeHttp();
	unlockAnswer = true;
	const connections = new HostConnections({
		host: host as unknown as HostConnection,
		keyAlias: "k",
		unlock: async () => {
			if (unlockAnswer) host.locked = false;
			return unlockAnswer;
		},
	});
	lister = new SessionLister({ connections, host: host as unknown as HostConnection, http });
});

const summary = (id: string, hostId: string, status: SessionSummary["status"], lastActivityAt: number): SessionSummary => ({
	key: `${hostId}/${id}`, hostId, bridgeInstanceId: id, project: id, cwd: `/work/${id}`, status, lastActivityAt, lastMessage: `Message ${id}`,
});
const initialOrder = { computers: [], needsYou: [], groupOrder: {} };

describe("attention-first session groups", () => {
	it("collects attention across computers oldest-first, removes duplicates, and retains empty groups and notices without mutating input", () => {
		const a = summary("a", "linux", "attention", 30);
		const b = summary("b", "win", "attention", 10);
		const recent = summary("recent", "linux", "working", 100);
		const older = summary("older", "linux", "done", 5);
		const incoming: ComputerSessions[] = [
			{ hostId: "linux", state: "ok", sessions: [older, a, recent] },
			{ hostId: "win", state: "ok", sessions: [b] },
			{ hostId: "empty", state: "no-pi", sessions: [] },
			{ hostId: "offline", state: "unreachable", sessions: [], message: "No route" },
		];
		const snapshot = structuredClone(incoming);
		const result = groupSessions(initialOrder, incoming, "focus");
		expect(result.needsYou).toEqual([b, a]);
		expect(result.computers).toEqual([
			{ ...incoming[0], sessions: [recent, older], attentionCount: 1 },
			{ ...incoming[1], sessions: [], attentionCount: 1 },
			{ ...incoming[2], attentionCount: 0 },
			{ ...incoming[3], attentionCount: 0 },
		]);
		expect(result.groupOrder).toEqual({ linux: [recent.key, older.key], win: [], empty: [], offline: [] });
		expect(incoming).toEqual(snapshot);
		expect(initialOrder).toEqual({ computers: [], needsYou: [], groupOrder: {} });
	});

	it("follows the existing automatic queue rule and clears the top section and counts when attention ends", () => {
		const a = summary("a", "linux", "attention", 30);
		const b = summary("b", "linux", "working", 10);
		const first = groupSessions(initialOrder, [{ hostId: "linux", state: "ok", sessions: [a, b] }], "focus");
		const waiting = { ...b, status: "attention" as const, lastActivityAt: 1 };
		const next = groupSessions(first, [{ hostId: "linux", state: "ok", sessions: [waiting, a] }], "automatic");
		expect(next.needsYou).toEqual([a, waiting]);
		expect(next.computers).toEqual([{ hostId: "linux", state: "ok", sessions: [], attentionCount: 2 }]);
		expect(next.groupOrder).toEqual({ linux: [b.key] });
		const done = { ...a, status: "done" as const };
		const returned = groupSessions(next, [{ hostId: "linux", state: "ok", sessions: [done, b] }], "automatic");
		expect(returned.needsYou).toEqual([]);
		expect(returned.computers).toEqual([{ hostId: "linux", state: "ok", sessions: [b, done], attentionCount: 0 }]);
		expect(returned.groupOrder).toEqual({ linux: [b.key, a.key] });
		expect(first.needsYou).toEqual([a]);
	});

	it.each(["focus", "manual", "automatic"] as const)("preserves existing list/order behavior without attention on %s refresh", (reason) => {
		const incoming: ComputerSessions[] = [{ hostId: "linux", state: "ok", sessions: [summary("old", "linux", "done", 1), summary("new", "linux", "working", 100)] }];
		const previous = orderSessions(initialOrder, incoming, "focus");
		const expected = orderSessions(previous, incoming, reason);
		expect(groupSessions(previous, incoming, reason)).toEqual({
			...expected, computers: expected.computers.map((computer) => ({ ...computer, attentionCount: 0 })),
		});
	});
});

describe("SessionLister", () => {
	it("lists each running Pi with its folder, status, last activity, and last message", async () => {
		host.registry("100.64.0.1", entry("a", 1, "/home/dev/web-shop"), entry("b", 2, "/home/dev/api"), entry("c", 3, "/home/dev/docs"));
		http.states.set(1, state("a", { idle: false, lastActivityAt: 9000 }));
		http.states.set(2, state("b", { pendingPrompt: { kind: "confirm" }, lastActivityAt: 7000 }));
		http.states.set(3, state("c", { lastActivityAt: null }));
		http.histories.set(1, [message("user", "fix the cart"), message("assistant", "Working on the cart total")]);
		http.histories.set(2, [message("assistant", "")]);

		const [computer] = await lister.list([linux]);

		expect(computer).toMatchObject({ hostId: "linux", state: "ok" });
		expect(computer!.sessions).toEqual([
			{ key: "linux/a", hostId: "linux", bridgeInstanceId: "a", project: "web-shop", cwd: "/home/dev/web-shop", status: "working", lastActivityAt: 9000, lastMessage: "Working on the cart total" },
			{ key: "linux/b", hostId: "linux", bridgeInstanceId: "b", project: "api", cwd: "/home/dev/api", status: "attention", lastActivityAt: 7000, lastMessage: null },
			// No event yet: the time the bridge started stands in.
			{ key: "linux/c", hostId: "linux", bridgeInstanceId: "c", project: "docs", cwd: "/home/dev/docs", status: "done", lastActivityAt: 100, lastMessage: null },
		]);
		expect(http.calls.filter((c) => c.startsWith("GET 1/state"))).toEqual(["GET 1/state a"]);
	});

	it("names Windows folders by their last part", async () => {
		host.registry("100.64.0.2", entry("w", 4, "C:\\Users\\dev\\Work\\api-pagos\\"));
		http.states.set(4, state("w"));
		const [computer] = await lister.list([windows]);
		expect(computer!.sessions[0]!.project).toBe("api-pagos");
	});

	it("says Pi is not open when the computer answers but has no bridge", async () => {
		const [computer] = await lister.list([linux]);
		expect(computer).toEqual({ hostId: "linux", state: "no-pi", sessions: [] });
	});

	it("never lists a bridge that left its entry behind but does not answer, and closes its tunnel", async () => {
		host.registry("100.64.0.1", entry("a", 1, "/w/one"), entry("gone", 2, "/w/two"));
		http.states.set(1, state("a"));
		http.down.add(2);
		const [computer] = await lister.list([linux]);
		expect(computer!.sessions.map((s) => s.bridgeInstanceId)).toEqual(["a"]);
		expect(host.closedForwards).toEqual(["fwd-2"]);
	});

	it("reports computers that do not answer, stay locked, or show another identity", async () => {
		host.refuse = { ok: false, code: "UNREACHABLE", message: "No route" };
		expect(await lister.list([linux])).toEqual([{ hostId: "linux", state: "unreachable", sessions: [], message: "No route" }]);

		host.refuse = { ok: false, code: "HOST_KEY_CHANGED", message: "Changed" };
		expect((await lister.list([linux]))[0]!.state).toBe("identity-changed");

		host.refuse = null;
		host.locked = true;
		unlockAnswer = false;
		expect((await lister.list([linux]))[0]!.state).toBe("locked");
	});

	it("drops the connection when reading the computer fails, so the next refresh reconnects", async () => {
		await lister.list([linux]);
		host.listFailure = { ok: false, code: "NOT_CONNECTED", message: "closed" };
		expect((await lister.list([linux]))[0]).toMatchObject({ state: "unreachable" });
		expect(host.disconnected).toEqual(["conn-1"]);
	});

	it("reuses tunnels and reads the history again only when the session changed", async () => {
		host.registry("100.64.0.1", entry("a", 1, "/w/one"));
		http.states.set(1, state("a", { lastSeq: 5 }));
		http.histories.set(1, [message("assistant", "first")]);
		await lister.list([linux]);
		await lister.list([linux]);
		expect(host.forwards).toHaveLength(1);
		expect(http.calls.filter((c) => c.includes("/history"))).toHaveLength(1);

		http.states.set(1, state("a", { lastSeq: 6 }));
		http.histories.set(1, [message("assistant", "second")]);
		const [computer] = await lister.list([linux]);
		expect(computer!.sessions[0]!.lastMessage).toBe("second");
	});

	it("tries a new tunnel before deciding that a listed session stopped", async () => {
		host.registry("100.64.0.1", entry("a", 1, "/w/one"));
		http.states.set(1, state("a"));
		await lister.list([linux]);
		const brokenOnce = http.request.bind(http);
		let failures = 1;
		http.request = async (...args) => (failures-- > 0 ? { ok: false, message: "Tunnel closed" } : brokenOnce(...args));
		const [computer] = await lister.list([linux]);
		expect(computer!.sessions.map((s) => s.bridgeInstanceId)).toEqual(["a"]);
		expect(host.closedForwards).toEqual(["fwd-1"]);
		expect(host.forwards).toHaveLength(2);
	});

	it("closes the tunnel of a bridge that stopped", async () => {
		host.registry("100.64.0.1", entry("a", 1, "/w/one"));
		http.states.set(1, state("a"));
		await lister.list([linux]);
		host.registry("100.64.0.1");
		const [computer] = await lister.list([linux]);
		expect(computer!.state).toBe("no-pi");
		expect(host.closedForwards).toEqual(["fwd-1"]);
	});

	it("shares a refresh that is already running", async () => {
		host.registry("100.64.0.1", entry("a", 1, "/w/one"));
		http.states.set(1, state("a"));
		const [first, second] = await Promise.all([lister.list([linux]), lister.list([linux])]);
		expect(first).toBe(second);
		expect(http.calls.filter((c) => c.includes("/state"))).toHaveLength(1);
	});

	it("keeps the computers in the order given", async () => {
		const result = await lister.list([windows, linux]);
		expect(result.map((c) => c.hostId)).toEqual(["win", "linux"]);
	});
});
