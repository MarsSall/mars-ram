// Small platform facts and helpers the use cases need.
import { Platform } from "react-native";

/** Shown on the computer when it asks to authorize this phone, for example "samsung SM-S928B". */
export function deviceName(): string {
	const constants = Platform.constants as { Brand?: string; Model?: string };
	const name = [constants.Brand, constants.Model].filter(Boolean).join(" ").trim();
	// The pairing request refuses control characters and long names.
	return (name || "Android phone").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 64);
}

/** JSON POST with a timeout, for the pairing request. */
export async function postJson(url: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: unknown }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		let json: unknown = null;
		try {
			json = await res.json();
		} catch {
			json = null;
		}
		return { status: res.status, json };
	} finally {
		clearTimeout(timer);
	}
}

export function newId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
