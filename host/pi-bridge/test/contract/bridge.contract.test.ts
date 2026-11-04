// Contract tests: the real bridge inside a disposable Pi session must speak
// the protocol exactly as the app expects. No model calls unless
// RUN_MODEL_TESTS=1 (with PI_TEST_MODEL=<provider/model>), which also proves
// send, steer, stop, and images.
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	AbortResponse,
	checkCompatibility,
	decodeResponse,
	ErrorResponse,
	HistoryResponse,
	ReplayHeader,
	type RegistryEntry,
	SendMessageResponse,
	StateResponse,
} from "@workspace/protocol";
import { client, type PiSession, startPiSession } from "./pi-session.ts";

let pi: PiSession;
let entry: RegistryEntry;

beforeAll(async () => {
	pi = await startPiSession();
	entry = pi.entries()[0]!;
});

afterAll(async () => {
	await pi?.stop();
});

const expectDecodes = async (schema: Parameters<typeof decodeResponse>[0], res: Response, status: number) => {
	expect(res.status).toBe(status);
	const decoded = decodeResponse(schema, await res.json());
	if (!decoded.ok) throw new Error(decoded.errors.join("; "));
	return decoded.value as Record<string, unknown>;
};

describe("registry", () => {
	it("publishes one entry for the session, with a compatible protocol version", () => {
		expect(pi.entries()).toHaveLength(1);
		expect(checkCompatibility(entry.protocolVersion)).toEqual({ ok: true });
	});

	it.skipIf(process.platform === "win32")("restricts the entry and its directory to the host user", () => {
		expect(statSync(join(pi.registry, `${entry.bridgeInstanceId}.json`)).mode & 0o777).toBe(0o600);
		expect(statSync(pi.registry).mode & 0o777).toBe(0o700);
	});
});

describe("background subagents", () => {
	it("publishes nothing for an RPC session started without PI_BRIDGE_HEADLESS", async () => {
		const subagent = await startPiSession({ headless: false });
		try {
			expect(subagent.entries()).toEqual([]);
		} finally {
			await subagent.stop();
		}
	});
});

describe("responses", () => {
	it("serves state with the envelope of the registered instance", async () => {
		const state = await expectDecodes(StateResponse, await client(entry).get("/state"), 200);
		expect(state).toMatchObject({ bridgeInstanceId: entry.bridgeInstanceId, sessionId: entry.sessionId, idle: true, activity: null });
	});

	it("reports terminal unavailable outside Herdr and rejects terminal operations", async () => {
		const c = client(entry);
		expect(await expectDecodes(StateResponse, await c.get("/state"), 200)).toMatchObject({ terminal: false });
		for (const response of [await c.get("/terminal"), await c.post("/terminal/input", { kind: "text", text: "never sent", enter: true }), await c.post("/terminal/focus")]) {
			expect((await expectDecodes(ErrorResponse, response, 404)).error).toMatchObject({ code: "not_found", message: expect.stringContaining("Herdr pane") });
		}
	});

	it("validates terminal input and authenticates the terminal routes", async () => {
		const c = client(entry);
		expect((await expectDecodes(ErrorResponse, await c.post("/terminal/input", { kind: "keys", keys: ["shell"] }), 400)).error).toMatchObject({ code: "bad_request" });
		for (const path of ["/terminal", "/terminal/input", "/terminal/focus"]) {
			expect((await expectDecodes(ErrorResponse, await c.raw(path), 401)).error).toMatchObject({ code: "unauthorized" });
		}
	});

	it("authenticates a focus POST before attempting the terminal operation", async () => {
		const response = await client(entry).raw("/terminal/focus", { method: "POST" });
		expect((await expectDecodes(ErrorResponse, response, 401)).error).toMatchObject({ code: "unauthorized" });
	});

	it("sends nothing when an attachment is not in the uploads folder", async () => {
		const c = client(entry);
		const before = ((await (await c.get("/state")).json()) as { lastSeq: number }).lastSeq;
		const error = (await expectDecodes(ErrorResponse, await c.post("/message", { text: "never sent", attachments: ["missing.png"] }), 404)).error;
		expect(error).toEqual({ code: "not_found", message: "An attachment is not on the computer: missing.png. Attach it again." });
		const bad = await c.post("/message", { attachments: ["../registry"] });
		expect((await expectDecodes(ErrorResponse, bad, 400)).error).toMatchObject({ code: "bad_request" });
		expect(((await (await c.get("/state")).json()) as { lastSeq: number }).lastSeq).toBe(before);
	});

	it("serves history", async () => {
		await expectDecodes(HistoryResponse, await client(entry).get("/history"), 200);
	});

	it("answers a stop request while idle without stopping anything", async () => {
		expect(await expectDecodes(AbortResponse, await client(entry).post("/abort"), 202)).toMatchObject({ status: "idle" });
	});

	it("rejects a request without the token", async () => {
		const res = await client(entry).raw("/state");
		expect((await expectDecodes(ErrorResponse, res, 401)).error).toMatchObject({ code: "unauthorized" });
	});

	it("rejects an empty message without starting a run", async () => {
		const res = await client(entry).post("/message", {});
		expect((await expectDecodes(ErrorResponse, res, 400)).error).toMatchObject({ code: "bad_request" });
		const state = await expectDecodes(StateResponse, await client(entry).get("/state"), 200);
		expect(state).toMatchObject({ idle: true, pendingMessages: false });
	});
});

