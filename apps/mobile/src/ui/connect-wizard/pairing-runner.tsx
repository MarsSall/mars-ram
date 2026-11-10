import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { pairingFailureMessage } from "../../core/pair-link";
import type { PairingFailureCode, PairingProgress as PairingStage } from "../../core/pairing";
import { pair } from "../../services";
import { usePreferences } from "../preferences";

export type PairingPhase =
	| { kind: "idle" }
	/** `since` is when the current stage started; names arrive once the QR is read. */
	| { kind: "pairing"; stage: PairingStage["stage"]; since: number; computerName?: string; deviceName?: string }
	/** network: set when a ZeroTier offer failed, whatever network the wizard guides through. */
	| { kind: "failed"; message: string; code?: PairingFailureCode; computerName?: string; network?: "zerotier" };

/** Pairs with a scanned QR or a confirmed link the same way: one run at a time, then the computer's screen or a localized failure. */
export function usePairingRunner() {
	const router = useRouter();
	const { t } = usePreferences();
	const [phase, setPhase] = useState<PairingPhase>({ kind: "idle" });
	// The scanner reports the same code many times per second; pair only once.
	const busy = useRef(false);
	const run = async (uri: string) => {
		if (busy.current) return;
		busy.current = true;
		setPhase({ kind: "pairing", stage: "reaching", since: Date.now() });
		let computerName: string | undefined;
		const onProgress = (progress: PairingStage) => {
			computerName = progress.computerName;
			setPhase({ kind: "pairing", stage: progress.stage, since: Date.now(), computerName: progress.computerName, deviceName: progress.deviceName });
		};
		const result = await pair(uri, t.add.unlockTitle, onProgress);
		if (result.ok) {
			router.replace({ pathname: "/computer/[id]", params: { id: result.host.id } });
			return;
		}
		setPhase({ kind: "failed", message: pairingFailureMessage(result, t.add), code: result.code, computerName, network: result.network });
	};
	/** Back to scanning; only after a failure, since a running pairing cannot be stopped. */
	const reset = () => {
		busy.current = false;
		setPhase({ kind: "idle" });
	};
	return { phase, run, reset };
}

/** Shown while the computer's user decides; the request waits for their answer. */
export function PairingProgress() {
	const { theme, t } = usePreferences();
	const c = theme.colors;
	return (
		<View accessibilityLiveRegion="polite" style={{ padding: theme.spacing(6), gap: theme.spacing(4), alignItems: "center" }}>
			<ActivityIndicator size="large" color={c.accentText} />
			<Text style={{ color: c.text, fontSize: 17, fontWeight: "700", textAlign: "center" }}>{t.add.stepConfirm}</Text>
			<Text style={{ color: c.textMuted, fontSize: 15, textAlign: "center" }}>{t.add.stepConfirmHint}</Text>
		</View>
	);
}
