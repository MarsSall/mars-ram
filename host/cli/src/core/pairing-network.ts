// Which private network pairing uses and the one address it listens on: Tailscale unless the user asks for ZeroTier.
import type { PairingNetworkPorts } from "./ports.ts";

export type { PairingNetworkPorts } from "./ports.ts";

export type PairingTarget = { ok: true; network: "tailscale"; address: string; dnsName?: string } | { ok: true; network: "zerotier"; address: string };

export function resolvePairingTarget(choice: { network?: "zerotier"; address?: string }, ports: PairingNetworkPorts): PairingTarget | { ok: false; message: string } {
	if (choice.network !== "zerotier") {
		const tailscale = ports.tailscale();
		if (!tailscale.ok) return tailscale;
		return { ok: true, network: "tailscale", address: tailscale.address, ...(tailscale.dnsName ? { dnsName: tailscale.dnsName } : {}) };
	}
	const addresses = ports.zeroTierAddresses();
	if (addresses.length === 0) {
		return { ok: false, message: "ZeroTier is not connected on this computer: no ZeroTier network address found. Join a network and authorize this computer, then try again." };
	}
	const list = addresses.join(", ");
	if (choice.address !== undefined) {
		// Listening anywhere else would expose pairing outside the ZeroTier network.
		if (!addresses.includes(choice.address)) return { ok: false, message: `${choice.address} is not a ZeroTier address of this computer. Its ZeroTier addresses: ${list}.` };
		return { ok: true, network: "zerotier", address: choice.address };
	}
	if (addresses.length > 1) {
		return { ok: false, message: `This computer has several ZeroTier addresses: ${list}. Choose one with --address <ipv4>, for example mars-ram pair-zt --address ${addresses[0]}` };
	}
	return { ok: true, network: "zerotier", address: addresses[0]! };
}
