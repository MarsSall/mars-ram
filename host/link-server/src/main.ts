import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LinkService, DEFAULT_PORT, requireId, validName, type NetworkChoice } from "./core/links.ts";
import { createFileStore } from "./adapters/file-store.ts";
import { createLauncher, publishPid } from "./adapters/launcher.ts";
import { tailscale } from "./adapters/tailscale.ts";
import { isIpv4, zerotier } from "./adapters/zerotier.ts";
import { startHttp } from "./adapters/http.ts";
import { createNotifyStore } from './adapters/notify-store.ts';
import { startNotifier } from './adapters/notifier.ts';
import { notifiedBy, registrationNetworks } from './core/notify-registration.ts';

function parse(args: string[]) {
	const command = args.shift();
	let port = DEFAULT_PORT;
	let staged: string | undefined;
	let id: string | undefined;
	let network: string | undefined;
	let address: string | undefined;
	if (!command || !["create", "list", "delete", "ensure", "serve", "status", "networks", "stop"].includes(command)) throw new Error("Expected create, list, delete, ensure, status, networks, stop or serve.");
	if (command === "delete") id = args.shift();
	const seen = new Set<string>();
	while (args.length) {
		const flag = args.shift()!;
		if (seen.has(flag)) throw new Error("Duplicate option."); seen.add(flag);
		const value = args.shift();
		if (flag === "--port" && value && /^\d+$/.test(value)) port = Number(value);
		else if (flag === "--staged" && command === "create" && value) staged = value;
		// Without these, links use the Tailscale address exactly as before.
		else if (flag === "--network" && !["status", "networks", "stop"].includes(command) && value) network = value;
		else if (flag === "--address" && !["status", "networks", "stop"].includes(command) && value) address = value;
		else throw new Error("Invalid option.");
	}
	if ((network === undefined) !== (address === undefined) || (network !== undefined && network !== "zerotier") || (address !== undefined && !isIpv4(address))) throw new Error("Invalid network option.");
	const choice: NetworkChoice | undefined = address === undefined ? undefined : { network: "zerotier", address };
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port.");
	if (command === "create" && (!staged || !validName(staged))) throw new Error("Invalid staged name.");
	if (command === "delete") requireId(id ?? "");
	return { command, port, staged, id, choice };
}
export async function main(args: string[]): Promise<void> {
	const { command, port, staged, id, choice } = parse([...args]);
	const root = join(homedir(), ".mars-ram", "links");
	const store = createFileStore(root);
	if (command !== "status" && command !== "networks" && command !== "stop") await store.init();
	const launcher = createLauncher(root, fileURLToPath(import.meta.url));
	const notifyStore = createNotifyStore(join(homedir(), '.mars-ram', 'notify'));
 // Each listener process stays alive for, and notifies, only its own network's phones.
 const listener = choice ? { network: choice.network, ip: choice.address } : {};
 const service = new LinkService({ clock: Date.now, random: bytes => randomBytes(bytes).toString("base64url"), store, tailscale, zerotier, launcher }, port, async () => { try { return (await notifyStore.all()).some(row => notifiedBy(row, listener)); } catch { return false; } }, choice);
	let output: unknown;
	switch (command) {
		case "status": output = await service.status(); break;
		case "networks": {
			// Read-only, for the doctor: which listeners answer and which networks have registrations. status is unchanged.
			const notify = await notifyStore.all().then(registrationNetworks, () => undefined);
			output = { listeners: await service.listeners(), ...(notify ? { notify } : {}) };
			break;
		}
		case "stop": output = await launcher.stopAll(port); break;
		case "create": output = await service.create(staged!); break;
		case "list": output = await service.list(); break;
		case "delete": {
			output = await service.delete(id!);
			// Identity probes are read-only; the server's periodic sweep observes deletion.
			break;
		}
		case "ensure": output = await service.ensure(); break;
		case "serve": {
			const address = choice ? await zerotier.address(choice.address) : await tailscale.address();
			if (await service.shouldExit()) return;
			const instance = randomBytes(16).toString("base64url");
			const startedAt = new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString();
			const server = await startHttp(service, { ip: address.ip, port, ...(choice ? { network: choice.network } : {}), instance, log: message => process.stderr.write(`${message}\n`) });
			const notifier = startNotifier(join(homedir(), '.mars-ram'), listener);
   let removePid: (() => Promise<void>) | undefined;
			const stop = () => { void server.close(); };
			process.once("SIGTERM", stop); process.once("SIGINT", stop);
			try {
				removePid = await publishPid(root, { pid: process.pid, startedAt, instance, ip: address.ip, port, ...(choice ? { network: choice.network } : {}) });
				await server.closed;
			} finally {
				await notifier.close(); await server.close(); await removePid?.();
				process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
			}
			return;
		}
	}
	process.stdout.write(`${JSON.stringify(output)}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2)).catch(error => {
		// Adapters use fixed safe diagnostics; never print raw OS errors (which may contain secrets).
		const message = error instanceof Error && /^(?:Invalid |Expected |Duplicate |Tailscale |ZeroTier |Link server did not start|Cannot bind)/.test(error.message)
			? error.message : "Link command failed. Check private storage permissions and the staged file.";
		process.stderr.write(`${message}\n`); process.exitCode = 1;
	});
}
