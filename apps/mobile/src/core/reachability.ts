// Whether a saved computer answers, without unlocking the key: only the SSH server's greeting is read.
import type { SavedHost } from "./host-catalog";

export type Reachability = "reachable" | "unreachable";

/** probe(address, port) resolves true when an SSH server answers there. */
export async function checkReachability(probe: (address: string, port: number) => Promise<boolean>, host: SavedHost): Promise<Reachability> {
	const addresses = host.dnsName ? [host.dnsName, host.address] : [host.address];
	for (const address of addresses) {
		if (await probe(address, host.sshPort)) return "reachable";
	}
	return "unreachable";
}
