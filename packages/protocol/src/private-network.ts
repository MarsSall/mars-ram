// Literal IPv4 rules and ZeroTier interface detection shared by the CLI and the link server.
// Dependency-free: callers pass the interface table (node:os networkInterfaces) in.
export type InterfaceEntry = { address: string; family: string | number; internal: boolean; netmask: string };
export type InterfaceTable = Record<string, InterfaceEntry[] | undefined>;

/** Dotted-quad IPv4 without leading zeros, spaces, prefixes or DNS names. */
export function isIpv4(text: string): boolean {
	const parts = text.split(".");
	return parts.length === 4 && parts.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
}
const value = (address: string) => address.split(".").reduce((sum, part) => sum * 256 + Number(part), 0);

/** Prefix length of a contiguous IPv4 netmask, or null for anything else. */
export function ipv4Prefix(netmask: string): number | null {
	if (!isIpv4(netmask)) return null;
	const bits = value(netmask).toString(2).padStart(32, "0");
	if (!/^1*0*$/.test(bits)) return null;
	const zero = bits.indexOf("0");
	return zero === -1 ? 32 : zero;
}

/** Whether address is inside network/prefix; both must be literal IPv4. */
export function inSubnet(address: string, network: string, prefix: number): boolean {
	if (!isIpv4(address) || !isIpv4(network) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
	const size = 2 ** (32 - prefix);
	return Math.floor(value(address) / size) === Math.floor(value(network) / size);
}

/** ZeroTier names its interfaces zt… on Linux and feth… on macOS; Windows adapters are named "ZeroTier One [<network id>]". */
export function isZeroTierInterface(name: string, platform: string): boolean {
	if (platform === "win32") return /zerotier/i.test(name);
	if (platform === "darwin") return /^(feth|zt)/.test(name);
	return name.startsWith("zt");
}

/** IPv4 addresses on ZeroTier interfaces with the interface holding each and its prefix (null if the mask is unreadable), each address once; link-local addresses mean the network has not assigned one yet. */
export function zeroTierEntries(table: InterfaceTable, platform: string): { name: string; address: string; prefix: number | null }[] {
	const found = new Map<string, { name: string; address: string; prefix: number | null }>();
	for (const [name, entries] of Object.entries(table)) {
		if (!isZeroTierInterface(name, platform)) continue;
		for (const entry of entries ?? []) {
			if (entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254.") && !found.has(entry.address)) found.set(entry.address, { name, address: entry.address, prefix: ipv4Prefix(entry.netmask) });
		}
	}
	return [...found.values()];
}
