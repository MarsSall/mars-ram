// Which private network pairing uses and the one address it listens on: the one asked for, or the one connected.
import type { PairingNetworkPorts } from "./ports.ts";

export type { PairingNetworkPorts } from "./ports.ts";

export type PairingNetwork = "tailscale" | "zerotier";

export type PairingTarget = { ok: true; network: "tailscale"; address: string; dnsName?: string } | { ok: true; network: "zerotier"; address: string };

/** `choose` means both networks are connected and the user has to pick one. */
export type PairingTargetFailure = { ok: false; message: string; choose?: true };

const ZEROTIER_MISSING = "no ZeroTier network address found";

export function resolvePairingTarget(choice: { network?: PairingNetwork; address?: string }, ports: PairingNetworkPorts): PairingTarget | PairingTargetFailure {
	if (choice.network === "tailscale") return tailscaleTarget(ports.tailscale());
	if (choice.network === "zerotier") return zeroTierTarget(ports.zeroTierAddresses(), choice.address);
	const tailscale = ports.tailscale();
	const addresses = ports.zeroTierAddresses();
	if (tailscale.ok && addresses.length > 0) {
		return { ok: false, choose: true, message: "Tailscale and ZeroTier are both connected on this computer. Choose the one your phone uses with --network tailscale or --network zerotier." };
	}
	if (tailscale.ok) return tailscaleTarget(tailscale);
	if (addresses.length > 0) return zeroTierTarget(addresses, choice.address);
	return { ok: false, message: `No private network is connected on this computer. Tailscale: ${tailscale.message} ZeroTier: ${ZEROTIER_MISSING}. Connect Tailscale, or join a ZeroTier network and authorize this computer, then try again.` };
}

/** The answer to "which network": its number in the list or its name; anything else is no answer. */
export function networkFromAnswer(answer: string | null): PairingNetwork | null {
	const value = answer?.trim().toLowerCase();
	if (value === "1" || value === "tailscale") return "tailscale";
	if (value === "2" || value === "zerotier") return "zerotier";
	return null;
}

function tailscaleTarget(tailscale: ReturnType<PairingNetworkPorts["tailscale"]>): PairingTarget | PairingTargetFailure {
	if (!tailscale.ok) return tailscale;
	return { ok: true, network: "tailscale", address: tailscale.address, ...(tailscale.dnsName ? { dnsName: tailscale.dnsName } : {}) };
}

function zeroTierTarget(addresses: string[], address: string | undefined): PairingTarget | PairingTargetFailure {
	if (addresses.length === 0) {
		return { ok: false, message: `ZeroTier is not connected on this computer: ${ZEROTIER_MISSING}. Join a network and authorize this computer, then try again.` };
	}
	const list = addresses.join(", ");
	if (address !== undefined) {
		// Listening anywhere else would expose pairing outside the ZeroTier network.
		if (!addresses.includes(address)) return { ok: false, message: `${address} is not a ZeroTier address of this computer. Its ZeroTier addresses: ${list}.` };
		return { ok: true, network: "zerotier", address };
	}
	if (addresses.length > 1) {
		return { ok: false, message: `This computer has several ZeroTier addresses: ${list}. Choose one with --address <ipv4>, for example mars-ram pair --address ${addresses[0]}` };
	}
	return { ok: true, network: "zerotier", address: addresses[0]! };
}
