// Ajustes (S9): the frequent things on top — Personalización, Notificaciones, «Más ajustes» and a compact «Acerca de».
import { useState } from "react";
import Constants from "expo-constants";
import { appBuild, startTour } from "../../services";
import { AppUpdateNotice } from "../../ui/app-update-notice";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { registerSecretTap, SECRET_TAP_GAP_MS, type SecretTaps } from "../../core/secret-taps";
import { GiftCodeDialog } from "../../ui/gift-code-dialog";
import { NotificationSettingsCard } from "../../ui/notification-settings";
import { TourAnchor } from "../../ui/tour/anchors";
import { useTourScroll } from "../../ui/tour/scroll";
import { Card, Screen, SectionTitle } from "../../ui/components";
import { usePreferences } from "../../ui/preferences";

export default function SettingsScreen() {
	const router = useRouter();
	const { theme, t } = usePreferences();
	const [secretTaps, setSecretTaps] = useState<SecretTaps | null>(null);
	const [tapsLeft, setTapsLeft] = useState<number | null>(null);
	const [giftDialog, setGiftDialog] = useState(false);
	const version = appBuild.version ?? Constants.expoConfig?.version ?? t.settings.unknownVersion;
	// Hidden gesture: seven quick taps on the version open the gift code field.
	const tapVersion = () => {
		const result = registerSecretTap(secretTaps, Date.now());
		setSecretTaps(result.state);
		setTapsLeft(result.remaining);
		if (result.open) setGiftDialog(true);
		if (result.remaining !== null) { const shown = result.remaining; setTimeout(() => setTapsLeft(left => (left === shown ? null : left)), SECRET_TAP_GAP_MS); }
	};
	const tourScroll = useTourScroll();
	const row = (text: string, value: string) => (
		<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
			<Text style={{ color: theme.colors.text, fontSize: 16, flex: 1 }}>{text}</Text>
			<Text style={{ color: theme.colors.textMuted }}>{value}</Text>
		</View>
	);
	// A row that opens another screen: name, a short summary of what is inside, and the chevron.
	const navRow = (text: string, summary: string) => (
		<View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing(2) }}>
			<Text style={{ color: theme.colors.text, fontSize: 16 }}>{text}</Text>
			<Text numberOfLines={1} style={{ color: theme.colors.textMuted, flex: 1, textAlign: "right" }}>{summary}</Text>
			<Text style={{ color: theme.colors.textMuted }}>›</Text>
		</View>
	);
	return (
		<Screen title={t.settings.title}>
			<ScrollView {...tourScroll.props} contentContainerStyle={{ paddingBottom: theme.spacing(8) }}>
				<Card onPress={() => router.push("/personalization")}>{navRow(t.settings.personalization, t.settings.personalizationSummary)}</Card>
				<TourAnchor id="settings.notifications" inset={{ horizontal: theme.spacing(2) }} onLayout={tourScroll.place("settings.notifications")}><NotificationSettingsCard /></TourAnchor>
				<Card onPress={() => router.push("/more-settings")} style={{ marginTop: theme.spacing(2) }}>{navRow(t.settings.more, t.settings.moreSummary)}</Card>
				<SectionTitle>{t.settings.about}</SectionTitle>
				<AppUpdateNotice />
				<TourAnchor id="settings.about" inset={{ horizontal: theme.spacing(2) }} onLayout={tourScroll.place("settings.about")}>
				<Card>
					<Pressable accessibilityLabel={`${t.settings.version} ${version}`} onPress={tapVersion} style={{ minHeight: theme.touch, justifyContent: "center" }}>
						{row(t.settings.version, version)}
						{tapsLeft !== null ? <Text accessibilityLiveRegion="polite" style={{ alignSelf: "flex-end", marginTop: theme.spacing(1), color: theme.colors.accentText, backgroundColor: theme.colors.surfaceRaised, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: theme.spacing(2.5), paddingVertical: theme.spacing(1), fontSize: 12 }}>{t.gifts.tapsLeft(tapsLeft)}</Text> : null}
					</Pressable>
					<Pressable accessibilityRole="button" onPress={() => router.push("/whats-new")} style={{ minHeight: 48, justifyContent: "center" }}>
						<Text style={{ color: theme.colors.accentText, fontSize: 16 }}>{t.whatsNew.open}</Text>
					</Pressable>
					<Pressable accessibilityRole="button" onPress={() => { void startTour(); }} style={{ minHeight: 48, justifyContent: "center" }}>
						<Text style={{ color: theme.colors.accentText, fontSize: 16 }}>{t.tour.open}</Text>
					</Pressable>
				</Card>
				</TourAnchor>
				<GiftCodeDialog visible={giftDialog} onClose={() => setGiftDialog(false)} />
			</ScrollView>
		</Screen>
	);
}
