import { beforeEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, REGISTRY_DIRECTORY, type RegistryEntry, type StateResponse } from "@workspace/protocol";
import { bridgeClient, type BridgeEndpoint, type BridgeHttp, type HttpResult } from "../src/core/bridge-client";
import { HostConnections } from "../src/core/host-connections";
import type { DirEntry, Failure, HostConnection } from "../src/core/ports";
import { groupSessions, SessionLister, summaryCapabilities, type ComputerSessions, type SessionSummary } from "../src/core/session-list";
import { orderSessions } from "../src/core/session-order";
import { openSessionTarget, type SessionOpenDeps } from "../src/core/session-open";
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

describe("outcome discovery", () => {
	it("carries the latest outcome with its instance-local seq, but leaves legacy bridges unknown", async () => {
		host.registry(linux.address, entry("a", 1234, "/work/a"));
		http.states.set(1234, state("a", { lastOutcome: { outcome: "failed", seq: 5 } }));
		expect((await lister.list([linux]))[0].sessions[0].lastOutcome).toEqual({ outcome: "failed", seq: 5 });
		http.states.set(1234, state("a", { protocolVersion: "1.5" }));
		expect((await lister.list([linux]))[0].sessions[0]).not.toHaveProperty("lastOutcome");
	});
});

describe("pane discovery", () => {
 it('marks a live session for /reload from its registry protocol minor, not the host release', async () => {
  host.registry(linux.address, { ...entry('a', 1234, '/work/a'), protocolVersion: '1.4' });
  http.states.set(1234, state('a'));
  const first = await lister.list([linux]);
  expect(first[0]!.sessions[0]).toMatchObject({ reloadNeeded: true });
  host.registry(linux.address, entry('a', 1234, '/work/a'));
  expect((await lister.list([linux]))[0]!.sessions[0]!.reloadNeeded).toBeUndefined();
 });
 it("refreshes captured pane metadata and accepts older bridge snapshots", async () => {
  host.registry(linux.address, entry("a", 1234, "/work/a"));
  http.states.set(1234, state("a", { terminal: true, terminalPane: "w2G:p2" }));
  expect((await lister.list([linux]))[0].sessions[0].terminalPane).toBe("w2G:p2");
  http.states.set(1234, state("a", { protocolVersion: "1.4" }));
  expect((await lister.list([linux]))[0].sessions[0]).not.toHaveProperty("terminalPane");
 });
 it("marks a session that runs in a terminal even when its bridge does not report the pane", async () => {
  host.registry(linux.address, entry("a", 1234, "/work/a"));
  // A Pi session started before its bridge reported terminalPane still drives its Herdr pane.
  http.states.set(1234, state("a", { terminal: true }));
  const [listed] = (await lister.list([linux]))[0].sessions;
  expect(listed).toMatchObject({ terminal: true });
  expect(listed).not.toHaveProperty("terminalPane");
  http.states.set(1234, state("a"));
  expect((await lister.list([linux]))[0].sessions[0]).not.toHaveProperty("terminal");
 });
});

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

	it("carries the bounded subagents and leaves them out when absent, unavailable, empty, or malformed (S3, S6)", async () => {
		const sub = (id: string, extra: Record<string, unknown> = {}) => ({ id, agent: "explore", label: `Task ${id}`, status: "running", question: false, since: 1000, ...extra });
		host.registry(
			"100.64.0.1",
			entry("a", 1, "/w/with"), entry("b", 2, "/w/old"), entry("c", 3, "/w/none"), entry("d", 4, "/w/empty"), entry("e", 5, "/w/broken"),
		);
		http.states.set(1, state("a", { idle: false, subagents: { available: true, items: [sub("s1"), sub("s2", { status: "queued" }), { id: "" }] } }));
		http.states.set(2, state("b", { idle: false }));
		http.states.set(3, state("c", { subagents: { available: false, items: [sub("s3")] } }));
		http.states.set(4, state("d", { subagents: { available: true, items: [] } }));
		http.states.set(5, state("e", { subagents: "nonsense" }));

		const [computer] = await lister.list([linux]);
		const byKey = new Map(computer!.sessions.map((s) => [s.key, s]));

		expect(byKey.get("linux/a")!.subagents).toEqual([sub("s1"), sub("s2", { status: "queued" })]);
		expect(byKey.get("linux/a")!.status).toBe("working");
		// An older bridge sends no field: the summary is exactly as before, with no subagents key.
		expect(byKey.get("linux/b")).toEqual({ key: "linux/b", hostId: "linux", bridgeInstanceId: "b", project: "old", cwd: "/w/old", status: "working", lastActivityAt: 5000, lastMessage: null });
		for (const key of ["linux/c", "linux/d", "linux/e"]) {
			expect(byKey.get(key)).not.toHaveProperty("subagents");
			expect(byKey.get(key)!.status).toBe("done");
		}
	});

	it("needs the user when a subagent asks a question, even while the parent works (S5)", async () => {
		const sub = (id: string, extra: Record<string, unknown> = {}) => ({ id, agent: "worker", label: id, status: "waiting", question: false, since: 1000, ...extra });
		host.registry("100.64.0.1", entry("a", 1, "/w/asks"), entry("b", 2, "/w/waits"), entry("c", 3, "/w/idle-asks"));
		http.states.set(1, state("a", { idle: false, subagents: { available: true, items: [sub("s1", { status: "running" }), sub("s2", { question: true })] } }));
		http.states.set(2, state("b", { idle: false, subagents: { available: true, items: [sub("s3")] } }));
		http.states.set(3, state("c", { idle: true, subagents: { available: true, items: [sub("s4", { question: true })] } }));

		const [computer] = await lister.list([linux]);
		const status = Object.fromEntries(computer!.sessions.map((s) => [s.key, s.status]));

		expect(status).toEqual({ "linux/a": "attention", "linux/b": "working", "linux/c": "attention" });
	});

	it("keeps the computers in the order given", async () => {
		const result = await lister.list([windows, linux]);
		expect(result.map((c) => c.hostId)).toEqual(["win", "linux"]);
	});
});

