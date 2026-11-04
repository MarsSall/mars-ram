#!/usr/bin/env node
// Feasibility spike client: plays the phone against bridge.ts. See README.md.
// Usage: node client.mjs <bridge-dir> <command> [args]
//   state | history | events [sinceSeq] [seconds] | send <text> | image <path> [text] | abort
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";

const [dir, command, ...args] = process.argv.slice(2);
if (!dir || !command) {
	console.error("usage: node client.mjs <bridge-dir> state|history|events|send|image|abort [args]");
	process.exit(2);
}
const { port, token } = JSON.parse(readFileSync(join(dir, "bridge.json"), "utf8"));
const base = `http://127.0.0.1:${port}`;
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

async function call(method, path, body) {
	const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
	console.log(res.status, JSON.stringify(await res.json(), null, 2));
}

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

switch (command) {
	case "state":
		await call("GET", "/state");
		break;
	case "history":
		await call("GET", "/history");
		break;
	case "send":
		await call("POST", "/message", { text: args.join(" ") });
		break;
	case "image": {
		const [path, ...text] = args;
		const data = readFileSync(path).toString("base64");
		await call("POST", "/message", { text: text.join(" ") || undefined, images: [{ data, mimeType: MIME[extname(path)] ?? "image/png" }] });
		break;
	}
	case "abort":
		await call("POST", "/abort");
		break;
	case "events": {
		// Print events for a bounded time, then exit, so scripted runs terminate.
		const [since, seconds = "30"] = args;
		const controller = new AbortController();
		setTimeout(() => controller.abort(), Number(seconds) * 1000);
		const query = since === undefined ? "" : `?since=${since}`;
		try {
			const res = await fetch(`${base}/events${query}`, { headers, signal: controller.signal });
			const decoder = new TextDecoder();
			for await (const chunk of res.body) process.stdout.write(decoder.decode(chunk));
		} catch (error) {
			if (error.name !== "AbortError") throw error;
		}
		break;
	}
	default:
		console.error(`unknown command: ${command}`);
		process.exit(2);
}
