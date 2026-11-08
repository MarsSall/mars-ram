#!/usr/bin/env node
// Host command: mars-ram pair — shows a QR so a phone can pair with this computer.
import { randomBytes } from "node:crypto";
import { homedir, hostname, userInfo } from "node:os";
import { encodePairingUri } from "@workspace/protocol";
import { authorizeKey, buildKeyLine, keyTarget, readWindowsPrivileges } from "./adapters/authorized-keys.ts";
import { fingerprintOfPublicKey, readHostIdentity } from "./adapters/host-identity.ts";
import { startPairingEndpoint } from "./adapters/pairing-endpoint.ts";
import { readTailscale } from "./adapters/tailscale.ts";
import { parseArguments } from "./arguments.ts";
import { askConfirmation, renderQr, text } from "./adapters/terminal.ts";
import { PairingSession } from "./core/pairing-session.ts";
import { installCommand } from "./install-command.ts";
import { doctorCommand } from "./doctor-command.ts";
import { keyCommand } from './key-command.ts';
import { herdrCommand } from './herdr-command.ts';
import { serversCommand } from './servers-command.ts';
import { projectCommand } from './project-command.ts';
import { shortcutsCommand } from './shortcuts-command.ts';
import { notifyCommand } from './notify-command.ts';

import { readRelease } from './adapters/release-version.ts';

const TTL_MS = 5 * 60_000;

async function pair(sshPort: number): Promise<number> {
	const tailscale = readTailscale();
	if (!tailscale.ok) return fail(tailscale.message);
	const identity = readHostIdentity();
	if (!identity.ok) return fail(identity.message);

	const privileges = process.platform === "win32" ? readWindowsPrivileges() : { administrator: false, elevated: false };
	if (privileges.administrator && !privileges.elevated) return fail(text.elevate);
	const target = keyTarget(process.platform, { home: homedir(), programData: process.env.ProgramData, administrator: privileges.administrator });

	const host = {
		name: hostname(),
		address: tailscale.address,
		...(tailscale.dnsName ? { dnsName: tailscale.dnsName } : {}),
		sshPort,
		user: userInfo().username,
		hostKey: identity.fingerprint,
		pairPort: 0,
	};
	let deviceName = "";
	// Cancelling from the confirmation question ends pairing like Ctrl+C anywhere else.
	let cancelPairing: () => void = () => {};
	const cancel = new Promise<"cancelled">((resolve) => {
		cancelPairing = () => resolve("cancelled");
		process.once("SIGINT", cancelPairing);
	});
	const session = new PairingSession({
		host,
		ttlMs: TTL_MS,
		maxBadAttempts: 5,
		ports: {
			clock: Date.now,
			randomCode: () => randomBytes(16).toString("base64url"),
			keyFingerprint: fingerprintOfPublicKey,
			confirm: async (device) => {
				deviceName = device.deviceName;
				return askConfirmation(text.question(device.deviceName, device.keyFingerprint), () => cancelPairing());
			},
			authorizeKey: async (publicKey, name) => authorizeKey(target, buildKeyLine(publicKey, name, new Date())),
		},
	});
	const endpoint = await startPairingEndpoint({ session, address: tailscale.address, maxBodyBytes: 8 * 1024 });
	// The QR carries the port the endpoint actually got.
	host.pairPort = endpoint.port;
	const uri = encodePairingUri({ ...session.offer(), pairPort: endpoint.port });

	console.log(`\n${text.scan}\n\n${renderQr(uri)}\n\n${text.orOpen}\n${uri}\n\n${text.expires(TTL_MS / 60_000)}\n${text.waiting}\n`);

	const expiry = new Promise<"expired">((resolve) => setTimeout(() => resolve("expired"), TTL_MS).unref());
	const outcome = await Promise.race([endpoint.finished, expiry, cancel]);
	await endpoint.close();
	if (outcome === "expired") return fail(text.expired);
	if (outcome === "cancelled") return fail(text.cancelled);
	if (!outcome.ok) return fail(text.notPaired(outcome.message));
	console.log(text.paired(deviceName));
	return 0;
}

function fail(message: string): number {
	console.error(message);
	return 1;
}

// Exit explicitly: a confirmation question left unanswered after a cancel or expiry would keep reading stdin.
const parsed = parseArguments(process.argv.slice(2));
if (!parsed.ok) {
	console.error(text.usage + '\nmars-ram version [--json]\nmars-ram repos [--json] [--add-root <dir>|--remove-root <dir>]\nmars-ram launch --repo <absolute path> --program <gentle-shell|pi|opencode> [--json]\nmars-ram servers list\nmars-ram herdr list\nmars-ram herdr focus <workspaceId> [<tabId>]\nmars-ram project tree [--path <path>|--path-b64 <base64url>] [--workspace <id>]\nmars-ram project status|branches [--workspace <id>]\nmars-ram project log [--limit <1-100>] [--workspace <id>]\nmars-ram project file|stage-link --path <path>|--path-b64 <base64url> [--workspace <id>]\nmars-ram project diff --path <path>|--path-b64 <base64url> [--commit <hash>] [--workspace <id>]\nmars-ram project show --commit <hash> [--workspace <id>]\nmars-ram key add --key "<type> <base64>" --like "<type> <base64>"\nmars-ram key remove --key "<type> <base64>" --keep "<type> <base64>"');
	process.exit(2);
}
if (parsed.command === 'version') {
 const release = readRelease();
 console.log(parsed.json ? JSON.stringify({ version: 1, release }) : release);
 process.exit(0);
}
process.exit(await (parsed.command === 'notify' ? notifyCommand(parsed.args) : parsed.command === 'repos' || parsed.command === 'launch' ? shortcutsCommand(parsed.command, parsed.args) : parsed.command === 'servers' ? serversCommand(parsed.args) : parsed.command === 'project' ? projectCommand(parsed.args) : parsed.command === 'herdr' ? herdrCommand(parsed.args) : parsed.command === 'key' ? keyCommand(parsed) : parsed.command === "pair" ? pair(parsed.sshPort) : parsed.command === "doctor" ? doctorCommand() : installCommand(parsed.command)));
