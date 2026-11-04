// Calls to one session bridge through its tunnel, with every answer checked against the protocol.
import {
	AbortResponse,
	decodeResponse,
	ErrorResponse,
	HistoryResponse,
	type SendMessageRequest,
	SendMessageResponse,
	StateResponse,
	TerminalFocusResponse,
	type ErrorCode,
} from "@workspace/protocol";
import type { TSchema, Static } from "typebox";

export type HttpResult = { ok: true; status: number; data: unknown } | { ok: false; message: string };

/** Port: JSON over HTTP with the bridge's bearer token. */
export interface BridgeHttp {
	request(method: "GET" | "POST", url: string, token: string, body?: unknown): Promise<HttpResult>;
}

export type BridgeEndpoint = { baseUrl: string; token: string };

/** `unreachable`: no answer; `refused`: the bridge answered with an error; `invalid`: the answer is not the protocol. */
export type BridgeFailure = { ok: false; reason: "unreachable" | "refused" | "invalid"; message: string; code?: ErrorCode };
export type BridgeResult<T> = { ok: true; value: T } | BridgeFailure;

async function call<S extends TSchema>(http: BridgeHttp, endpoint: BridgeEndpoint, method: "GET" | "POST", path: string, schema: S, body?: unknown): Promise<BridgeResult<Static<S>>> {
	const result = await http.request(method, `${endpoint.baseUrl}${path}`, endpoint.token, body);
	if (!result.ok) return { ok: false, reason: "unreachable", message: result.message };
	if (result.status >= 400) {
		const error = decodeResponse(ErrorResponse, result.data);
		return { ok: false, reason: "refused", message: error.ok ? error.value.error.message : `The session answered with status ${result.status}.`, ...(error.ok ? { code: error.value.error.code } : {}) };
	}
	const decoded = decodeResponse(schema, result.data);
	if (!decoded.ok) return { ok: false, reason: "invalid", message: "The session sent an answer this app does not understand." };
	return { ok: true, value: decoded.value };
}

export const bridgeClient = {
	terminalFocus: (http: BridgeHttp, endpoint: BridgeEndpoint) => call(http, endpoint, "POST", "/terminal/focus", TerminalFocusResponse),
	state: (http: BridgeHttp, endpoint: BridgeEndpoint) => call(http, endpoint, "GET", "/state", StateResponse),
	history: (http: BridgeHttp, endpoint: BridgeEndpoint) => call(http, endpoint, "GET", "/history", HistoryResponse),
	send: (http: BridgeHttp, endpoint: BridgeEndpoint, message: SendMessageRequest) => call(http, endpoint, "POST", "/message", SendMessageResponse, message),
	abort: (http: BridgeHttp, endpoint: BridgeEndpoint) => call(http, endpoint, "POST", "/abort", AbortResponse, {}),
};
