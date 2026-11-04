import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeResponse, TerminalFocusResponse, PROTOCOL_VERSION } from "@workspace/protocol";
import { BridgeSession } from "../../src/core/bridge-session.ts";
import { startHttpServer, type HttpBridgeServer } from "../../src/adapters/http-server.ts";
import { FakeTerminal } from "../fakes/terminal.ts";

const envelope = { protocolVersion: PROTOCOL_VERSION, bridgeInstanceId: "inst", sessionId: "sess" };
const pi = { sessionId: () => "sess", isIdle: () => true, hasPendingMessages: () => false, model: () => null, imagesBlocked: () => false, history: () => [], send() {}, abort() {} };
const makeSession = (terminal?: FakeTerminal) => new BridgeSession({ pi, instanceId: "inst", capacity: 10, clock: () => 1, ...(terminal ? { terminal } : {}) });
const validInputs = [
	{ kind: "text", text: "hello\nworld", enter: true },
	{ kind: "text", text: "hello", enter: false },
	{ kind: "keys", keys: ["enter", "esc", "ctrl+c", "up"] },
];
const invalidInputs = [null, {}, { kind: "text", text: "", enter: true }, { kind: "text", text: "x" }, { kind: "text", text: "x".repeat(16385), enter: false }, { kind: "keys", keys: [] }, { kind: "keys", keys: ["ctrl+z", "shell"] }, { kind: "keys", keys: Array(33).fill("enter") }];
let terminal: FakeTerminal;
let session: BridgeSession;
beforeEach(() => { terminal = new FakeTerminal(); session = makeSession(terminal); });

describe("terminal session", () => {
	it("advertises availability true or false", () => {
		expect(session.state().terminal).toBe(true);
		expect(makeSession().state().terminal).toBe(false);
	});
	it("reads ANSI with the envelope", async () => {
		expect(await session.terminalScreen()).toEqual({ ok: true, value: { ...envelope, screen: "\u001b[32mhello\u001b[0m" } });
	});
	it.each(validInputs)("sends validated input %j", async (input) => {
		expect(await session.terminalInput(input)).toEqual({ ok: true, value: { ...envelope, status: "sent" } });
		expect(terminal.calls).toEqual([input.kind === "text" ? ["text", input.text, input.enter] : ["keys", input.keys]]);
	});
	it.each(invalidInputs)("rejects invalid input %# without sending", async (input) => {
		expect(await session.terminalInput(input)).toMatchObject({ ok: false, error: { error: { code: "bad_request" } } });
		expect(terminal.calls).toEqual([]);
	});
	it("reports no own Herdr pane", async () => {
		for (const result of [await makeSession().terminalScreen(), await makeSession().terminalInput(validInputs[0])]) {
			expect(result).toMatchObject({ ok: false, error: { error: { code: "not_found", message: expect.stringContaining("Herdr pane") } } });
		}
		expect(terminal.calls).toEqual([]);
	});
	it.each(["failure", "throws"] as const)("safely maps adapter %s for screen and input", async (mode) => {
		terminal[mode] = true;
		for (const result of [await session.terminalScreen(), await session.terminalInput(validInputs[0]), await session.terminalInput(validInputs[2])]) {
			expect(result).toMatchObject({ ok: false, error: { error: { code: "internal" } } });
			expect(JSON.stringify(result)).not.toContain("private");
		}
	});
});

describe("terminal HTTP", () => {
	let server: HttpBridgeServer;
	let base: string;
	const headers = { authorization: `Bearer ${"t".repeat(64)}` };
	beforeEach(async () => {
		server = await startHttpServer({ session, token: "t".repeat(64), maxBodyBytes: 1024, heartbeatMs: 60000 });
		base = `http://127.0.0.1:${server.port}`;
	});
	afterEach(() => server.close());
	const input = (body: unknown) => fetch(`${base}/terminal/input`, { method: "POST", headers, body: JSON.stringify(body) });
	it("focuses only its inherited target and returns the shared response contract", async () => {
		const response = await fetch(`${base}/terminal/focus`, { method: "POST", headers });
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(decodeResponse(TerminalFocusResponse, body).ok).toBe(true);
		expect(body).toEqual({ ...envelope, status: "focused" });
		expect(terminal.calls).toEqual([["focus"]]);
	});
	it("never passes a request-selected target to the terminal port", async () => {
		const response = await fetch(`${base}/terminal/focus`, { method: "POST", headers, body: JSON.stringify({ pane: "other:p2", workspace: "other", tab: "other:t2" }) });
		expect(response.status).toBe(200);
		expect(terminal.calls).toEqual([["focus"]]);
	});
	it.each(["failure", "throws"] as const)("safely maps focus %s", async mode => {
		terminal[mode] = true;
		const response = await fetch(`${base}/terminal/focus`, { method: "POST", headers });
		expect(response.status).toBe(500); expect(await response.text()).not.toContain("private");
	});
	it("returns the screen and capability", async () => {
		const response = await fetch(`${base}/terminal`, { headers });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ...envelope, screen: "\u001b[32mhello\u001b[0m" });
		expect(await (await fetch(`${base}/state`, { headers })).json()).toMatchObject({ terminal: true });
	});
	it.each(validInputs)("accepts input %j", async (body) => {
		const response = await input(body);
		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({ ...envelope, status: "sent" });
		expect(terminal.calls).toHaveLength(1);
	});
	it.each(invalidInputs.filter((body) => !JSON.stringify(body).includes("x".repeat(100))))("rejects invalid input %# with 400", async (body) => {
		expect((await input(body)).status).toBe(400);
		expect(terminal.calls).toEqual([]);
	});
	it("keeps the body limit and rejects malformed JSON", async () => {
		expect((await input({ kind: "text", text: "x".repeat(2000), enter: true })).status).toBe(413);
		expect((await fetch(`${base}/terminal/input`, { method: "POST", headers, body: "{" })).status).toBe(400);
		expect(terminal.calls).toEqual([]);
	});
	it("maps adapter failures to 500 without leaking details", async () => {
		terminal.failure = true;
		for (const response of [await fetch(`${base}/terminal`, { headers }), await input(validInputs[0])]) {
			expect(response.status).toBe(500);
			expect(await response.text()).not.toContain("private");
		}
	});
	it("returns 404 without a terminal", async () => {
		await server.close();
		server = await startHttpServer({ session: makeSession(), token: "t".repeat(64), maxBodyBytes: 1024, heartbeatMs: 60000 });
		base = `http://127.0.0.1:${server.port}`;
		expect((await fetch(`${base}/terminal`, { headers })).status).toBe(404);
		expect((await fetch(`${base}/terminal/focus`, { method: "POST", headers })).status).toBe(404);
		expect((await input(validInputs[0])).status).toBe(404);
		expect(terminal.calls).toEqual([]);
	});
	it("requires the token for both routes", async () => {
		for (const [path, method] of [["/terminal", "GET"], ["/terminal/input", "POST"], ["/terminal/focus", "POST"]] as const) {
			expect((await fetch(`${base}${path}`, { method })).status).toBe(401);
		}
		expect(terminal.calls).toEqual([]);
	});
});
