import { request } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@workspace/protocol";
import { type HttpBridgeServer, startHttpServer } from "../../src/adapters/http-server.ts";
import { BridgeSession } from "../../src/core/bridge-session.ts";
import type { OutgoingContent, PiSessionPort } from "../../src/core/ports.ts";

class FakePiSession implements PiSessionPort {
	idle = true;
	sent: OutgoingContent[] = [];
	sessionId = () => "sess-1";
	isIdle = () => this.idle;
	hasPendingMessages = () => false;
	model = () => null;
	imagesBlocked = () => false;
	history = () => [];
	send(content: OutgoingContent) {
		this.sent.push(content);
	}
	abort() {}
}

const TOKEN = "t".repeat(64);
const envelope = { protocolVersion: PROTOCOL_VERSION, bridgeInstanceId: "inst-1", sessionId: "sess-1" };
let pi: FakePiSession;
let session: BridgeSession;
let server: HttpBridgeServer;
let base: string;

beforeEach(async () => {
	pi = new FakePiSession();
	session = new BridgeSession({ pi, instanceId: "inst-1", capacity: 100, clock: () => 1 });
	server = await startHttpServer({ session, token: TOKEN, maxBodyBytes: 1024, heartbeatMs: 60_000 });
	base = `http://127.0.0.1:${server.port}`;
});

afterEach(() => server.close());

const auth = (token = TOKEN) => ({ authorization: `Bearer ${token}` });

describe("authentication", () => {
	it.each([
		["no token", {}],
		["a wrong token of the same length", auth("x".repeat(64))],
		["a shorter token", auth("t")],
	])("rejects a request with %s and changes nothing", async (_name, headers) => {
		const res = await fetch(`${base}/message`, { method: "POST", headers, body: JSON.stringify({ text: "hi" }) });
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ ...envelope, error: { code: "unauthorized", message: "Missing or invalid token." } });
		expect(pi.sent).toEqual([]);
		expect(session.state().lastSeq).toBe(0);
	});

	it("accepts the right token", async () => {
		const res = await fetch(`${base}/state`, { headers: auth() });
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ...envelope, idle: true });
	});
});

describe("listening address", () => {
	it("listens only on the loopback address", () => {
		expect(server.address).toBe("127.0.0.1");
	});
});

describe("messages", () => {
	it("sends a message and answers with its status", async () => {
		const res = await fetch(`${base}/message`, { method: "POST", headers: auth(), body: JSON.stringify({ text: "hi" }) });
		expect(res.status).toBe(202);
		expect(await res.json()).toEqual({ ...envelope, status: "submitted" });
		expect(pi.sent).toEqual([{ text: "hi", images: [] }]);
	});

	it("rejects malformed JSON without sending", async () => {
		const res = await fetch(`${base}/message`, { method: "POST", headers: auth(), body: "{not json" });
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: { code: "bad_request" } });
		expect(pi.sent).toEqual([]);
	});

	it("rejects a body over the size limit without sending", async () => {
		const res = await fetch(`${base}/message`, { method: "POST", headers: auth(), body: JSON.stringify({ text: "x".repeat(2000) }) });
		expect(res.status).toBe(413);
		expect(await res.json()).toMatchObject({ error: { code: "too_large" } });
		expect(pi.sent).toEqual([]);
	});

	it("answers an unknown route with not_found without repeating the request", async () => {
		const res = await fetch(`${base}/${TOKEN}`, { headers: auth() });
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body).toMatchObject({ error: { code: "not_found", message: "No such route." } });
		expect(JSON.stringify(body)).not.toContain(TOKEN);
	});
});

describe("event stream", () => {
	it("starts with a replay header, replays events after the cursor, then streams live events", async () => {
		session.record({ type: "agent_start" });
		session.record({ type: "turn_start", turnIndex: 0 });
		const controller = new AbortController();
		const res = await fetch(`${base}/events?since=1`, { headers: auth(), signal: controller.signal });
		expect(res.headers.get("content-type")).toBe("text/event-stream");
		const reader = res.body!.getReader();
		const decoder = new TextDecoder();
		let text = "";
		const readUntil = async (needle: string) => {
			while (!text.includes(needle)) text += decoder.decode((await reader.read()).value);
		};
		await readUntil('"turnIndex":0');
		session.record({ type: "agent_end", pendingMessages: false });
		await readUntil("agent_end");
		controller.abort();
		const blocks = text.trim().split("\n\n");
		expect(blocks[0]).toBe(`event: replay\ndata: ${JSON.stringify({ ...envelope, since: 1, oldestSeq: 1, gap: false })}`);
		expect(blocks[1]).toBe(`id: 2\ndata: ${JSON.stringify({ type: "turn_start", turnIndex: 0, seq: 2, at: 1 })}`);
		expect(blocks[2]).toBe(`id: 3\ndata: ${JSON.stringify({ type: "agent_end", pendingMessages: false, seq: 3, at: 1 })}`);
	});

	it("delivers a replay larger than the stream buffer to a client that keeps reading", async () => {
		const chunk = "x".repeat(64 * 1024);
		for (let i = 0; i < 40; i++) session.record({ type: "text_delta", delta: chunk });
		const res = await fetch(`${base}/events?since=0`, { headers: auth() });
		const reader = res.body!.getReader();
		const decoder = new TextDecoder();
		let text = "";
		while (!text.includes("id: 40\n")) {
			const { value, done } = await reader.read();
			if (done) throw new Error("The stream closed before the replay finished.");
			text += decoder.decode(value, { stream: true });
		}
		await reader.cancel();
		const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
		expect(ids).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
	});

	it("reports the gap and replays the retained events when reconnecting with a cursor older than the log", async () => {
		for (let i = 0; i < 105; i++) session.record({ type: "agent_start" });
		const res = await fetch(`${base}/events?since=1`, { headers: auth() });
		const reader = res.body!.getReader();
		const decoder = new TextDecoder();
		let text = "";
		while (!text.includes("id: 105\n")) {
			const { value, done } = await reader.read();
			if (done) throw new Error("The stream closed before the retained events arrived.");
			text += decoder.decode(value, { stream: true });
		}
		await reader.cancel();
		expect(text.split("\n\n")[0]).toBe(`event: replay\ndata: ${JSON.stringify({ ...envelope, since: 1, oldestSeq: 6, gap: true })}`);
		const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
		expect(ids).toEqual(Array.from({ length: 100 }, (_, i) => i + 6));
	});

	it("keeps a stalled client's buffer bounded, and disconnects it once it falls behind the retained log", async () => {
		let response: import("node:http").IncomingMessage | undefined;
		const connected = new Promise<void>((resolve) => {
			request(`${base}/events`, { headers: auth() }, (res) => {
				response = res;
				res.pause();
				resolve();
			}).end();
		});
		await connected;
		const chunk = "x".repeat(64 * 1024);
		for (let i = 0; i < 400; i++) session.record({ type: "text_delta", delta: chunk });
		expect(server.bufferedBytes()).toBeLessThan(1024 * 1024);
		const closed = new Promise<void>((resolve) => response!.on("close", () => resolve()));
		response!.resume();
		await closed;
		await expect.poll(() => server.openStreams()).toBe(0);
	});

	it("rejects a cursor that is not a whole number", async () => {
		const res = await fetch(`${base}/events?since=abc`, { headers: auth() });
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: { code: "bad_request" } });
	});
});
