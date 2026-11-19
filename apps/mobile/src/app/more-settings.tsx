// Ajustes › «Más ajustes» (S9): what is touched rarely — attachments, project explorer secrets, dictation, security, build and links.
import { useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { getLocales } from "expo-localization";
import { useRouter } from "expo-router";
import { Alert, Linking, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { privacyUrl, SOURCE_URL } from "../core/about";
import type { AttachmentRetention } from "../core/attachment-retention";
import { appBuild } from "../services";
import { Card, Screen, SectionTitle, Segmented } from "../ui/components";
import { DictationSettings } from "../ui/dictation-settings";
import { securityRow } from "../ui/key-security";
import { usePreferences } from "../ui/preferences";
import { SecretFilesSetting } from "../ui/secret-files-setting";
import { useKeySecurity } from "../ui/use-key-security";

export default function MoreSettingsScreen() {
	const router = useRouter();
	const { theme, language, t, showEmpty, setShowEmpty, retention, setRetention } = usePreferences();
	const c = theme.colors;
	const [preferenceError, setPreferenceError] = useState(false);
	const security = useKeySecurity();
	const pending = security.status?.perComputer.some(computer => computer.phase !== "done") ?? false;
	const changeUnlock = (value: boolean) => {
		if (value) { void security.change(true); return; }
		Alert.alert(t.keySecurity.warningTitle, `${t.keySecurity.warning}\n\n${t.keySecurity.rotationNotice}`, [
			{ text: t.keySecurity.cancel, style: "cancel" },
			{ text: t.keySecurity.confirm, onPress: () => { void security.change(false); } },
		]);
	};
	const openLink = (url: string) => { void Linking.openURL(url).catch(() => Alert.alert(t.settings.linkFailed)); };
	const label = (text: string) => <Text style={{ color: c.text, fontSize: 16, marginBottom: theme.spacing(2) }}>{text}</Text>;
	const row = (text: string, value: string) => (
		<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
			<Text style={{ color: c.text, fontSize: 16, flex: 1 }}>{text}</Text>
			<Text style={{ color: c.textMuted }}>{value}</Text>
		</View>
	);
	return (
		<Screen>
			<View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing(1), paddingHorizontal: theme.spacing(2), paddingVertical: theme.spacing(2) }}>
				<Pressable accessibilityRole="button" accessibilityLabel={t.settings.back} onPress={() => router.back()} style={{ width: theme.touch, height: theme.touch, alignItems: "center", justifyContent: "center" }}>
					<Ionicons name="arrow-back" size={24} color={c.text} />
				</Pressable>
				<Text accessibilityRole="header" style={{ flex: 1, color: c.text, fontSize: 22, fontWeight: "700" }}>{t.settings.more}</Text>
			</View>
			<ScrollView contentContainerStyle={{ paddingBottom: theme.spacing(8) }}>
				<SectionTitle>{t.attachments.title}</SectionTitle>
				<Card>
					{label(t.attachments.retention)}
					<Segmented<AttachmentRetention> value={retention} onChange={value => { setPreferenceError(false); void setRetention(value).catch(() => setPreferenceError(true)); }} options={[{ value: 1, label: t.attachments.day }, { value: 7, label: t.attachments.week }, { value: 30, label: t.attachments.month }, { value: "never", label: t.attachments.never }]} />
					<Text style={{ color: c.textMuted, marginTop: 8 }}>{t.attachments.location}</Text>
					{preferenceError ? <Text accessibilityRole="alert" style={{ color: c.danger }}>{t.attachments.preferenceFailed}</Text> : null}
				</Card>
				<SecretFilesSetting />
				<DictationSettings />
				<SectionTitle>{t.settings.security}</SectionTitle>
				<Card>
					<View style={{ flexDirection: "row", alignItems: "center", minHeight: 48 }}>
						<Text style={{ color: c.text, fontSize: 16, flex: 1 }}>{t.keySecurity.label}</Text>
						<Switch accessibilityLabel={t.keySecurity.label} value={security.status?.requireUnlock ?? true} disabled={!security.status || security.stale || security.busy || pending} onValueChange={changeUnlock} />
					</View>
					{!security.status && !security.error ? <Text style={{ color: c.textMuted }}>{t.keySecurity.loading}</Text> : null}
					{security.busy || pending ? <Text accessibilityLiveRegion="polite" style={{ color: c.textMuted }}>{security.busy ? t.keySecurity.changing : t.keySecurity.rotationPending}</Text> : null}
					{security.stale && security.status ? <Text style={{ color: c.danger }}>{t.keySecurity.stale}</Text> : null}
					{security.error ? <Text accessibilityRole="alert" style={{ color: c.danger }}>{t.keySecurity[security.error]}</Text> : null}
					{security.status?.perComputer.length === 0 ? <Text style={{ color: c.textMuted }}>{t.keySecurity.empty}</Text> : null}
					{security.status?.perComputer.map(computer => {
						const model = securityRow(computer);
						return <Text key={computer.hostId} style={{ color: model.retry ? c.danger : c.textMuted, marginTop: 8 }}>{computer.name}: {t.keySecurity[model.textKey]}</Text>;
					})}
					{pending || security.status?.perComputer.some(computer => computer.lastError) || security.error || security.stale ? <Pressable accessibilityRole="button" accessibilityLabel={t.keySecurity.retry} disabled={security.busy} onPress={() => { void (security.stale || !security.status ? security.refresh() : security.resume()); }} style={{ minHeight: 48, justifyContent: "center", opacity: security.busy ? 0.5 : 1 }}>
						<Text style={{ color: c.text }}>{t.keySecurity.retry}</Text>
					</Pressable> : null}
				</Card>
				<SectionTitle>{t.settings.about}</SectionTitle>
				<Card>
					{row(t.settings.build, appBuild.build === null ? t.settings.unknownVersion : String(appBuild.build))}
					<Pressable accessibilityRole="link" onPress={() => openLink(privacyUrl(language, getLocales()[0]?.languageCode ?? undefined))} style={{ minHeight: 48, justifyContent: "center" }}>
						<Text style={{ color: c.accentText, fontSize: 16 }}>{t.settings.privacy}</Text>
					</Pressable>
					<Pressable accessibilityRole="link" onPress={() => openLink(SOURCE_URL)} style={{ minHeight: 48, justifyContent: "center" }}>
						<Text style={{ color: c.accentText, fontSize: 16 }}>{t.settings.source}</Text>
					</Pressable>
				</Card>
				{__DEV__ ? <>
				<SectionTitle>{t.settings.prototype}</SectionTitle>
				<Card>
					<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
						<Text style={{ color: c.text, fontSize: 16 }}>{t.settings.showEmpty}</Text>
						<Switch accessibilityLabel={t.settings.showEmpty} value={showEmpty} onValueChange={setShowEmpty} />
					</View>
				</Card>
				<SectionTitle>{t.settings.developer}</SectionTitle>
				<Card onPress={() => router.push("/dev/ssh-probe")}>{row(t.settings.sshProbe, "›")}</Card>
				</> : null}
			</ScrollView>
		</Screen>
	);
}
