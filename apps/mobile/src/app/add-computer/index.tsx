import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { pairingFailureMessage } from "../../core/pair-link";
import { pair } from "../../services";
import { PrimaryButton, Screen } from "../../ui/components";
import { usePreferences } from "../../ui/preferences";

export type PairingPhase = { kind: "idle" } | { kind: "pairing" } | { kind: "failed"; message: string };

/** Pairs with a scanned QR or a confirmed link the same way: one run at a time, then the computer's screen or a localized failure. */
export function usePairingRunner() {
	const { t } = usePreferences();
	const [phase, setPhase] = useState<PairingPhase>({ kind: "idle" });
	// The scanner reports the same code many times per second; pair only once.
	const busy = useRef(false);
	const run = async (uri: string) => {
		if (busy.current) return;
		busy.current = true;
		setPhase({ kind: "pairing" });
		const result = await pair(uri, t.add.unlockTitle);
		if (result.ok) {
			router.replace({ pathname: "/computer/[id]", params: { id: result.host.id } });
			return;
		}
		setPhase({ kind: "failed", message: pairingFailureMessage(result, t.add) });
	};
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

export default function AddComputerScreen() {
	const { theme, t } = usePreferences();
	const [permission, requestPermission] = useCameraPermissions();
	const [cameraReady, setCameraReady] = useState(false);
	const [permissionPending, setPermissionPending] = useState(false);
	const { phase, run, reset } = usePairingRunner();
	const c = theme.colors;

	const header = (
		<View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: theme.spacing(2), paddingVertical: theme.spacing(2) }}>
			<Pressable onPress={() => router.back()} accessibilityLabel={t.session.back} style={{ width: theme.touch, height: theme.touch, alignItems: "center", justifyContent: "center" }}>
				<Ionicons name="chevron-back" size={26} color={c.accentText} />
			</Pressable>
			<View>
				<Text style={{ color: c.textMuted, fontSize: 13 }}>{t.computers.title}</Text>
				<Text style={{ color: c.text, fontSize: 19, fontWeight: "700" }}>{t.add.title}</Text>
			</View>
		</View>
	);
	const manualLink = (
		<Pressable onPress={() => router.push("/add-computer/manual")} accessibilityRole="link" style={{ minHeight: theme.touch, alignItems: "center", justifyContent: "center" }}>
			<Text style={{ color: c.accentText, fontSize: 15, fontWeight: "600" }}>{t.add.manualLink}</Text>
		</Pressable>
	);
	const message = (text: string, hint?: string) => (
		<View style={{ padding: theme.spacing(6), gap: theme.spacing(2) }}>
			<Text style={{ color: c.text, fontSize: 17, textAlign: "center" }}>{text}</Text>
			{hint ? <Text style={{ color: c.textMuted, fontSize: 14, textAlign: "center" }}>{hint}</Text> : null}
		</View>
	);

	const cameraLoading = <View accessibilityLiveRegion="polite" style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: c.background, justifyContent: "center", alignItems: "center", gap: theme.spacing(2) }}><ActivityIndicator color={c.accentText} /><Text style={{ color: c.text }}>{t.add.cameraOpening}</Text></View>;
	let body;
	if (phase.kind === "pairing") {
		body = <PairingProgress />;
	} else if (phase.kind === "failed") {
		body = (
			<>
				{message(t.add.failedTitle, phase.message)}
				<PrimaryButton
					label={t.add.scanAgain}
					onPress={() => {
						setCameraReady(false);
						reset();
					}}
				/>
				{manualLink}
			</>
		);
	} else if (!permission || permissionPending) {
		body = <View style={{ marginHorizontal: theme.spacing(6), aspectRatio: 1, borderRadius: theme.radius.large, overflow: "hidden" }}>{cameraLoading}</View>;
	} else if (!permission.granted) {
		body = (
			<>
				{message(permission.canAskAgain ? t.add.cameraNeeded : t.add.cameraDenied)}
				{permission.canAskAgain ? <PrimaryButton label={t.add.allowCamera} onPress={() => { setPermissionPending(true); void requestPermission().finally(() => setPermissionPending(false)); }} /> : null}
				{manualLink}
			</>
		);
	} else {
		body = (
			<>
				{message(t.add.scanTitle, t.add.scanHint)}
				<View style={{ marginHorizontal: theme.spacing(6), aspectRatio: 1, borderRadius: theme.radius.large, overflow: "hidden", borderWidth: 2, borderColor: c.accentText }}>
					<CameraView onCameraReady={() => setCameraReady(true)} style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={({ data }) => void run(data)} />
					{!cameraReady ? cameraLoading : null}
				</View>
				{manualLink}
			</>
		);
	}

	return (
		<Screen>
			{header}
			{body}
		</Screen>
	);
}
