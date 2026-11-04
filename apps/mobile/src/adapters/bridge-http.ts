// BridgeHttp adapter over fetch, through the SSH tunnel on the phone's loopback address.
import type { BridgeHttp } from "../core/bridge-client";

const TIMEOUT_MS = 10_000;

export const fetchBridgeHttp: BridgeHttp = {
	async request(method, url, token, body) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
		try {
			const headers: Record<string, string> = { authorization: `Bearer ${token}` };
			if (body !== undefined) headers["content-type"] = "application/json";
			const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
			let data: unknown = null;
			try {
				data = await res.json();
			} catch {
				data = null;
			}
			return { ok: true, status: res.status, data };
		} catch (error) {
			const timedOut = error instanceof Error && error.name === "AbortError";
			return { ok: false, message: timedOut ? "The session did not answer in time." : "The session could not be reached." };
		} finally {
			clearTimeout(timer);
		}
	},
};
