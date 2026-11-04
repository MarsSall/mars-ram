// Starts a disposable Pi session with the bridge loaded, for contract tests.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { decodeEvent, decodeRegistryEntry, type BridgeEvent, type RegistryEntry } from "@workspace/protocol";

const EXTENSION = resolve(import.meta.dirname, "../../src/extension.ts");
// The pinned Pi dev dependency by default, so results do not depend on the host's global Pi.
// PI_TEST_COMMAND runs another Pi instead, for example "pi".
const PINNED_PI = resolve(import.meta.dirname, "../../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");

function piCommand(args: string[]): [string, string[], boolean] {
	const custom = process.env.PI_TEST_COMMAND;
	if (custom) return [custom, args, process.platform === "win32"];
	return [process.execPath, [PINNED_PI, ...args], false];
}

export type PiSession = {
	root: string;
	registry: string;
	/** The uploads folder the bridge reads attachments from. */
	uploads: string;
	process: ChildProcess;
	rpc(command: Record<string, unknown>): void;
	entries(): RegistryEntry[];
	waitForEntries(predicate: (entries: RegistryEntry[]) => boolean, timeoutMs?: number): Promise<RegistryEntry[]>;
	stop(): Promise<void>;
};

/** With `headless: false`, the RPC session runs like a background subagent: without PI_BRIDGE_HEADLESS. */
export async function startPiSession(options: { headless?: boolean } = {}): Promise<PiSession> {
	const headless = options.headless ?? true;
	const root = mkdtempSync(join(tmpdir(), "bridge-contract-"));
	const registry = join(root, "registry");
	const uploads = join(root, "uploads");
	// Model tests name their model explicitly: RPC mode may not resolve the interactive default.
	const model = process.env.PI_TEST_MODEL ? ["--model", process.env.PI_TEST_MODEL, "--thinking", "low"] : [];
	const [command, args, shell] = piCommand(["--mode", "rpc", "-ne", "-e", EXTENSION, "--no-session", ...model]);
	const child = spawn(command, args, {
		cwd: root,
		// The disposable RPC session is not the parent's interactive pane. Never inherit its target.
		// RPC sessions are published only on request (subagents are hidden from the phone).
		env: { ...process.env, HERDR_PANE_ID: "", PI_BRIDGE_HEADLESS: headless ? "1" : "", PI_BRIDGE_REGISTRY_DIR: registry, PI_BRIDGE_UPLOADS_DIR: uploads },
		stdio: ["pipe", "pipe", "pipe"],
		shell,
		windowsHide: true,
	});
	child.stdout?.resume();
	child.stderr?.resume();

	const entries = () => {
		try {
			return readdirSync(registry)
				.filter((name) => name.endsWith(".json"))
				.flatMap((name) => {
					const decoded = decodeRegistryEntry(JSON.parse(readFileSync(join(registry, name), "utf8")));
					return decoded.ok ? [decoded.value] : [];
				});
		} catch {
			return [];
		}
	};

	const waitForEntries = async (predicate: (e: RegistryEntry[]) => boolean, timeoutMs = 30_000) => {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const current = entries();
			if (predicate(current)) return current;
			if (child.exitCode !== null) throw new Error(`Pi exited with code ${child.exitCode}`);
			await new Promise((r) => setTimeout(r, 200));
		}
		throw new Error(`Timed out waiting for registry entries; found ${JSON.stringify(entries())}`);
	};

	if (headless) await waitForEntries((e) => e.length === 1);
	else await answered(child, `${JSON.stringify({ type: "get_state", id: "ready" })}\n`);

	return {
		root,
		registry,
		uploads,
		process: child,
		rpc: (command) => child.stdin?.write(`${JSON.stringify(command)}\n`),
		entries,
		waitForEntries,
		async stop() {
			if (child.exitCode === null) {
				const exited = new Promise((r) => child.once("exit", r));
				child.stdin?.end();
				await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
				if (child.exitCode === null) child.kill();
			}
			rmSync(root, { recursive: true, force: true });
		},
	};
}

/** Resolves once Pi answers an RPC command: by then session_start has run. */
function answered(child: ChildProcess, command: string, timeoutMs = 30_000): Promise<void> {
	return new Promise((resolve, reject) => {
		let buffer = "";
		const timer = setTimeout(() => reject(new Error("Pi did not answer the RPC command")), timeoutMs);
		const onData = (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			if (!buffer.split("\n").some((line) => line.includes('"type":"response"'))) return;
			clearTimeout(timer);
			child.stdout?.off("data", onData);
			resolve();
		};
		child.stdout?.on("data", onData);
		child.stdin?.write(command);
	});
}

export function client(entry: RegistryEntry) {
	const base = `http://127.0.0.1:${entry.port}`;
	const headers = { authorization: `Bearer ${entry.token}`, "content-type": "application/json" };
	return {
		get: (path: string) => fetch(base + path, { headers }),
		post: (path: string, body?: unknown) =>
			fetch(base + path, { method: "POST", headers, body: body === undefined ? null : JSON.stringify(body) }),
		raw: (path: string, init?: RequestInit) => fetch(base + path, init),
		/** Reads the event stream until `until` returns true for an event, then closes it. */
		async events(since: number, until: (event: BridgeEvent) => boolean, timeoutMs = 60_000) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			const res = await fetch(`${base}/events?since=${since}`, { headers, signal: controller.signal });
			const reader = res.body!.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let header: unknown;
			const events: BridgeEvent[] = [];
			try {
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const blocks = buffer.split("\n\n");
					buffer = blocks.pop() ?? "";
					for (const block of blocks) {
						const data = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
						if (!data) continue;
						if (block.startsWith("event: replay")) {
							header = JSON.parse(data);
							continue;
						}
						const decoded = decodeEvent(JSON.parse(data));
						if (decoded.kind !== "known") throw new Error(`Undecodable event: ${data}`);
						events.push(decoded.event);
						if (until(decoded.event)) return { header, events };
					}
				}
			} finally {
				clearTimeout(timer);
				controller.abort();
			}
			throw new Error(`Event stream ended before the expected event; got ${JSON.stringify(events.map((e) => e.type))}`);
		},
	};
}
