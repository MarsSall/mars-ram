// Why a saved computer does not answer when the phone's VPN explains it: Android runs one VPN at a time.
import type { HostNetwork } from "./host-catalog";
import { activePhoneVpn, type PhoneNetworkState } from "./phone-network";

/** `switch`: the phone runs the other network; `turn-on`: no VPN is on in the phone. */
export type NetworkHint = { kind: "switch"; network: HostNetwork; active: HostNetwork } | { kind: "turn-on"; network: HostNetwork };

/**
 * The hint that replaces «no responde», or null to keep it: a reachable computer, the computer's own network on,
 * or a phone that cannot tell. Reachability is decided elsewhere; a computer that answers anyway never gets a hint.
 */
export function unreachableHint(network: HostNetwork, phone: PhoneNetworkState | null, reachable: boolean): NetworkHint | null {
	if (reachable) return null;
	const active = activePhoneVpn(phone);
	if (active === null || active === network) return null;
	return active === "none" ? { kind: "turn-on", network } : { kind: "switch", network, active };
}
