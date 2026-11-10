// Linux firewalls (ufw, firewalld) block ZeroTier by default; Tailscale lets itself through with its own rules.
// Only explains the fix: never runs sudo or changes the firewall.
import type { PairingTarget } from "./pairing-network.ts";

export type FirewallStatus = "active" | "inactive" | "unknown";
export type FirewallState = { ufw: FirewallStatus; firewalld: FirewallStatus };
export type Firewall = keyof FirewallState;

export type PairingFirewallPorts = {
	/** Read without root: ufw rules themselves are not readable. */
	firewall(): FirewallState;
	/** Name of the ZeroTier interface holding this address. */
	zeroTierInterface(address: string): string | undefined;
};

// Interface names end up in a command the user pastes into a shell.
const PLACEHOLDER = "<ZeroTier interface>";
const safeName = (name: string | undefined) => (name && /^[A-Za-z0-9_.-]+$/.test(name) ? name : PLACEHOLDER);

const commands: Record<Firewall, (iface: string) => string> = {
	ufw: (iface) => `sudo ufw allow in on ${iface} comment 'ZeroTier'`,
	firewalld: (iface) => `sudo firewall-cmd --permanent --zone=trusted --add-interface=${iface} && sudo firewall-cmd --reload`,
};

/** The command that lets ZeroTier in through each active firewall; unknown states suggest nothing. */
export function firewallFixes(state: FirewallState, iface: string | undefined): { firewall: Firewall; command: string }[] {
	return (Object.keys(commands) as Firewall[]).filter((firewall) => state[firewall] === "active").map((firewall) => ({ firewall, command: commands[firewall](safeName(iface)) }));
}

/** One line per active firewall for `mars-ram pair-zt`; Tailscale pairing never reads the firewall. */
export function pairingFirewallHints(target: PairingTarget, ports: PairingFirewallPorts, spanish: boolean): string[] {
	if (target.network !== "zerotier") return [];
	let state: FirewallState;
	try { state = ports.firewall(); } catch { return []; }
	if (state.ufw !== "active" && state.firewalld !== "active") return [];
	return firewallFixes(state, ports.zeroTierInterface(target.address)).map(({ firewall, command }) => spanish
		? `El firewall (${firewall}) está activo y puede bloquear al teléfono por ZeroTier. Si el emparejamiento no conecta, ejecutá: ${command}`
		: `The firewall (${firewall}) is on and may block the phone over ZeroTier. If pairing does not connect, run: ${command}`);
}
