// Feasibility spike: expose the live Pi session this extension is loaded into
// to a local client. Not product code. See README.md.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type BridgeEvent = { seq: number; at: number; type: string; [key: string]: unknown };

const RING_SIZE = 1000;
const MAX_BODY_BYTES = 20 * 1024 * 1024;

export default function bridge(pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let server: Server | undefined;
	let token = "";
	let seq = 0;
	const ring: BridgeEvent[] = [];
	const listeners = new Set<ServerResponse>();
	let pendingPrompt: { kind: string; title?: string } | undefined;
	const stateDir = process.env.PI_BRIDGE_DIR ?? join(tmpdir(), `pi-bridge-${process.pid}`);

	const emit = (type: string, data: Record<string, unknown> = {}) => {
		const event: BridgeEvent = { seq: ++seq, at: Date.now(), type, ...data };
		ring.push(event);
		if (ring.length > RING_SIZE) ring.shift();
		for (const res of listeners) res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
	};

	// Keep the freshest context; session replacement invalidates older ones.
	const track = (c: ExtensionContext) => {
		ctx = c;
	};

	pi.on("session_start", async (event, c) => {
		track(c);
		if (!server) startServer();
		emit("session_start", { reason: event.reason, sessionId: c.sessionManager.getSessionId() });
	});
	pi.on("session_shutdown", async (event) => {
		emit("session_shutdown", { reason: event.reason });
		stopServer();
	});
	pi.on("agent_start", async (_e, c) => {
		track(c);
		emit("agent_start");
	});
	pi.on("agent_end", async (_e, c) => {
		track(c);
		emit("agent_end", { pendingMessages: c.hasPendingMessages() });
	});
	pi.on("agent_settled", async (e, c) => {
		track(c);
		emit("agent_settled", { aborted: e.aborted, pendingMessages: c.hasPendingMessages() });
	});
	pi.on("turn_start", async (e) => emit("turn_start", { turnIndex: e.turnIndex }));
	pi.on("message_start", async (e, c) => {
		track(c);
		emit("message_start", { ...summarize(e.message), pendingMessages: c.hasPendingMessages() });
	});
	pi.on("message_update", async (e) => {
		const ame = e.assistantMessageEvent as { type: string; delta?: string };
		if (ame.type === "text_delta") emit("text_delta", { delta: ame.delta });
	});
	pi.on("message_end", async (e) => emit("message_end", summarize(e.message)));
	pi.on("tool_execution_start", async (e) => emit("tool_start", { toolCallId: e.toolCallId, toolName: e.toolName }));
	pi.on("tool_execution_end", async (e) =>
		emit("tool_end", { toolCallId: e.toolCallId, toolName: e.toolName, isError: e.isError }),
	);
	pi.on("ui_prompt_start", async (e) => {
		pendingPrompt = { kind: e.kind, title: e.title };
		emit("ui_prompt_start", { kind: e.kind, title: e.title });
	});
	pi.on("ui_prompt_end", async (e) => {
		pendingPrompt = undefined;
		emit("ui_prompt_end", { kind: e.kind, title: e.title });
	});

	// A tool the model can call to produce a blocking dialog, so the spike can
	// observe "needs you" without depending on other extensions.
	pi.registerTool({
		name: "bridge_ask_confirmation",
		label: "Ask confirmation",
		description: "Ask the human a yes/no question in the terminal and return the answer.",
		parameters: Type.Object({ question: Type.String({ description: "Yes/no question for the human" }) }),
		async execute(_id, params, _signal, _onUpdate, c) {
			const ok = await c.ui.confirm("Bridge spike", params.question);
			return { content: [{ type: "text", text: ok ? "The human answered yes." : "The human answered no." }], details: undefined };
		},
	});

	function startServer() {
		token = randomBytes(32).toString("hex");
		server = createServer((req, res) => {
			handle(req, res).catch((error: unknown) => send(res, 500, { error: String(error) }));
		});
		server.listen(0, "127.0.0.1", () => {
			const address = server?.address();
			const port = typeof address === "object" && address ? address.port : 0;
			mkdirSync(stateDir, { recursive: true, mode: 0o700 });
			const file = join(stateDir, "bridge.json");
			writeFileSync(file, JSON.stringify({ port, token, pid: process.pid }), { mode: 0o600 });
			chmodSync(file, 0o600);
		});
	}

	function stopServer() {
		for (const res of listeners) res.end();
		listeners.clear();
		server?.close();
		server = undefined;
		rmSync(join(stateDir, "bridge.json"), { force: true });
	}

	function authorized(req: IncomingMessage) {
		const given = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer /, ""));
		const expected = Buffer.from(token);
		return given.length === expected.length && timingSafeEqual(given, expected);
	}

	async function handle(req: IncomingMessage, res: ServerResponse) {
		if (!authorized(req)) return send(res, 401, { error: "unauthorized" });
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const c = ctx;
		if (!c) return send(res, 503, { error: "no active session" });

		if (req.method === "GET" && url.pathname === "/state") {
			return send(res, 200, {
				idle: c.isIdle(),
				pendingMessages: c.hasPendingMessages(),
				pendingPrompt: pendingPrompt ?? null,
				model: c.model ? { id: c.model.id, provider: c.model.provider, input: c.model.input } : null,
				sessionId: c.sessionManager.getSessionId(),
				lastSeq: seq,
				oldestSeq: ring[0]?.seq ?? null,
			});
		}
		if (req.method === "GET" && url.pathname === "/history") {
			const messages = c.sessionManager
				.getBranch()
				.filter((entry: { type: string }) => entry.type === "message")
				.map((entry: { id: string; message: unknown }) => ({ entryId: entry.id, ...summarize(entry.message) }));
			return send(res, 200, { messages });
		}
		if (req.method === "GET" && url.pathname === "/events") {
			const since = Number(url.searchParams.get("since") ?? req.headers["last-event-id"] ?? seq);
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
			// Tell the client whether the requested range is still in the buffer.
			const oldest = ring[0]?.seq ?? seq + 1;
			const gap = since + 1 < oldest;
			res.write(`event: replay\ndata: ${JSON.stringify({ since, oldest, gap })}\n\n`);
			for (const event of ring) if (event.seq > since) res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
			listeners.add(res);
			req.on("close", () => listeners.delete(res));
			return;
		}
		if (req.method === "POST" && url.pathname === "/message") {
			const body = (await readJson(req)) as { text?: string; images?: { data: string; mimeType: string }[] };
			if (!body.text && !body.images?.length) return send(res, 400, { error: "text or images required" });
			const content = [
				...(body.text ? [{ type: "text" as const, text: body.text }] : []),
				...(body.images ?? []).map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })),
			];
			const busy = !c.isIdle();
			// Same behavior as Enter in the TUI: steer while busy.
			pi.sendUserMessage(content, busy ? { deliverAs: "steer" } : undefined);
			emit("bridge_message_submitted", { busy, images: body.images?.length ?? 0 });
			return send(res, 202, { status: busy ? "queued" : "submitted" });
		}
		if (req.method === "POST" && url.pathname === "/abort") {
			const wasIdle = c.isIdle();
			c.abort();
			emit("bridge_abort_requested", { wasIdle });
			return send(res, 202, { status: wasIdle ? "idle" : "requested" });
		}
		return send(res, 404, { error: "not found" });
	}
}

function summarize(message: unknown) {
	const m = message as { role?: string; content?: unknown; stopReason?: string };
	const parts = typeof m.content === "string" ? [{ type: "text", text: m.content }] : Array.isArray(m.content) ? m.content : [];
	const text = parts
		.filter((p: { type: string }) => p.type === "text")
		.map((p: { text: string }) => p.text)
		.join("");
	return {
		role: m.role,
		text: text.length > 500 ? `${text.slice(0, 500)}…` : text,
		images: parts.filter((p: { type: string }) => p.type === "image").length,
		toolCalls: parts.filter((p: { type: string }) => p.type === "toolCall").length,
		stopReason: m.stopReason,
	};
}

function send(res: ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > MAX_BODY_BYTES) throw new Error("body too large");
		chunks.push(chunk as Buffer);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
