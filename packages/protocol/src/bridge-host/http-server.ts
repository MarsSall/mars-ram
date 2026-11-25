// Host-only, shared by the Pi bridge and the CLI's agent bridges.
// Serves the protocol on the loopback address, behind the instance token.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type {
	AbortResponse,
	ApprovalAnswerResponse,
	BridgeEvent,
	ErrorCode,
	ErrorResponse,
	HistoryResponse,
	ReplayHeader,
	SendMessageResponse,
	StateResponse,
	TerminalFocusResponse,
	TerminalInputResponse,
	TerminalScreenResponse,
} from "../index.ts";
import { tokensMatch } from "./token.ts";

const LOOPBACK = "127.0.0.1";
const STATUS: Record<ErrorCode, number> = {
	unauthorized: 401,
	bad_request: 400,
	not_found: 404,
	no_session: 503,
	too_large: 413,
	internal: 500,
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: ErrorResponse };

/** What the server needs from a bridge core. The Pi bridge's `BridgeSession` is one. */
export interface HttpSession {
	error(code: ErrorCode, message: string): ErrorResponse;
	state(): StateResponse;
	history(): HistoryResponse;
	eventsSince(since: number): { header: ReplayHeader; events: BridgeEvent[] };
	subscribe(listener: (event: BridgeEvent) => void): () => void;
	terminalScreen(): Promise<Result<TerminalScreenResponse>>;
	terminalFocus(): Promise<Result<TerminalFocusResponse>>;
	terminalInput(body: unknown): Promise<Result<TerminalInputResponse>>;
	sendMessage(body: unknown): Promise<Result<SendMessageResponse>>;
	abort(): AbortResponse | Promise<Result<AbortResponse>>;
	/** Since 1.9, only on bridges that declare `capabilities.approvals`; without it POST /approval is an unknown route. */
	answerApproval?(body: unknown): Promise<Result<ApprovalAnswerResponse>>;
}

/**
 * A second, separate channel on the same loopback port for the agent's own hook processes. It has its own token
 * (never the app's), so the app cannot forge agent events and a hook cannot use the app's routes.
 */
export type HookChannel = {
	token: string;
	/** `name` is the path after `/hook/`; `closed` fires if the hook process goes away before the answer. */
	handle(name: string, body: unknown, closed: AbortSignal): Promise<{ status: number; body: unknown }>;
};

export type HttpServerOptions = {
	session: HttpSession;
	token: string;
	maxBodyBytes: number;
	/** Comment lines that keep idle SSH tunnels open. */
	heartbeatMs: number;
	hooks?: HookChannel;
};

export type HttpBridgeServer = {
	port: number;
	address: string;
	openStreams(): number;
	/** Output queued for event-stream clients but not yet sent. */
	bufferedBytes(): number;
	close(): Promise<void>;
};

// No parameter properties: the CLI copy runs this file with Node's strip-only TypeScript support.
class RequestError extends Error {
	readonly code: ErrorCode;
	constructor(code: ErrorCode, message: string) {
		super(message);
		this.code = code;
	}
}

const HOOK_PATH = /^\/hook\/([A-Za-z]{1,40})$/;

