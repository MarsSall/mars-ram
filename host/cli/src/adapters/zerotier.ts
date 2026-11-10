// Reads this computer's ZeroTier addresses from its network interfaces, without the ZeroTier CLI, which needs root.
// The name and address rules are shared with the link server (@workspace/protocol/private-network).
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { zeroTierEntries } from "@workspace/protocol/private-network";

export type InterfaceReader = () => NodeJS.Dict<NetworkInterfaceInfo[]>;

/** IPv4 addresses on ZeroTier interfaces with the interface holding each, each address once. */
export function zeroTierInterfaces(read: InterfaceReader = networkInterfaces, platform: NodeJS.Platform = process.platform): { name: string; address: string }[] {
	return zeroTierEntries(read(), platform).map(({ name, address }) => ({ name, address }));
}

/** IPv4 addresses on ZeroTier interfaces, each once. */
export function zeroTierAddresses(read: InterfaceReader = networkInterfaces, platform: NodeJS.Platform = process.platform): string[] {
	return zeroTierInterfaces(read, platform).map((entry) => entry.address);
}

/** ZeroTier addresses with their subnet prefix, for checking where a Siempre atento registration comes from. */
export function zeroTierNetworks(read: InterfaceReader = networkInterfaces, platform: NodeJS.Platform = process.platform): { address: string; prefix: number | null }[] {
	return zeroTierEntries(read(), platform).map(({ address, prefix }) => ({ address, prefix }));
}
