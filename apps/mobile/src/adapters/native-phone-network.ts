import { Platform } from "react-native";
import Ssh from "../../modules/ssh/src/SshModule";
import type { PhoneNetwork, PhoneNetworkState } from "../core/phone-network";

type NativeCalls = {
	phoneNetworkState(): Promise<unknown>;
	installTailscale(): Promise<void>;
	openTailscale(): Promise<void>;
	installZeroTier(): Promise<void>;
	openZeroTier(): Promise<void>;
	openPrivateDnsSettings(): Promise<void>;
};

/** Never blocks the wizard: Tailscale counts as present, Private DNS and ZeroTier as unknown. */
export const UNKNOWN_PHONE_NETWORK: PhoneNetworkState = { tailscaleInstalled: true, tailscaleOn: true, privateDnsActive: null };

/** Only real booleans count; anything else falls back to the state that does not block the user. */
export function parsePhoneNetworkState(raw: unknown): PhoneNetworkState {
	if (typeof raw !== "object" || raw === null) return UNKNOWN_PHONE_NETWORK;
	const value = raw as Record<string, unknown>;
	const flag = (key: string, fallback: boolean) => typeof value[key] === "boolean" ? value[key] as boolean : fallback;
	const state: PhoneNetworkState = {
		tailscaleInstalled: flag("tailscaleInstalled", UNKNOWN_PHONE_NETWORK.tailscaleInstalled),
		tailscaleOn: flag("tailscaleOn", UNKNOWN_PHONE_NETWORK.tailscaleOn),
		privateDnsActive: typeof value.privateDnsActive === "boolean" ? value.privateDnsActive : null,
	};
	// Left out, not guessed, when missing: the core then reads ZeroTier as unknown.
	if (typeof value.zerotierInstalled === "boolean") state.zerotierInstalled = value.zerotierInstalled;
	if (typeof value.vpnOn === "boolean") state.vpnOn = value.vpnOn;
	return state;
}

/**
 * The Tailscale and ZeroTier checks need Android APIs. Elsewhere (and when the native call fails) the state cannot be
 * known, so it reports the non-blocking state: the wizard never stops someone whose phone is fine.
 * Opening screens is best-effort and never rejects; the wizard always shows the path in text too.
 */
export function createPhoneNetwork(native: NativeCalls | null): PhoneNetwork {
	const open = (call: (n: NativeCalls) => Promise<void>) => async () => { if (native) await call(native).catch(() => {}); };
	return {
		read: async () => native ? parsePhoneNetworkState(await native.phoneNetworkState().catch(() => null)) : UNKNOWN_PHONE_NETWORK,
		installTailscale: open(n => n.installTailscale()),
		openTailscale: open(n => n.openTailscale()),
		installZeroTier: open(n => n.installZeroTier()),
		openZeroTier: open(n => n.openZeroTier()),
		openPrivateDnsSettings: open(n => n.openPrivateDnsSettings()),
	};
}

export const nativePhoneNetwork = createPhoneNetwork(Platform.OS === "android" ? Ssh : null);
