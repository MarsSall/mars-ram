import type { Readable } from "node:stream";

export type OpenCopy = { size: number; prefix: Buffer; stream: Readable; close(): Promise<void> };
export type Link = {
	id: string;
	token: string;
	fileName: string;
	size: number;
	contentKind: "image" | "download";
	mime: string;
	createdAt: string;
	expiresAt: string;
};
export type Metadata = Pick<Link, "id" | "token" | "createdAt" | "expiresAt">;
export type LinkStore = {
	// Without a cutoff, reads only. With one, also prunes older invalid registrations and staged files.
	all(pruneBefore?: number): Promise<Link[]>;
	// Includes incomplete and unsafe id entries; never repairs or prunes storage.
	invalidCount(): Promise<number>;
	create(name: string, metadata: Metadata): Promise<Link>;
	delete(id: string): Promise<void>;
	read(link: Link): Promise<Buffer>;
	open(link: Link): Promise<OpenCopy>;
};
export type TailnetAddress = { ip: string; dnsName: string };
/** Where one link-server process listens. Without a network it is the Tailscale address, as always;
 * a ZeroTier listener uses its verified IPv4 as the URL host. */
export type ListenAddress = TailnetAddress & { network?: "zerotier" };
export type ServerLauncher = {
	isRunning(port: number, address: ListenAddress): Promise<boolean>;
	start(port: number, address: ListenAddress): Promise<void>;
	/** ZeroTier listeners with an identity record, for status. */
	recorded?(): Promise<ListenAddress[]>;
};
export type Ports = {
	clock(): number;
	random(bytes: number): string;
	store: LinkStore;
	launcher: ServerLauncher;
	tailscale: { address(): Promise<TailnetAddress> };
	/** Resolves only an IPv4 currently on one of this computer's ZeroTier interfaces. */
	zerotier?: { address(ip: string): Promise<ListenAddress> };
};
