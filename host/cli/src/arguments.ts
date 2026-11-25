// Strict parsing: unknown, missing, or repeated arguments are an error, never silently ignored.

import type { KeyChange } from './adapters/key-change.ts';

export type Arguments = { ok: true; command: 'version'; json: boolean } | { ok: true; command: 'notify' | 'herdr' | 'servers' | 'project' | 'repos' | 'launch' | 'hook' | 'bridge'; args: string[] } | ({ ok: true; command: 'key' } & KeyChange) | PairArguments | { ok: true; command: "install" | "uninstall" | "doctor" | "update" | "uploads-dir" } | { ok: false };

/** No network field means pairing finds the connected network on its own. */
export type PairArguments = { ok: true; command: "pair"; sshPort: number; network?: "tailscale" | "zerotier"; address?: string };

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function parseArguments(args: string[]): Arguments {
	const [command, ...rest] = args;
	if (command === 'version') return rest.length === 0 || (rest.length === 1 && rest[0] === '--json') ? { ok: true, command, json: rest.length === 1 } : { ok: false };
	// Herdr owns its invalid-usage response too: all failures use the v1 JSON envelope.
	if (command === 'notify' || command === 'herdr' || command === 'servers' || command === 'project' || command === 'repos' || command === 'launch') return { ok: true, command, args: rest };
	// Run by an agent's hooks and by its SessionStart hook; each validates its own arguments and never blocks the agent.
	if (command === 'hook' || command === 'bridge') return { ok: true, command, args: rest };
	if (command === 'key') {
		const [action, ...flags] = rest;
		if ((action !== 'add' && action !== 'remove') || flags.length !== 4) return { ok: false };
		const values = new Map<string, string>();
		for (let i = 0; i < flags.length; i += 2) {
			const flag = flags[i]!;
			if (values.has(flag) || (flag !== '--key' && flag !== (action === 'add' ? '--like' : '--keep'))) return { ok: false };
			values.set(flag, flags[i + 1]!);
		}
		const key = values.get('--key');
		const trusted = values.get(action === 'add' ? '--like' : '--keep');
		if (!key || !trusted) return { ok: false };
		return action === 'add' ? { ok: true, command, action, key, like: trusted } : { ok: true, command, action, key, keep: trusted };
	}
	if (command === "install" || command === "uninstall" || command === "doctor" || command === "update") return rest.length === 0 ? { ok: true, command } : { ok: false };
	// JSON only: the app reads it over SSH.
	if (command === "uploads-dir") return rest.length === 1 && rest[0] === "--json" ? { ok: true, command } : { ok: false };
	if (command === "pair") return parsePair(rest);
	if (command === "pair-zt") return parsePair(rest, "zerotier");
	return { ok: false };
}

/**
 * `pair` finds the network unless `--network` names it; `pair-zt` is `pair --network zerotier`.
 * `--address` picks one of several ZeroTier addresses, so it implies ZeroTier.
 */
function parsePair(rest: string[], fixed?: "zerotier"): PairArguments | { ok: false } {
	const values = new Map<string, string>();
	if (rest.length % 2 !== 0) return { ok: false };
	const flags = fixed ? ["--ssh-port", "--address"] : ["--ssh-port", "--address", "--network"];
	for (let i = 0; i < rest.length; i += 2) {
		const flag = rest[i]!;
		if (values.has(flag) || !flags.includes(flag)) return { ok: false };
		values.set(flag, rest[i + 1]!);
	}
	const port = values.get("--ssh-port") ?? "22";
	const address = values.get("--address");
	const named = values.get("--network");
	if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) return { ok: false };
	if (named !== undefined && named !== "tailscale" && named !== "zerotier") return { ok: false };
	if (address !== undefined && (!IPV4.test(address) || named === "tailscale")) return { ok: false };
	const network = fixed ?? named ?? (address === undefined ? undefined : "zerotier");
	return { ok: true, command: "pair", sshPort: Number(port), ...(network === undefined ? {} : { network }), ...(address === undefined ? {} : { address }) };
}
