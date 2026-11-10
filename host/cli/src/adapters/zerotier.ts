// Reads this computer's ZeroTier addresses from its network interfaces, without the ZeroTier CLI, which needs root.
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

export type InterfaceReader = () => NodeJS.Dict<NetworkInterfaceInfo[]>;

/** ZeroTier names its interfaces zt… on Linux and feth… on macOS; Windows adapters are named "ZeroTier One [<network id>]". */
function isZeroTierInterface(name: string, platform: NodeJS.Platform): boolean {
	if (platform === "win32") return /zerotier/i.test(name);
	if (platform === "darwin") return /^(feth|zt)/.test(name);
	return name.startsWith("zt");
}

/** IPv4 addresses on ZeroTier interfaces with the interface holding each, each address once; link-local addresses mean the network has not assigned one yet. */
export function zeroTierInterfaces(read: InterfaceReader = networkInterfaces, platform: NodeJS.Platform = process.platform): { name: string; address: string }[] {
	const found = new Map<string, string>();
	for (const [name, entries] of Object.entries(read())) {
		if (!isZeroTierInterface(name, platform)) continue;
		for (const entry of entries ?? []) {
			if (entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254.") && !found.has(entry.address)) found.set(entry.address, name);
		}
	}
	return [...found].map(([address, name]) => ({ name, address }));
}

/** IPv4 addresses on ZeroTier interfaces, each once. */
export function zeroTierAddresses(read: InterfaceReader = networkInterfaces, platform: NodeJS.Platform = process.platform): string[] {
	return zeroTierInterfaces(read, platform).map((entry) => entry.address);
}
