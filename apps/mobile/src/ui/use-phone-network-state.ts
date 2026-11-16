// The phone's VPN facts for status screens: read on mount, when the app returns to the front, and whenever `refresh` changes.
import { useEffect, useState } from "react";
import type { PhoneNetworkState } from "../core/phone-network";
import { usePhoneNetwork } from "./connect-wizard/use-phone-network";

/** null until read and when the read fails: the screens then keep their usual status. */
export function usePhoneNetworkState(refresh: unknown): PhoneNetworkState | null {
	const [network, setNetwork] = useState<PhoneNetworkState | null>(null);
	const { readNow } = usePhoneNetwork(setNetwork);
	useEffect(() => {
		void readNow();
	}, [readNow, refresh]);
	return network;
}
