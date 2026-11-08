// Pi adapter: loads into a live Pi session and exposes it through the bridge.
// Each session start (startup, reload, new, resume, fork) creates a new
// bridge instance; each shutdown removes it.
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readActivity } from "./adapters/activity-registry.ts";
import { inferActivity } from "./core/activity.ts";
import { createHerdrTerminal } from "./adapters/herdr-terminal.ts";
import { platformPermissions } from "./adapters/file-permissions.ts";
import { type HttpBridgeServer, startHttpServer } from "./adapters/http-server.ts";
import { stopInstance } from "./adapters/lifecycle.ts";
import { publishEntry, pruneStaleEntries } from "./adapters/registry.ts";
import { createToken } from "./adapters/token.ts";
import { createUploadStore } from "./adapters/upload-store.ts";
import { registryDir, uploadsDir } from "./config.ts";
import { BridgeSession } from "./core/bridge-session.ts";
import { summarize } from "./core/message-summary.ts";
import { publishesSession } from "./core/publish-policy.ts";
import type { PiSessionPort } from "./core/ports.ts";
import { RunOutcome } from "./core/run-outcome.ts";

const EVENT_CAPACITY = 1000;
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const HEARTBEAT_MS = 15_000;

type Running = { session: BridgeSession; server: HttpBridgeServer; entryPath: string };

export default function bridge(pi: ExtensionAPI) {
	// Session replacement invalidates older contexts, so keep the newest one.
	let ctx: ExtensionContext | undefined;
	let running: Running | undefined;
	const outcome = new RunOutcome();

	const live = (): ExtensionContext => {
		if (!ctx) throw new Error("The bridge has no active Pi session.");
		return ctx;
	};

	const port: PiSessionPort = {
		sessionId: () => live().sessionManager.getSessionId(),
		isIdle: () => live().isIdle(),
		hasPendingMessages: () => live().hasPendingMessages(),
		model: () => {
			const model = live().model;
			return model ? { id: model.id, provider: String(model.provider), acceptsImages: model.input.includes("image") } : null;
		},
		imagesBlocked: () => pi.getSettings().images?.blockImages === true,
		history: () =>
			live()
				.sessionManager.getBranch()
				.flatMap((entry) => (entry.type === "message" ? [{ entryId: entry.id, ...summarize(entry.message) }] : [])),
		send: (content, steer) => {
			const blocks = [
				...(content.text !== undefined ? [{ type: "text" as const, text: content.text }] : []),
				...content.images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })),
			];
			pi.sendUserMessage(blocks, steer ? { deliverAs: "steer" } : undefined);
		},
		abort: () => live().abort(),
	};

	async function start(c: ExtensionContext) {
		const dir = registryDir();
		pruneStaleEntries(dir);
		const token = createToken();
		const terminal = createHerdrTerminal();
		const session = new BridgeSession({
			pi: port,
			uploads: createUploadStore(uploadsDir()),
			instanceId: randomUUID(),
			capacity: EVENT_CAPACITY,
			clock: Date.now,
			...(terminal ? { terminal } : {}),
		});
		const server = await startHttpServer({ session, token, maxBodyBytes: MAX_BODY_BYTES, heartbeatMs: HEARTBEAT_MS });
		try {
			const entryPath = publishEntry(
				dir,
				{ ...session.envelope(), port: server.port, token, pid: process.pid, cwd: c.cwd, startedAt: Date.now() },
				platformPermissions(),
			);
			running = { session, server, entryPath };
		} catch (error) {
			await server.close();
			throw error;
		}
	}

	async function stop() {
		const current = running;
		running = undefined;
		outcome.reset();
		if (current) await stopInstance(current);
	}

	pi.on("session_start", async (event, c) => {
		ctx = c;
		await stop();
		// Background subagents load this extension too; they are not sessions the user follows.
		if (!publishesSession((c as { mode?: string }).mode, process.env)) return;
		try {
			await start(c);
			running?.session.record({ type: "session_start", reason: event.reason });
		} catch (error) {
			if (c.hasUI) c.ui.notify(`Mobile bridge could not start: ${(error as Error).message}`, "error");
		}
	});
	pi.on("session_shutdown", async () => stop());

	pi.on("agent_start", async (_e, c) => {
		ctx = c;
		outcome.reset();
		running?.session.record({ type: "agent_start" });
	});
	pi.on("agent_end", async (e, c) => {
		ctx = c;
		outcome.ended(e.messages);
		running?.session.record({ type: "agent_end", pendingMessages: c.hasPendingMessages() });
	});
	pi.on("agent_settled", async (e, c) => {
		ctx = c;
		const result = outcome.settled(e.aborted);
		running?.session.record({ type: "agent_settled", aborted: e.aborted, pendingMessages: c.hasPendingMessages(), ...(result === undefined ? {} : { outcome: result }) });
	});
	pi.on("turn_start", async (e) => {
		running?.session.record({ type: "turn_start", turnIndex: e.turnIndex });
	});
	pi.on("message_start", async (e, c) => {
		ctx = c;
		running?.session.record({ type: "message_start", message: summarize(e.message), pendingMessages: c.hasPendingMessages() });
	});
	pi.on("message_update", async (e) => {
		const update = e.assistantMessageEvent as { type: string; delta?: string };
		if (update.type === "text_delta" && update.delta) running?.session.record({ type: "text_delta", delta: update.delta });
	});
	pi.on("message_end", async (e) => {
		running?.session.record({ type: "message_end", message: summarize(e.message) });
	});
	const updateActivity = (c: ExtensionContext, toolName: string, args: unknown) => {
		const session = running?.session;
		if (!session) return;
		// Match Gentle Shell's registry key exactly, not the bridge instance id.
		let phase: string | null = null;
		try { phase = readActivity(c.sessionManager.getSessionId()); } catch { /* Optional integration must never break a tool. */ }
		session.setActivity(phase ?? inferActivity(session.state().activity ?? null, toolName, args));
	};
	pi.on("tool_execution_start", async (e, c) => {
		ctx = c;
		running?.session.toolStarted({ toolCallId: e.toolCallId, toolName: e.toolName, args: e.args });
		updateActivity(c, e.toolName, e.args);
	});
	pi.on("tool_execution_end", async (e, c) => {
		ctx = c;
		running?.session.toolEnded({ toolCallId: e.toolCallId, toolName: e.toolName, isError: e.isError });
		updateActivity(c, e.toolName, undefined);
	});
	pi.on("ui_prompt_start", async (e) => {
		running?.session.promptStarted(e.title === undefined ? { kind: e.kind } : { kind: e.kind, title: e.title });
	});
	pi.on("ui_prompt_end", async (e) => {
		running?.session.promptEnded({ kind: e.kind });
	});
}