describe("event stream", () => {
	it("replays from the start of the instance, beginning with session_start", async () => {
		const { header, events } = await client(entry).events(0, () => true);
		expect(decodeResponse(ReplayHeader, header).ok).toBe(true);
		expect(header).toMatchObject({ since: 0, gap: false, bridgeInstanceId: entry.bridgeInstanceId });
		expect(events[0]).toMatchObject({ seq: 1, type: "session_start", reason: "startup" });
	});
});

describe.runIf(process.env.RUN_MODEL_TESTS === "1")("with model calls", () => {
	it("sends a message into the same session and streams the answer", async () => {
		const c = client(entry);
		const since = ((await (await c.get("/state")).json()) as { lastSeq: number }).lastSeq;
		const sent = await expectDecodes(SendMessageResponse, await c.post("/message", { text: "Reply with exactly: CONTRACT-OK" }), 202);
		expect(sent).toMatchObject({ status: "submitted" });
		const { events } = await c.events(since, (e) => e.type === "agent_settled");
		const answer = events.find((e) => e.type === "message_end" && e.message.role === "assistant");
		expect(answer).toMatchObject({ message: { text: "CONTRACT-OK" } });
	}, 120_000);

	it("queues a message as steering while busy, then stops the run", async () => {
		const c = client(entry);
		const since = ((await (await c.get("/state")).json()) as { lastSeq: number }).lastSeq;
		await c.post("/message", { text: "Run the bash command 'sleep 30; echo DONE' and then reply DONE." });
		await c.events(since, (e) => e.type === "tool_start");
		const queued = await expectDecodes(SendMessageResponse, await c.post("/message", { text: "QUEUED-BEFORE-STOP" }), 202);
		expect(queued).toMatchObject({ status: "queued" });
		expect(await expectDecodes(AbortResponse, await c.post("/abort"), 202)).toMatchObject({ status: "requested" });
		const { events } = await c.events(since, (e) => e.type === "agent_settled");
		expect(events.at(-1)).toMatchObject({ type: "agent_settled", aborted: true });
	}, 120_000);

	it("delivers a native image the model can read", async () => {
		const c = client(entry);
		const since = ((await (await c.get("/state")).json()) as { lastSeq: number }).lastSeq;
		const image = readFileSync(join(import.meta.dirname, "fixtures", "zorro-7351.png")).toString("base64");
		await c.post("/message", {
			text: "Do not use any tools. What exact text is written in the attached image? Reply with only that text.",
			images: [{ data: image, mimeType: "image/png" }],
		});
		const { events } = await c.events(since, (e) => e.type === "agent_settled");
		const answer = events.find((e) => e.type === "message_end" && e.message.role === "assistant");
		expect(answer).toMatchObject({ message: { text: expect.stringContaining("ZORRO-7351") } });
	}, 120_000);

	it("attaches an uploaded image natively and gives the agent its path", async () => {
		const c = client(entry);
		const since = ((await (await c.get("/state")).json()) as { lastSeq: number }).lastSeq;
		mkdirSync(pi.uploads, { recursive: true });
		copyFileSync(join(import.meta.dirname, "fixtures", "zorro-7351.png"), join(pi.uploads, "upload-zorro.png"));
		const sent = await expectDecodes(
			SendMessageResponse,
			await c.post("/message", {
				text: "Do not use any tools. Reply with the exact text written in the attached image, then the file name of the attachment.",
				attachments: ["upload-zorro.png"],
			}),
			202,
		);
		expect(sent).toMatchObject({ attachments: { files: 1, imagesAttached: 1, imagesWithheld: "none" } });
		const { events } = await c.events(since, (e) => e.type === "agent_settled");
		const answer = events.find((e) => e.type === "message_end" && e.message.role === "assistant");
		expect(answer).toMatchObject({ message: { text: expect.stringMatching(/ZORRO-7351[\s\S]*upload-zorro\.png/) } });
	}, 120_000);
});

describe("lifecycle", () => {
	it("creates a new instance for a new session and removes the old entry", async () => {
		const old = entry;
		pi.rpc({ type: "new_session" });
		const [next] = await pi.waitForEntries((e) => e.length === 1 && e[0]!.bridgeInstanceId !== old.bridgeInstanceId);
		expect(next!.sessionId).not.toBe(old.sessionId);
		expect(pi.entries()).toHaveLength(1);
		await expect(fetch(`http://127.0.0.1:${old.port}/state`)).rejects.toThrow();
		entry = next!;
	});

	it("removes its entry when Pi exits", async () => {
		const registry = pi.registry;
		const exited = new Promise((r) => pi.process.once("exit", r));
		pi.process.stdin?.end();
		await exited;
		expect(pi.entries()).toEqual([]);
		expect(registry).toBeTruthy();
	});
});
