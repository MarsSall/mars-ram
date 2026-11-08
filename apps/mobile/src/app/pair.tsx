// `<scheme>://pair?p=…` from `mars-ram pair`: any app or page can open it, so ask before sending the key (PRD R1).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { readPairLink } from "../core/pair-link";
import { PrimaryButton, Screen } from "../ui/components";
import { usePreferences } from "../ui/preferences";
import { PairingProgress, usePairingRunner } from "./add-computer/scan";

export default function PairScreen() {
	const router = useRouter();
	const { theme, t } = usePreferences();
	const { p } = useLocalSearchParams<{ p?: string | string[] }>();
	const [openedAt] = useState(Date.now);
	const link = useMemo(() => readPairLink(p, openedAt), [p, openedAt]);
	const { phase, run } = usePairingRunner();
	const c = theme.colors;
	const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));

	const header = (
		<View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: theme.spacing(2), paddingVertical: theme.spacing(2) }}>
			<Pressable onPress={leave} accessibilityRole="button" accessibilityLabel={t.session.back} style={{ width: theme.touch, height: theme.touch, alignItems: "center", justifyContent: "center" }}>
				<Ionicons name="chevron-back" size={26} color={c.accentText} />
			</Pressable>
			<View>
				<Text style={{ color: c.textMuted, fontSize: 13 }}>{t.computers.title}</Text>
				<Text accessibilityRole="header" style={{ color: c.text, fontSize: 19, fontWeight: "700" }}>{t.add.title}</Text>
			</View>
		</View>
	);
	const failure = (message: string) => (
		<View style={{ padding: theme.spacing(6), gap: theme.spacing(2) }}>
			<Text style={{ color: c.text, fontSize: 17, textAlign: "center" }}>{t.add.failedTitle}</Text>
			<Text style={{ color: c.textMuted, fontSize: 14, textAlign: "center" }}>{message}</Text>
		</View>
	);
	const scanFooter = <PrimaryButton label={t.pair.scan} onPress={() => router.replace("/add-computer/scan")} />;
	const detail = (label: string, value: string) => (
		<View style={{ gap: theme.spacing(1) }}>
			<Text style={{ color: c.textMuted, fontSize: 13 }}>{label}</Text>
			<Text selectable style={{ color: c.text, fontSize: 17, fontWeight: "600" }}>{value}</Text>
		</View>
	);

	let body;
	let footer;
	if (!link.ok) {
		body = failure(t.add.failures[link.code]);
		footer = scanFooter;
	} else if (phase.kind === "pairing") {
		body = <PairingProgress />;
	} else if (phase.kind === "failed") {
		body = failure(phase.message);
		footer = scanFooter;
	} else {
		body = (
			<View style={{ padding: theme.spacing(6), gap: theme.spacing(4) }}>
				<Text accessibilityRole="header" style={{ color: c.text, fontSize: 22, fontWeight: "700" }}>{t.pair.title}</Text>
				<View style={{ backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: theme.radius.medium, padding: theme.spacing(4), gap: theme.spacing(3) }}>
					{detail(t.add.name, link.offer.name)}
					{detail(t.add.address, link.offer.address)}
				</View>
				<Text style={{ color: c.textMuted, fontSize: 15 }}>{t.pair.explain}</Text>
			</View>
		);
		// Nothing leaves the phone before this button.
		footer = (
			<View style={{ paddingBottom: theme.spacing(2) }}>
				<PrimaryButton label={t.pair.add} onPress={() => void run(link.offer.uri)} />
				<Pressable onPress={leave} accessibilityRole="button" style={{ minHeight: theme.touch, alignItems: "center", justifyContent: "center", marginHorizontal: theme.spacing(4) }}>
					<Text style={{ color: c.accentText, fontSize: 16, fontWeight: "600" }}>{t.pair.cancel}</Text>
				</Pressable>
			</View>
		);
	}

	return (
		<Screen footer={footer}>
			{header}
			{body}
		</Screen>
	);
}
