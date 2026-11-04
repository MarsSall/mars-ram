import { useState } from "react";
import Constants from "expo-constants";
import { getLocales } from "expo-localization";
import { privacyUrl, SOURCE_URL } from "../../core/about";
import type { AttachmentRetention } from "../../core/attachment-retention";
import { router } from "expo-router";
import { Alert, Linking, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { securityRow } from "../../ui/key-security";
import { DictationSettings } from "../../ui/dictation-settings";
import { useKeySecurity } from "../../ui/use-key-security";
import { Card, Screen, SectionTitle, Segmented } from "../../ui/components";
import { type LanguageChoice, usePreferences } from "../../ui/preferences";
import type { ThemeName } from "../../ui/theme";

export default function SettingsScreen() {
	const { theme, setTheme, language, setLanguage, t, showEmpty, setShowEmpty, retention, setRetention } = usePreferences();
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
	const label = (text: string) => <Text style={{ color: theme.colors.text, fontSize: 16, marginBottom: theme.spacing(2) }}>{text}</Text>;
	const row = (text: string, value: string) => (
		<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
			<Text style={{ color: theme.colors.text, fontSize: 16, flex: 1 }}>{text}</Text>
			<Text style={{ color: theme.colors.textMuted }}>{value}</Text>
		</View>
	);
	return (
		<Screen title={t.settings.title}>
			<ScrollView contentContainerStyle={{ paddingBottom: theme.spacing(8) }}>
				<SectionTitle>{t.settings.appearance}</SectionTitle>
				<Card>
					{label(t.settings.theme)}
					<Segmented<ThemeName> value={theme.name} onChange={setTheme} options={[{ value: "verde-profundo", label: t.settings.deepGreen }, { value: "oro-y-verde", label: t.settings.goldAndGreen }]} />
				</Card>
				<Card>
					{label(t.settings.language)}
					<Segmented<LanguageChoice>
						value={language}
						onChange={setLanguage}
						options={[{ value: "system", label: t.settings.system }, { value: "es", label: "Español" }, { value: "en", label: "English" }]}
					/>
				</Card>
				<SectionTitle>{t.attachments.title}</SectionTitle>
				<Card>
					{label(t.attachments.retention)}
					<Segmented<AttachmentRetention> value={retention} onChange={value => { setPreferenceError(false); void setRetention(value).catch(() => setPreferenceError(true)); }} options={[{ value: 1, label: t.attachments.day }, { value: 7, label: t.attachments.week }, { value: 30, label: t.attachments.month }, { value: "never", label: t.attachments.never }]} />
					<Text style={{ color: theme.colors.textMuted, marginTop: 8 }}>{t.attachments.location}</Text>
					{preferenceError ? <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>{t.attachments.preferenceFailed}</Text> : null}
				</Card>
				<DictationSettings />
				<SectionTitle>{t.settings.security}</SectionTitle>
				<Card>
					<View style={{ flexDirection: "row", alignItems: "center", minHeight: 48 }}>
						<Text style={{ color: theme.colors.text, fontSize: 16, flex: 1 }}>{t.keySecurity.label}</Text>
						<Switch accessibilityLabel={t.keySecurity.label} value={security.status?.requireUnlock ?? true} disabled={!security.status || security.stale || security.busy || pending} onValueChange={changeUnlock} />
					</View>
					{!security.status && !security.error ? <Text style={{ color: theme.colors.textMuted }}>{t.keySecurity.loading}</Text> : null}
					{security.busy || pending ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.textMuted }}>{security.busy ? t.keySecurity.changing : t.keySecurity.rotationPending}</Text> : null}
					{security.stale && security.status ? <Text style={{ color: theme.colors.danger }}>{t.keySecurity.stale}</Text> : null}
					{security.error ? <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>{t.keySecurity[security.error]}</Text> : null}
					{security.status?.perComputer.length === 0 ? <Text style={{ color: theme.colors.textMuted }}>{t.keySecurity.empty}</Text> : null}
					{security.status?.perComputer.map(computer => {
						const model = securityRow(computer);
						return <Text key={computer.hostId} style={{ color: model.retry ? theme.colors.danger : theme.colors.textMuted, marginTop: 8 }}>{computer.name}: {t.keySecurity[model.textKey]}</Text>;
					})}
					{pending || security.status?.perComputer.some(computer => computer.lastError) || security.error || security.stale ? <Pressable accessibilityRole="button" accessibilityLabel={t.keySecurity.retry} disabled={security.busy} onPress={() => { void (security.stale || !security.status ? security.refresh() : security.resume()); }} style={{ minHeight: 48, justifyContent: "center", opacity: security.busy ? 0.5 : 1 }}>
						<Text style={{ color: theme.colors.text }}>{t.keySecurity.retry}</Text>
					</Pressable> : null}
				</Card>
				<SectionTitle>{t.settings.notifications}</SectionTitle>
				<Card>{row(t.settings.backgroundNotices, t.settings.on)}</Card>
				<SectionTitle>{t.settings.about}</SectionTitle>
				<Card>
					{row(t.settings.version, Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? t.settings.unknownVersion)}
					{row(t.settings.build, Constants.nativeBuildVersion ?? t.settings.unknownVersion)}
					<Pressable accessibilityRole="link" onPress={() => openLink(privacyUrl(language, getLocales()[0]?.languageCode ?? undefined))} style={{ minHeight: 48, justifyContent: "center" }}>
						<Text style={{ color: theme.colors.accentText, fontSize: 16 }}>{t.settings.privacy}</Text>
					</Pressable>
					<Pressable accessibilityRole="link" onPress={() => openLink(SOURCE_URL)} style={{ minHeight: 48, justifyContent: "center" }}>
						<Text style={{ color: theme.colors.accentText, fontSize: 16 }}>{t.settings.source}</Text>
					</Pressable>
				</Card>
				{__DEV__ ? <>
				<SectionTitle>{t.settings.prototype}</SectionTitle>
				<Card>
					<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
						<Text style={{ color: theme.colors.text, fontSize: 16 }}>{t.settings.showEmpty}</Text>
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
