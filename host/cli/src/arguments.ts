// Strict parsing: unknown, missing, or repeated arguments are an error, never silently ignored.

import type { KeyChange } from './adapters/key-change.ts';

export type Arguments = { ok: true; command: 'herdr' | 'servers' | 'project' | 'repos' | 'launch'; args: string[] } | ({ ok: true; command: 'key' } & KeyChange) | { ok: true; command: "pair"; sshPort: number } | { ok: true; command: "install" | "uninstall" | "doctor" } | { ok: false };

export function parseArguments(args: string[]): Arguments {
	const [command, ...rest] = args;
	// Herdr owns its invalid-usage response too: all failures use the v1 JSON envelope.
	if (command === 'herdr' || command === 'servers' || command === 'project' || command === 'repos' || command === 'launch') return { ok: true, command, args: rest };
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
	if (command === "install" || command === "uninstall" || command === "doctor") return rest.length === 0 ? { ok: true, command } : { ok: false };
	if (command !== "pair") return { ok: false };
	if (rest.length === 0) return { ok: true, command, sshPort: 22 };
	if (rest.length !== 2 || rest[0] !== "--ssh-port" || !/^\d{1,5}$/.test(rest[1] ?? "")) return { ok: false };
	const sshPort = Number(rest[1]);
	return sshPort >= 1 && sshPort <= 65535 ? { ok: true, command, sshPort } : { ok: false };
}
