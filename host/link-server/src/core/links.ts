import type { Link, ListenAddress, Ports } from "./ports.ts";

// Kept self-contained for direct Node execution; matches protocol ATTACHMENT_MAX_BYTES.
export const MAX_BYTES = 25 * 1024 * 1024;
export const DEFAULT_PORT = 47811;
export const ORPHAN_GRACE_MS = 86400000;
export const ID_PATTERN = /^[A-Za-z0-9_-]{12}(?![\s\S])/;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}(?![\s\S])/;
export function validName(name: string): boolean {
	return name.length <= 200 && /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?(?![\s\S])/.test(name)
		&& !name.includes("..") && !/\.part$/i.test(name)
		&& !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i.test(name);
}
export function requireId(id: string): void {
	if (!ID_PATTERN.test(id)) throw new Error("Invalid link id.");
}
export function contentType(data: Uint8Array): { contentKind: "image" | "download"; mime: string } {
	const starts = (bytes: number[]) => bytes.every((b, i) => data[i] === b);
	const text = (start: number, end: number) => String.fromCharCode(...data.subarray(start, end));
	let mime: string | undefined;
	if (starts([137, 80, 78, 71, 13, 10, 26, 10])) mime = "image/png";
	else if (starts([255, 216, 255])) mime = "image/jpeg";
	else if (["GIF87a", "GIF89a"].includes(text(0, 6))) mime = "image/gif";
	else if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") mime = "image/webp";
	return mime ? { contentKind: "image", mime } : { contentKind: "download", mime: "application/octet-stream" };
}

/** An explicit ZeroTier listener; without one, links use the Tailscale address exactly as before. */
export type NetworkChoice = { network: "zerotier"; address: string };

export class LinkService {
	readonly ports: Ports;
	readonly port: number;
	private readonly notificationsEnabled: () => Promise<boolean>;
	private readonly network: NetworkChoice | undefined;
 constructor(ports: Ports, port = DEFAULT_PORT, notificationsEnabled: () => Promise<boolean> = async () => false, network?: NetworkChoice) { this.ports = ports; this.port = port; this.notificationsEnabled = notificationsEnabled; this.network = network; }
	/** The verified ZeroTier address, checked before any storage or listener change. */
	private async zeroTier(): Promise<ListenAddress | undefined> {
		if (!this.network) return undefined;
		if (!this.ports.zerotier) throw new Error("ZeroTier is unavailable on this computer.");
		return this.ports.zerotier.address(this.network.address);
	}
	async active(): Promise<Link[]> {
		const active: Link[] = [];
		for (const link of await this.ports.store.all(this.ports.clock() - ORPHAN_GRACE_MS)) {
			if (Date.parse(link.expiresAt) <= this.ports.clock()) await this.ports.store.delete(link.id);
			else active.push(link);
		}
		return active;
	}
	async status() {
		let links: Link[];
		let invalid = 0;
		try { links = await this.ports.store.all(); invalid = await this.ports.store.invalidCount(); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; links = []; }
		let serving = false;
		try { serving = await this.ports.launcher.isRunning(this.port, await this.ports.tailscale.address()); } catch { /* offline is not serving */ }
		if (!serving && this.ports.launcher.recorded) {
			try { for (const address of await this.ports.launcher.recorded()) if (await this.ports.launcher.isRunning(this.port, address)) { serving = true; break; } } catch { /* unreadable records are not serving */ }
		}
		return { serving, links: links.filter(link => Date.parse(link.expiresAt) > this.ports.clock()).length, invalid };
	}
	/** Which listeners answer now, per network: Siempre atento needs its own network's listener (doctor). */
	async listeners(): Promise<{ tailscale: boolean; zerotier: string[] }> {
		let tailscale = false;
		try { tailscale = await this.ports.launcher.isRunning(this.port, await this.ports.tailscale.address()); } catch { /* offline is not serving */ }
		const zerotier: string[] = [];
		try { for (const address of await this.ports.launcher.recorded?.() ?? []) if (await this.ports.launcher.isRunning(this.port, address)) zerotier.push(address.ip); } catch { /* unreadable records are not serving */ }
		return { tailscale, zerotier };
	}
	async shouldExit(): Promise<boolean> { return (await this.active()).length === 0 && !await this.notificationsEnabled(); }
	async create(name: string) {
		if (!validName(name)) throw new Error("Invalid staged name.");
		const address = await this.zeroTier() ?? await this.ports.tailscale.address();
		const createdAt = this.ports.clock();
		const link = await this.ports.store.create(name, {
			id: this.ports.random(9), token: this.ports.random(32),
			createdAt: new Date(createdAt).toISOString(), expiresAt: new Date(createdAt + 86400000).toISOString(),
		});
		await this.ensure();
		return { id: link.id, url: this.url(link, address.dnsName), expiresAt: link.expiresAt };
	}
	url(link: Link, dnsName: string): string { return `http://${dnsName}:${this.port}/l/${link.token}`; }
	async list() {
		const zeroTier = await this.zeroTier();
		const links = await this.active();
		if (!links.length) return { serving: false, links: [] };
		const address = zeroTier ?? await this.ports.tailscale.address();
		return {
			serving: await this.ports.launcher.isRunning(this.port, address),
			links: links.map(link => ({ id: link.id, fileName: link.fileName, size: link.size, createdAt: link.createdAt, expiresAt: link.expiresAt, url: this.url(link, address.dnsName) })),
		};
	}
	async delete(id: string) { requireId(id); await this.ports.store.delete(id); return { ok: true as const }; }
	async ensure() {
		const zeroTier = await this.zeroTier();
		if (await this.shouldExit()) return { serving: false };
		const address = zeroTier ?? await this.ports.tailscale.address();
		if (!await this.ports.launcher.isRunning(this.port, address)) await this.ports.launcher.start(this.port, address);
		return { serving: true };
	}
}
