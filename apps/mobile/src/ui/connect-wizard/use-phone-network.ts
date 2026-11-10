import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import type { PhoneNetworkState } from "../../core/phone-network";
import { phoneNetwork } from "../../services";

/** A read that fails counts as unknown, never as passing. */
async function readPhone(): Promise<PhoneNetworkState | null> {
	try {
		return await phoneNetwork.read();
	} catch {
		return null;
	}
}

/** Reads the phone's checks now and every time the app returns to the front (the user went to fix something); only the latest read is reported. */
export function usePhoneNetwork(onRead: (network: PhoneNetworkState | null) => void) {
	const latest = useRef(0);
	const report = useRef(onRead);
	report.current = onRead;
	const readNow = useCallback(async () => {
		const id = ++latest.current;
		const network = await readPhone();
		if (id === latest.current) report.current(network);
		return network;
	}, []);
	useEffect(() => {
		void readNow();
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") void readNow();
		});
		return () => subscription.remove();
	}, [readNow]);
	return { readNow };
}

export const phoneActions = {
	installTailscale: () => phoneNetwork.installTailscale(),
	openTailscale: () => phoneNetwork.openTailscale(),
	installZeroTier: () => phoneNetwork.installZeroTier(),
	openZeroTier: () => phoneNetwork.openZeroTier(),
	openPrivateDnsSettings: () => phoneNetwork.openPrivateDnsSettings(),
};
