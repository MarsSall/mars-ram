// The scan step: the camera, then what is happening while pairing waits, then a failure with «Ver qué pasa».
import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Text, View, useWindowDimensions } from "react-native";
import { diagnosisOffered, phoneWarnings, slowOffer } from "../../core/connect-wizard";
import type { WizardNetwork } from "../../core/network-choice";
import type { PhoneNetworkState } from "../../core/phone-network";
import { PrimaryButton } from "../components";
import { usePreferences } from "../preferences";
import type { PairingPhase } from "./pairing-runner";
import { CheckRow, Panel, QuietButton, SecondaryButton, StepTitle } from "./parts";
import { StepLayout } from "./phone-steps";

type ScanStepProps = {
	top: ReactNode;
	network: PhoneNetworkState | null;
	/** Only picks the warnings; a scanned offer pairs over its own network. */
	choice: WizardNetwork;
	phase: PairingPhase;
	run: (uri: string) => void;
	reset: () => void;
	onDiagnose: () => void;
	onManual: () => void;
};

/** Seconds tick only while pairing runs, for «Hace N s» and the 15 s «Ver qué pasa». */
function useNow(running: boolean) {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (!running) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 1_000);
		return () => clearInterval(timer);
	}, [running]);
	return now;
}

export function ScanStep({ top, network, choice, phase, run, reset, onDiagnose, onManual }: ScanStepProps) {
	const { theme, t } = usePreferences();
	const c = theme.colors;
	const [permission, requestPermission] = useCameraPermissions();
	const [permissionPending, setPermissionPending] = useState(false);
	const [cameraReady, setCameraReady] = useState(false);
	const { height } = useWindowDimensions();
	const now = useNow(phase.kind === "pairing");
	const manual = <QuietButton role="link" label={t.add.manualLink} onPress={onManual} />;

	if (phase.kind === "pairing") {
		const name = phase.computerName ?? t.wizard.someComputer;
		const reached = phase.stage === "confirming";
		const seconds = Math.max(0, Math.floor((now - phase.since) / 1_000));
		return (
			<StepLayout top={top}>
				<StepTitle>{t.wizard.connecting(name)}</StepTitle>
				<Panel>
					<CheckRow state="ok" title={t.wizard.codeRead} />
					<CheckRow live state={reached ? "ok" : "running"} title={reached ? t.wizard.reached : t.wizard.reaching} hint={reached ? undefined : t.wizard.elapsed(seconds)} />
					<CheckRow state={reached ? "running" : "pending"} title={t.wizard.confirm} hint={t.wizard.willAsk}>
						{/* The question names this phone; its key fingerprint is not known to the app, so it is not shown. */}
						<View accessible accessibilityLabel={`${t.wizard.questionLabel}: ${t.wizard.question(phase.deviceName ?? "…")}`} style={{ marginTop: theme.spacing(2), backgroundColor: c.terminalBackground, borderColor: c.border, borderWidth: 1, borderRadius: theme.radius.medium, padding: theme.spacing(3) }}>
							<Text style={{ color: c.terminalText, fontFamily: theme.font.mono, fontSize: 13, lineHeight: 20 }}>{t.wizard.question(phase.deviceName ?? "…")}</Text>
						</View>
						<Text style={{ color: c.textMuted, fontSize: 14, marginTop: theme.spacing(2) }}>{t.wizard.answer}</Text>
					</CheckRow>
				</Panel>
				{slowOffer(phase, now) ? (
					<Panel tone="warning">
						<View accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: theme.spacing(2), alignItems: "flex-start" }}>
							<Ionicons name="warning-outline" size={20} color={c.attention} accessible={false} />
							<Text style={{ flex: 1, color: c.text, fontSize: 15 }}>{t.wizard.slow}</Text>
						</View>
						<SecondaryButton label={t.wizard.seeWhy} onPress={onDiagnose} />
					</Panel>
				) : null}
			</StepLayout>
		);
	}

	if (phase.kind === "failed") {
		return (
			<StepLayout
				top={top}
				footer={
					<>
						<PrimaryButton
							label={t.wizard.scanAgain}
							onPress={() => {
								setCameraReady(false);
								reset();
							}}
						/>
						{manual}
					</>
				}
			>
				<View accessibilityRole="alert">
					<StepTitle lead={phase.message}>{t.add.failedTitle}</StepTitle>
				</View>
				{diagnosisOffered(phase.code) ? (
					<View style={{ paddingHorizontal: theme.spacing(4) }}>
						<SecondaryButton label={t.wizard.seeWhy} onPress={onDiagnose} />
					</View>
				) : null}
			</StepLayout>
		);
	}

	const warnings = phoneWarnings(network, choice);
	const warningCard = warnings.length ? (
		<Panel tone="warning">
			<View accessible accessibilityRole="alert" style={{ gap: theme.spacing(1) }}>
				<View style={{ flexDirection: "row", gap: theme.spacing(2), alignItems: "flex-start" }}>
					<Ionicons name="warning-outline" size={20} color={c.attention} accessible={false} />
					<Text style={{ flex: 1, color: c.text, fontSize: 15 }}>{t.wizard.scanWarning}</Text>
				</View>
				{warnings.map((warning) => (
					<Text key={warning} style={{ color: c.text, fontSize: 15, paddingLeft: 28 }}>• {t.wizard.warnings[warning]}</Text>
				))}
			</View>
		</Panel>
	) : null;
	const loading = (
		<View accessibilityLiveRegion="polite" style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: c.background, justifyContent: "center", alignItems: "center", gap: theme.spacing(2) }}>
			<ActivityIndicator color={c.accentText} />
			<Text style={{ color: c.text }}>{t.add.cameraOpening}</Text>
		</View>
	);
	let camera: ReactNode;
	let footer: ReactNode = manual;
	if (!permission || permissionPending) {
		camera = <View style={{ marginHorizontal: theme.spacing(4), aspectRatio: 1, borderRadius: theme.radius.large, overflow: "hidden" }}>{loading}</View>;
	} else if (!permission.granted) {
		camera = <Text style={{ color: c.text, fontSize: 16, paddingHorizontal: theme.spacing(4) }}>{permission.canAskAgain ? t.add.cameraNeeded : t.add.cameraDenied}</Text>;
		if (permission.canAskAgain) {
			footer = (
				<>
					<PrimaryButton
						label={t.add.allowCamera}
						onPress={() => {
							setPermissionPending(true);
							void requestPermission().finally(() => setPermissionPending(false));
						}}
					/>
					{manual}
				</>
			);
		}
	} else {
		camera = (
			<View style={{ marginHorizontal: theme.spacing(4), height: height * (warnings.length ? 0.4 : 0.5), borderRadius: theme.radius.large, overflow: "hidden", borderWidth: 2, borderColor: c.accentText }}>
				<CameraView onCameraReady={() => setCameraReady(true)} style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={({ data }) => void run(data)} />
				{!cameraReady ? loading : null}
			</View>
		);
	}
	return (
		<StepLayout top={top} footer={footer}>
			<StepTitle lead={t.add.scanHint}>{t.wizard.scanTitle}</StepTitle>
			{warningCard}
			{camera}
		</StepLayout>
	);
}
