import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import type { SavedHost } from "../../core/host-catalog";
import { catalog, clipboard } from "../../services";
import { formatDateTime } from "../../ui/format";
import { Card, Screen } from "../../ui/components";
import { usePreferences } from "../../ui/preferences";
import { TerminalLauncher } from "../../ui/terminal-launcher";

function CopyValue({ label, value, copyValue = value }: { label: string; value: string; copyValue?: string }) {
 const { theme, t } = usePreferences();
 const [feedback, setFeedback] = useState<"copied" | "copyFailed" | null>(null);
 const [pending, setPending] = useState(false);
 useEffect(() => {
  if (!feedback) return;
  const timer = setTimeout(() => setFeedback(null), 2000);
  return () => clearTimeout(timer);
 }, [feedback]);
 const copy = async () => {
  setPending(true);
  setFeedback(null);
  try { await clipboard.writeText(copyValue); setFeedback("copied"); }
  catch { setFeedback("copyFailed"); }
  finally { setPending(false); }
 };
 return <View style={{ marginBottom: theme.spacing(3) }}>
  <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing(2) }}>
   <View style={{ flex: 1 }}>
    <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>{label}</Text>
    <Text selectable style={{ color: theme.colors.text, fontSize: 15, fontFamily: theme.font.mono }}>{value}</Text>
   </View>
   <Pressable accessibilityRole="button" accessibilityLabel={t.computer.copy(label)} disabled={pending} onPress={() => void copy()} style={{ width: theme.touch, height: theme.touch, borderRadius: theme.touch / 2, backgroundColor: theme.colors.surfaceRaised, alignItems: "center", justifyContent: "center" }}>
    <Ionicons name="copy-outline" size={22} color={theme.colors.text} />
   </Pressable>
  </View>
  {feedback ? <Text accessibilityLiveRegion="polite" style={{ color: feedback === "copied" ? theme.colors.accentText : theme.colors.danger }}>{t.computer[feedback]}</Text> : null}
 </View>;
}

export default function ComputerScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const { theme, t } = usePreferences();
	const [host, setHost] = useState<SavedHost | null>(null);
	useEffect(() => {
		void catalog.list().then((hosts) => setHost(hosts.find((h) => h.id === id) ?? null));
	}, [id]);

	const forget = () =>
		Alert.alert(t.computer.forgetTitle, t.computer.forgetBody, [
			{ text: t.computer.cancel, style: "cancel" },
			{
				text: t.computer.forget,
				style: "destructive",
				onPress: () => void catalog.remove(id).then(() => router.back()),
			},
		]);

	const row = (label: string, value: string, mono = false) => (
		<View style={{ marginBottom: theme.spacing(3) }}>
			<Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>{label}</Text>
			<Text selectable style={{ color: theme.colors.text, fontSize: 15, fontFamily: mono ? theme.font.mono : undefined }}>
				{value}
			</Text>
		</View>
	);

	return (
		<Screen>
			<View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: theme.spacing(2), paddingVertical: theme.spacing(2) }}>
				<Pressable onPress={() => router.back()} accessibilityLabel={t.session.back} style={{ width: theme.touch, height: theme.touch, alignItems: "center", justifyContent: "center" }}>
					<Ionicons name="chevron-back" size={26} color={theme.colors.accentText} />
				</Pressable>
				<View>
					<Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>{t.computers.title}</Text>
					<Text style={{ color: theme.colors.text, fontSize: 19, fontWeight: "700" }}>{host?.name ?? ""}</Text>
				</View>
			</View>
			{host ? (
				<ScrollView>
					<Card>
						<CopyValue label={t.computer.address} value={host.dnsName ? `${host.dnsName} (${host.address})` : host.address} copyValue={host.dnsName ?? host.address} />
						{row(t.computer.user, `${host.user} · ${t.add.port} ${host.sshPort}`)}
						<CopyValue label={t.computer.identity} value={host.hostKey} />
						{row(t.computer.added, formatDateTime(host.addedAt))}
					</Card>
					<View style={{ marginHorizontal: theme.spacing(4), marginTop: theme.spacing(2) }}><TerminalLauncher host={host} /></View>
					<Pressable onPress={forget} accessibilityRole="button" style={{ margin: theme.spacing(4), minHeight: theme.touch, alignItems: "center", justifyContent: "center" }}>
						<Text style={{ color: theme.colors.danger, fontSize: 16, fontWeight: "600" }}>{t.computer.forget}</Text>
					</Pressable>
				</ScrollView>
			) : null}
		</Screen>
	);
}
