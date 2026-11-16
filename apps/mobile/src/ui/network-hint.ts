// The words for an unreachable computer's network hint: a short status label and the full sentence.
import type { HostNetwork } from "../core/host-catalog";
import type { NetworkHint } from "../core/network-hint";
import type { Strings } from "./i18n/en";

const names: Record<HostNetwork, string> = { tailscale: "Tailscale", zerotier: "ZeroTier" };

export function networkHintText(t: Strings, hint: NetworkHint): { short: string; full: string } {
	const network = names[hint.network];
	return {
		short: t.networkHint.short(network),
		full: hint.kind === "switch" ? t.networkHint.switch(network, names[hint.active]) : t.networkHint.turnOn(network),
	};
}
