// The line that tells apart two saved computers with the same name: its network and how the app reaches it.
import { hostNetwork, type SavedHost } from "../core/host-catalog";
import type { Strings } from "./i18n/en";

/** «ZeroTier · mars@10.147.17.5»: the network plus the user@name-or-address the Computadoras list shows. */
export function hostRouteLine(t: Strings, host: Pick<SavedHost, "network" | "user" | "address" | "dnsName">): string {
	return `${t.wizard.networks[hostNetwork(host)]} · ${host.user}@${host.dnsName ?? host.address}`;
}