export async function startHttpServer(options: HttpServerOptions): Promise<HttpBridgeServer> {
	const { session } = options;
	const streams = new Set<ServerResponse>();

	const fail = (res: ServerResponse, code: ErrorCode, message: string) => send(res, STATUS[code], session.error(code, message));
	const reply = <T>(res: ServerResponse, status: number, result: Result<T>) =>
		result.ok ? send(res, status, result.value) : send(res, STATUS[result.error.error.code], result.error);

	const server = createServer((req, res) => {
		handle(req, res).catch((error: unknown) => {
			if (res.headersSent) return void res.destroy();
			if (error instanceof RequestError) return fail(res, error.code, error.message);
			fail(res, "internal", "The bridge could not handle the request.");
		});
	});

	async function handle(req: IncomingMessage, res: ServerResponse) {
		// Exactly `Bearer <token>`: every client (the app, its Android watcher, the link server, the hook process) has
		// always sent that, so a bare token or another scheme is refused.
		const header = req.headers.authorization ?? "";
		const bearer = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
		const url = new URL(req.url ?? "/", `http://${LOOPBACK}`);
		const hook = options.hooks && req.method === "POST" ? HOOK_PATH.exec(url.pathname) : null;
		if (hook && options.hooks) {
			if (!tokensMatch(bearer, options.hooks.token)) return fail(res, "unauthorized", "Missing or invalid token.");
			const body = await readJson(req, options.maxBodyBytes);
			// The hook process waits on this request; its socket closing means nobody is waiting any more.
			const closed = new AbortController();
			res.on("close", () => { if (!res.writableFinished) closed.abort(); });
			const answer = await options.hooks.handle(hook[1]!, body, closed.signal);
			if (!res.destroyed) send(res, answer.status, answer.body);
			return;
		}
		if (!tokensMatch(bearer, options.token)) return fail(res, "unauthorized", "Missing or invalid token.");
		const route = `${req.method} ${url.pathname}`;

		if (route === "GET /state") return send(res, 200, session.state());
		if (route === "GET /terminal") return reply(res, 200, await session.terminalScreen());
		if (route === "POST /terminal/focus") return reply(res, 200, await session.terminalFocus());
		if (route === "POST /terminal/input") return reply(res, 202, await session.terminalInput(await readJson(req, options.maxBodyBytes)));
		if (route === "GET /history") return send(res, 200, session.history());
		if (route === "POST /abort") {
			const result = await session.abort();
			return "ok" in result ? reply(res, 202, result) : send(res, 202, result);
		}
		if (route === "POST /message") return reply(res, 202, await session.sendMessage(await readJson(req, options.maxBodyBytes)));
		if (route === "POST /approval" && session.answerApproval) return reply(res, 200, await session.answerApproval(await readJson(req, options.maxBodyBytes)));
		if (route === "GET /events") return stream(req, res, url);
		return fail(res, "not_found", "No such route.");
	}

	function stream(req: IncomingMessage, res: ServerResponse, url: URL) {
		const raw = url.searchParams.get("since") ?? req.headers["last-event-id"];
		const since = raw === undefined || raw === null ? session.state().lastSeq : Number(raw);
		if (!Number.isInteger(since) || since < 0) return fail(res, "bad_request", "The cursor must be a whole number.");
		res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
		const { header } = session.eventsSince(since);
		res.write(`event: replay\ndata: ${JSON.stringify(header)}\n\n`);

		// Send events from the log as fast as the client reads them: stop when the
		// socket buffer is full and continue on drain, so memory stays bounded for
		// any replay size. A gap at connection is reported in the header and the
		// replay starts at the oldest retained event; a client that falls behind
		// the log afterwards is disconnected and sees the gap when it reconnects.
		let cursor = header.gap && header.oldestSeq !== null ? header.oldestSeq - 1 : since;
		let waiting = false;
		const pump = () => {
			if (waiting || res.destroyed) return;
			const { header, events } = session.eventsSince(cursor);
			if (header.gap) return void res.destroy();
			for (const event of events) {
				cursor = event.seq;
				if (!res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`)) {
					waiting = true;
					res.once("drain", () => {
						waiting = false;
						pump();
					});
					return;
				}
			}
		};
		pump();
		const unsubscribe = session.subscribe(pump);
		const heartbeat = setInterval(() => {
			if (!res.writableNeedDrain) res.write(": ping\n\n");
		}, options.heartbeatMs);
		streams.add(res);
		res.on("close", () => {
			clearInterval(heartbeat);
			unsubscribe();
			streams.delete(res);
		});
	}

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, LOOPBACK, resolve);
	});
	const address = server.address() as AddressInfo;

	return {
		port: address.port,
		address: address.address,
		openStreams: () => streams.size,
		bufferedBytes: () => [...streams].reduce((total, res) => total + res.writableLength, 0),
		close: () =>
			new Promise<void>((resolve) => {
				for (const res of streams) res.end();
				server.close(() => resolve());
				server.closeAllConnections();
			}),
	};
}

function send(res: ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > maxBytes) throw new RequestError("too_large", `The request is larger than ${maxBytes} bytes.`);
		chunks.push(chunk as Buffer);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new RequestError("bad_request", "The request body is not valid JSON.");
	}
}
