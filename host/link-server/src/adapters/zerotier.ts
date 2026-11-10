// This computer's ZeroTier addresses, read from its network interfaces (the ZeroTier CLI needs root).
import { networkInterfaces } from "node:os";
import { isIpv4, zeroTierEntries, type InterfaceTable } from "../../../../packages/protocol/src/private-network.ts";
import type { ListenAddress } from "../core/ports.ts";

export { isIpv4 };

/** Accepts only an IPv4 currently on a ZeroTier interface: never a wildcard, loopback or LAN address. */
export function createZeroTier(read: () => InterfaceTable = networkInterfaces, platform: string = process.platform) {
	return {
		async address(ip: string): Promise<ListenAddress> {
			let found = false;
			try { found = isIpv4(ip) && zeroTierEntries(read(), platform).some(entry => entry.address === ip); } catch { /* Unreadable interfaces hold no ZeroTier address. */ }
			if (!found) throw new Error("ZeroTier address not found on this computer's ZeroTier interfaces. Check ZeroTier and the paired address.");
			return { ip, dnsName: ip, network: "zerotier" };
		},
	};
}
export const zerotier = createZeroTier();
