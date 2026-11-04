import { ACTIVITY_ID_PATTERN } from "@workspace/protocol";

const phaseId = new RegExp(ACTIVITY_ID_PATTERN);

/** Optional process-local integration. Getters, proxies and get() are all untrusted. */
export function readActivity(sessionId: string, root: object = globalThis): string | null {
	try {
		const registry: unknown = Reflect.get(root, Symbol.for("gentle-pi.odd-phase-registry"));
		if (!registry || (typeof registry !== "object" && typeof registry !== "function")) return null;
		const get: unknown = Reflect.get(registry, "get");
		if (typeof get !== "function") return null;
		const phase: unknown = get.call(registry, sessionId);
		// JS $ also matches before a trailing newline: require the complete match.
		return typeof phase === "string" && phaseId.exec(phase)?.[0] === phase ? phase : null;
	} catch {
		return null;
	}
}