describe("agents, capabilities and approvals (claude-codex T3b)", () => {
	const claudeCaps = { message: true, steer: false, abort: true, attachments: false, terminal: true, approvals: true };
	const ask = { id: "a1", kind: "command", title: "Run tests", detail: "pnpm test", choices: ["accept", "acceptForSession", "decline"] };

	it("adds nothing to a legacy Pi session, and no /reload hint for a 1.8 Pi bridge under a 1.9 app (S5)", async () => {
		host.registry(linux.address, { ...entry("a", 1, "/work/a"), protocolVersion: "1.8" });
		http.states.set(1, state("a"));
		const [session] = (await lister.list([linux]))[0]!.sessions;
		expect(session).toEqual({ key: "linux/a", hostId: "linux", bridgeInstanceId: "a", project: "a", cwd: "/work/a", status: "done", lastActivityAt: 5000, lastMessage: null });
	});

	it("still asks an older Pi bridge for /reload", async () => {
		host.registry(linux.address, { ...entry("a", 1, "/work/a"), protocolVersion: "1.7" });
		http.states.set(1, state("a"));
		expect((await lister.list([linux]))[0]!.sessions[0]!.reloadNeeded).toBe(true);
	});

	it("carries the agent, its capabilities and pending approvals, and approvals need the user", async () => {
		host.registry(linux.address, { ...entry("c", 1, "/work/c"), protocolVersion: "1.0", agent: "claude-code", capabilities: claudeCaps });
		http.states.set(1, state("c", { idle: false, approvals: [ask, { id: "" }] } as Partial<StateResponse>));
		const [session] = (await lister.list([linux]))[0]!.sessions;
		// Not Pi: /reload means nothing to it, whatever its protocol.
		expect(session).not.toHaveProperty("reloadNeeded");
		expect(session).toMatchObject({ agent: "claude-code", capabilities: claudeCaps, status: "attention", approvals: [ask] });
	});

	it("lets the state override the registry entry, and gives Codex without capabilities nothing", async () => {
		host.registry(linux.address, { ...entry("x", 1, "/work/x"), agent: "codex" }, { ...entry("p", 2, "/work/p"), capabilities: { attachments: false } });
		http.states.set(1, state("x"));
		http.states.set(2, state("p", { capabilities: { attachments: false, steer: false } } as Partial<StateResponse>));
		const sessions = (await lister.list([linux]))[0]!.sessions;
		const codex = sessions.find((s) => s.bridgeInstanceId === "x")!;
		const pi = sessions.find((s) => s.bridgeInstanceId === "p")!;
		expect(codex).toMatchObject({ agent: "codex", capabilities: { message: false, steer: false, abort: false, attachments: false, terminal: false, approvals: false } });
		expect(summaryCapabilities(codex).message).toBe(false);
		expect(pi).not.toHaveProperty("agent");
		expect(pi.capabilities).toEqual({ message: true, steer: false, abort: true, attachments: false, terminal: true, approvals: false });
		expect(summaryCapabilities({})).toMatchObject({ message: true, attachments: true, approvals: false });
	});
});

