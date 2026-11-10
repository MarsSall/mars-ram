// What the connection wizard can learn about this phone's side of the connection, and the system screens it can open.

export type PhoneNetworkState = {
	/** The Tailscale app (com.tailscale.ipn) is installed. */
	tailscaleInstalled: boolean;
	/** A VPN is active and the phone has a Tailscale address (100.64.0.0/10). */
	tailscaleOn: boolean;
	/** Android Private DNS is active, which can break MagicDNS names. Null when the system cannot tell (Android < 9). */
	privateDnsActive: boolean | null;
	/** The ZeroTier app (com.zerotier.one) is installed. Missing when the phone could not tell. */
	zerotierInstalled?: boolean;
	/** Some VPN is active. Android does not say which app owns it. Missing when the phone could not tell. */
	vpnOn?: boolean;
};

/**
 * ZeroTier on this phone, or null when the phone gave no ZeroTier facts. Android allows one VPN at a time and
 * does not tell which app runs it, so ZeroTier counts as on when a VPN is active without a Tailscale address.
 */
export function zeroTierPhone(network: PhoneNetworkState | null): { installed: boolean; on: boolean } | null {
	if (!network || network.zerotierInstalled === undefined || network.vpnOn === undefined) return null;
	return { installed: network.zerotierInstalled, on: network.zerotierInstalled && network.vpnOn && !network.tailscaleOn };
}

export type PhoneNetwork = {
	read(): Promise<PhoneNetworkState>;
	/** Opens the Play Store page of the Tailscale app. */
	installTailscale(): Promise<void>;
	/** Opens the Tailscale app. */
	openTailscale(): Promise<void>;
	/** Opens the Play Store page of the ZeroTier app. */
	installZeroTier(): Promise<void>;
	/** Opens the ZeroTier app, or its store page when it is not installed. */
	openZeroTier(): Promise<void>;
	/** Opens the closest system screen to the Private DNS setting. */
	openPrivateDnsSettings(): Promise<void>;
};
