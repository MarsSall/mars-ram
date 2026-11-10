// The temporary HTTP endpoint the phone sends its key to, listening only on the private network address pairing chose.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { PairingErrorCode, PairingResponse } from "@workspace/protocol";
import type { PairingSession } from "../core/pairing-session.ts";

const STATUS: Record<PairingErrorCode, number> = { bad_code: 403, rejected: 403, bad_request: 400, expired: 410, closed: 409, internal: 500 };

/** address and port are where the endpoint actually listens. */
export type PairingEndpoint = { address: string; port: number; finished: Promise<PairingResponse>; close(): Promise<void> };

export async function startPairingEndpoint(options: { session: PairingSession; address: string; maxBodyBytes: number }): Promise<PairingEndpoint> {
	const { session } = options;
	let finish: (result: PairingResponse) => void = () => {};
	const finished = new Promise<PairingResponse>((resolve) => (finish = resolve));

	const server = createServer((req, res) => {
		handle(req, res).catch(() => send(res, 500, { ok: false, error: "internal", message: "The computer could not handle the request." }));
	});

	async function handle(req: IncomingMessage, res: ServerResponse) {
		// Every request that is not a valid pairing counts against the attempt limit.
		if (req.method !== "POST" || req.url !== "/pair") return reject(res, 404, "Not found.");
		const body = await readBody(req, options.maxBodyBytes);
		if (body === null) return reject(res, 413, "The request is too large.");
		let data: unknown;
		try {
			data = JSON.parse(body);
		} catch {
			data = undefined;
		}
		let clientGone = false;
		res.on("close", () => {
			if (!res.writableEnded) clientGone = true;
		});
		const result = await session.handle(data, () => !clientGone);
		send(res, result.ok ? 200 : STATUS[result.error], result);
		endIfDone(result);
	}

	function reject(res: ServerResponse, status: number, message: string) {
		session.countBadAttempt();
		send(res, status, { ok: false, error: "bad_request", message });
		endIfDone({ ok: false, error: "closed", message: "Too many invalid requests." });
	}

	// Once the session ends, nothing else may pair through this endpoint.
	function endIfDone(result: PairingResponse) {
		if (session.state === "paired" || session.state === "closed") {
			finish(result);
			void close();
		}
	}

	const close = () =>
		new Promise<void>((resolve) => {
			server.close(() => resolve());
			server.closeAllConnections();
		});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, options.address, resolve);
	});
	const bound = server.address() as AddressInfo;
	return {
		address: bound.address,
		port: bound.port,
		finished,
		close: async () => {
			session.close();
			await close();
		},
	};
}

function send(res: ServerResponse, status: number, body: unknown) {
	if (res.headersSent) return;
	const json = JSON.stringify(body);
	res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(json), connection: "close" });
	res.end(json);
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string | null> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > maxBytes) return null;
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}