// claude-codex-support L19: a Claude Code bridge restarts with a new instance (and port) while Pi bridges keep theirs, so
// a Home card can hold a key whose bridge is gone. Opening it must refresh once and reach the same session's pane.
describe("opening a session from a possibly stale card", () => {
	const caps = { message: true, steer: true, abort: true, attachments: false, terminal: true, approvals: true };
	const claude = (id: string, port: number, sessionId: string, pane = "w3D:pW") => {
		const registered = { ...entry(id, port, "/work/mars-ram"), sessionId, agent: "claude-code", capabilities: caps } as RegistryEntry;
		http.states.set(port, state(id, { sessionId, terminal: true, terminalPane: pane, agent: "claude-code", capabilities: caps } as Partial<StateResponse>));
		return registered;
	};
	let listings = 0;
	/** Like services' sessionEndpoint: the listed tunnel, or a listing when unknown or asked fresh. */
	const deps = (overrides: Partial<SessionOpenDeps> = {}): SessionOpenDeps => ({
		endpoint: async (key, fresh) => {
			const known = fresh ? null : lister.endpoint(key);
			if (known) return known;
			listings++;
			const [computer] = await lister.list([linux]);
			if (computer!.state !== "ok" && computer!.state !== "no-pi") return "unreachable";
			return lister.endpoint(key) ?? "gone";
		},
		state: (endpoint: BridgeEndpoint) => bridgeClient.state(http, endpoint),
		successor: (key) => lister.successor(key),
		...overrides,
	});
	beforeEach(() => { listings = 0; });

	it("opens a live card's own pane with no extra listing", async () => {
		host.registry(linux.address, claude("a", 1234, "claude-1"));
		await lister.list([linux]);
		expect(await openSessionTarget("linux/a", deps())).toEqual({ key: "linux/a", terminal: true });
		expect(listings).toBe(0);
	});

	it("follows a restarted bridge of the same Claude Code session instead of failing", async () => {
		host.registry(linux.address, claude("old", 1234, "claude-1"));
		await lister.list([linux]);
		// The bridge restarts: same session and pane, new instance and port; the old one no longer answers.
		http.down.add(1234);
		host.registry(linux.address, claude("new", 1300, "claude-1"));
		expect(await openSessionTarget("linux/old", deps())).toEqual({ key: "linux/new", terminal: true });
		expect(listings).toBe(1);
	});

	it("follows the session now in the card's pane when the agent started a new session there (/clear)", async () => {
		host.registry(linux.address, claude("old", 1234, "claude-1"), { ...entry("pi", 1400, "/work/other"), sessionId: "pi-1" });
		http.states.set(1400, state("pi", { sessionId: "pi-1", terminal: true, terminalPane: "w3H:p1" }));
		await lister.list([linux]);
		http.down.add(1234);
		host.registry(linux.address, claude("new", 1300, "claude-2"), { ...entry("pi", 1400, "/work/other"), sessionId: "pi-1" });
		expect(await openSessionTarget("linux/old", deps())).toEqual({ key: "linux/new", terminal: true });
	});

	it("retries a broken tunnel once with a fresh listing and keeps the same session", async () => {
		host.registry(linux.address, claude("a", 1234, "claude-1"));
		await lister.list([linux]);
		let calls = 0;
		const flaky = deps({ state: async (endpoint) => (++calls === 1 ? { ok: false, reason: "unreachable", message: "closed" } : bridgeClient.state(http, endpoint)) });
		expect(await openSessionTarget("linux/a", flaky)).toEqual({ key: "linux/a", terminal: true });
		expect(listings).toBe(1);
	});

	it("gives up after one refresh when the session ended, or its successor is ambiguous", async () => {
		host.registry(linux.address, claude("old", 1234, "claude-1"));
		await lister.list([linux]);
		http.down.add(1234);
		host.registry(linux.address);
		expect(await openSessionTarget("linux/old", deps())).toBeNull();
		expect(listings).toBe(1);

		host.registry(linux.address, claude("old", 1234, "claude-1"));
		http.down.delete(1234);
		await lister.list([linux]);
		http.down.add(1234);
		host.registry(linux.address, claude("n1", 1300, "claude-1", "w3D:p1"), claude("n2", 1301, "claude-1", "w3D:p2"));
		expect(await openSessionTarget("linux/old", deps())).toBeNull();
	});

	it("opens a session outside a drivable pane as chat", async () => {
		host.registry(linux.address, { ...entry("c", 1234, "/work/c"), agent: "claude-code", capabilities: { ...caps, terminal: false } } as RegistryEntry);
		http.states.set(1234, state("c", { terminal: false, agent: "claude-code", capabilities: { ...caps, terminal: false } } as Partial<StateResponse>));
		await lister.list([linux]);
		expect(await openSessionTarget("linux/c", deps())).toEqual({ key: "linux/c", terminal: false });
	});

	it("reports an unreachable computer as unknown, never as a different session", async () => {
		host.registry(linux.address, claude("a", 1234, "claude-1"));
		await lister.list([linux]);
		http.down.add(1234);
		host.listFailure = { ok: false, code: "SSH_ERROR", message: "down" };
		expect(await openSessionTarget("linux/a", deps())).toBeNull();
	});
});

