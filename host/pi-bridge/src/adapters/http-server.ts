// Serves the protocol on the loopback address, behind the instance token.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { BridgeEvent, ErrorCode } from "@workspace/protocol";
import type { BridgeSession } from "../core/bridge-session.ts";
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

export type HttpServerOptions = {
	session: BridgeSession;
	token: string;
	maxBodyBytes: number;
	/** Comment lines that keep idle SSH tunnels open. */
	heartbeatMs: number;
};

export type HttpBridgeServer = {
	port: number;
	address: string;
	openStreams(): number;
	/** Output queued for event-stream clients but not yet sent. */
	bufferedBytes(): number;
	close(): Promise<void>;
};

class RequestError extends Error {
	constructor(readonly code: ErrorCode, message: string) {
		super(message);
	}
}

export async function startHttpServer(options: HttpServerOptions): Promise<HttpBridgeServer> {
	const { session } = options;
	const streams = new Set<ServerResponse>();

	const fail = (res: ServerResponse, code: ErrorCode, message: string) => send(res, STATUS[code], session.error(code, message));

	const server = createServer((req, res) => {
		handle(req, res).catch((error: unknown) => {
			if (error instanceof RequestError) return fail(res, error.code, error.message);
			fail(res, "internal", "The bridge could not handle the request.");
		});
	});

	async function handle(req: IncomingMessage, res: ServerResponse) {
		const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
		if (!tokensMatch(bearer, options.token)) return fail(res, "unauthorized", "Missing or invalid token.");
		const url = new URL(req.url ?? "/", `http://${LOOPBACK}`);
		const route = `${req.method} ${url.pathname}`;

		if (route === "GET /state") return send(res, 200, session.state());
		if (route === "GET /terminal") {
			const result = await session.terminalScreen();
			return result.ok ? send(res, 200, result.value) : send(res, STATUS[result.error.error.code], result.error);
		}
		if (route === "POST /terminal/focus") {
			const result = await session.terminalFocus();
			return result.ok ? send(res, 200, result.value) : send(res, STATUS[result.error.error.code], result.error);
		}
		if (route === "POST /terminal/input") {
			const result = await session.terminalInput(await readJson(req, options.maxBodyBytes));
			return result.ok ? send(res, 202, result.value) : send(res, STATUS[result.error.error.code], result.error);
		}
		if (route === "GET /history") return send(res, 200, session.history());
		if (route === "POST /abort") return send(res, 202, session.abort());
		if (route === "POST /message") {
			const result = await session.sendMessage(await readJson(req, options.maxBodyBytes));
			return result.ok ? send(res, 202, result.value) : send(res, STATUS[result.error.error.code], result.error);
		}
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
