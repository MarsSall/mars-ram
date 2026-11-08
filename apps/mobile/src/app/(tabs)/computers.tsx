import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { TerminalLauncher } from "../../ui/terminal-launcher";
import { Card, EmptyState, Screen } from "../../ui/components";
import { usePreferences } from "../../ui/preferences";
import { useHosts } from "../../ui/use-hosts";
import { HostUpdateNotice } from '../../ui/host-update-notice';

export default function ComputersScreen() {
	const router = useRouter();
	const { theme, t } = usePreferences();
	const { rows } = useHosts();
	const statusText = { reachable: t.computers.reachable, unreachable: t.computers.unreachable, checking: t.computers.checking };
	const statusColor = { reachable: theme.colors.done, unreachable: theme.colors.danger, checking: theme.colors.textMuted };
	return (
		<Screen title={t.computers.title} headerRight={<Pressable accessibilityRole="button" accessibilityLabel={t.computers.add} onPress={() => router.push("/add-computer")} style={{ width: theme.touch, height: theme.touch, borderRadius: theme.touch / 2, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center" }}><Text style={{ color: theme.colors.onAccent, fontSize: 28 }}>+</Text></Pressable>}>
			<ScrollView>
				{rows === null ? <ActivityIndicator color={theme.colors.accentText} style={{ marginTop: theme.spacing(8) }} /> : null}
				{rows?.length === 0 ? <EmptyState message={t.computers.empty} /> : null}
				{rows?.map(({ host, status, update }) => (
					<Card key={host.id}>
					<View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing(2) }}>
					<Pressable accessibilityRole="button" accessibilityLabel={host.name} style={{ flex: 1, minHeight: theme.touch }} onPress={() => router.push({ pathname: "/computer/[id]", params: { id: host.id } })}>
						<Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: "700" }}>{host.name}</Text>
						<Text style={{ color: theme.colors.textMuted, fontFamily: theme.font.mono, fontSize: 13, marginTop: 2 }}>
							{host.user}@{host.dnsName ?? host.address}
						</Text>
						<View style={{ flexDirection: "row", gap: theme.spacing(3), marginTop: theme.spacing(2) }}>
							<Text style={{ color: statusColor[status], fontSize: 13, fontWeight: "600" }}>● {statusText[status]}</Text>
						</View>
					</Pressable>
					<TerminalLauncher host={host} compact />
					</View>
					<HostUpdateNotice update={update} />
					</Card>
				))}
			</ScrollView>
		</Screen>
	);
}