// claude-codex L21 (bug 5): a Pi and a Claude Code session in the same folder and Herdr tab must both be listed.
describe("two live sessions in the same folder and tab", () => {
	const cwd = "/home/alex/Work/mars-ram";
	const claudeCaps = { message: true, steer: false, abort: true, attachments: false, terminal: true, approvals: true };
	function setup() {
		host.registry(linux.address, entry("pi", 1111, cwd, 100), { ...entry("cc", 2222, cwd, 200), agent: "claude-code", capabilities: claudeCaps });
		http.states.set(1111, state("pi", { terminal: true, terminalPane: "w3D:p1", idle: true, lastActivityAt: 9000 }));
		http.states.set(2222, state("cc", {
			agent: "claude-code", capabilities: claudeCaps, terminal: true, terminalPane: "w3D:pW", activity: null, idle: true,
			pendingPrompt: { kind: "input", title: "Claude is waiting for your input" }, model: null, approvals: [], lastActivityAt: 4000,
		}));
	}
	const keysOf = (list: SessionSummary[]) => list.map((item) => item.key).sort();
	it("lists both, each with its own key and pane", async () => {
		setup();
		const [computer] = await lister.list([linux]);
		expect(computer.sessions.map((item) => [item.key, item.project, item.terminalPane, item.agent]).sort()).toEqual([
			["linux/cc", "mars-ram", "w3D:pW", "claude-code"],
			["linux/pi", "mars-ram", "w3D:p1", undefined],
		]);
	});
	it("keeps both on Home across refreshes", async () => {
		setup();
		let order = groupSessions(initialOrder, await lister.list([linux]), "focus");
		for (let i = 0; i < 3; i++) order = groupSessions(order, await lister.list([linux]), "automatic");
		expect(keysOf([...order.needsYou, ...order.computers.flatMap((c) => c.sessions)])).toEqual(["linux/cc", "linux/pi"]);
	});
	it("an idle Claude Code session waiting for input is done, not «Te necesita»", async () => {
		setup();
		const [computer] = await lister.list([linux]);
		expect(computer.sessions.find((item) => item.key === "linux/cc")!.status).toBe("done");
	});
});
