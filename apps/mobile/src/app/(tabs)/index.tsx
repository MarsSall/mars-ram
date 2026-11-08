import { useRouter, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { groupSessions, type ComputerSessions, type SessionGroups, type SessionSummary } from "../../core/session-list";
import { buildHome } from "../../core/home";
import { HomeHeading, HomeWelcome } from "../../ui/home-welcome";
import type { SessionRefreshReason } from "../../core/session-order";
import { Card, EmptyState, Screen, SectionTitle, StatusPill } from "../../ui/components";
import { formatTime, timeAgo } from "../../ui/format";
import { usePreferences } from "../../ui/preferences";
import { useSessions } from "../../ui/use-sessions";
import { ShortcutsSection } from "../../ui/shortcuts";

export default function HomeScreen() {
	const router = useRouter();
	const { theme, t } = usePreferences();
	const { data, refreshing, refresh } = useSessions();
	const [ordered, setOrdered] = useState<SessionGroups>({ computers: [], needsYou: [], groupOrder: {} });
	const nextOrder = useRef<SessionRefreshReason>("focus");

	useFocusEffect(useCallback(() => {
		// Apply explicit ordering to the fresh focus result, not a stale cached snapshot.
		nextOrder.current = "focus";
	}, []));

	useEffect(() => {
		if (data === null) return;
		const reason = nextOrder.current;
		nextOrder.current = "automatic";
		setOrdered((previous) => groupSessions(previous, data.computers, reason));
	}, [data]);

	const refreshByHand = () => {
		nextOrder.current = "manual";
		refresh();
	};
	const c = theme.colors;

	const ago = (then: number) => {
		const { unit, n } = timeAgo(Date.now(), then);
		if (unit === "now") return t.time.now;
		if (unit === "minutes") return t.time.minutesAgo(n);
		return unit === "hours" ? t.time.hoursAgo(n) : t.time.daysAgo(n);
	};
	const home = data === null ? null : buildHome(data.hosts, ordered);
	const nameOf = (hostId: string) => data?.hosts.find((h) => h.id === hostId)?.name ?? "";

	const count = (text: string) => <Text style={{ color: c.textMuted, fontSize: 13, fontWeight: "600" }}>{text}</Text>;

	const cardBackground = c.card;

	// Attention is global, so those rows also identify their computer.
	const row = (session: SessionSummary, priority = false) => (
		<Card
			key={session.key}
			style={{ backgroundColor: cardBackground, paddingVertical: theme.spacing(priority ? 4 : 3) }}
			onPress={() =>
				router.push({ pathname: "/session/[id]", params: { id: session.key, project: session.project, cwd: session.cwd, computer: nameOf(session.hostId) } })
			}
		>
			<View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: theme.spacing(2) }}>
				{priority ? <View style={{ flex: 1 }}><StatusPill status={session.status} /></View> : (
					<Text numberOfLines={1} style={{ color: c.text, fontSize: 16, fontWeight: "700", flex: 1 }}>{session.project}</Text>
				)}
				<Text style={{ color: c.textMuted, fontSize: 13 }}>{ago(session.lastActivityAt)}</Text>
			</View>
			{priority ? (
				<Text style={{ color: c.text, fontSize: 16, fontWeight: "700", marginTop: theme.spacing(3) }}>{session.project}</Text>
			) : <View style={{ marginTop: theme.spacing(1) }}><StatusPill status={session.status} /></View>}
			{session.lastMessage ? (
				<Text numberOfLines={2} style={{ color: priority ? c.text : c.textMuted, fontSize: priority ? 16 : 14, marginTop: theme.spacing(2) }}>
					{session.lastMessage}
				</Text>
			) : null}
			{priority ? <Text style={{ color: c.textMuted, fontSize: 13, textTransform: "uppercase", marginTop: theme.spacing(2) }}>{nameOf(session.hostId)}</Text> : null}
		</Card>
	);

	const notice = (computer: ComputerSessions) => {
		const text = {
			ok: null,
			"no-pi": t.sessions.noPi,
			unreachable: t.sessions.unreachable,
			locked: t.sessions.locked,
			"identity-changed": t.sessions.identityChanged,
		}[computer.state];
		if (!text) return null;
		const warn = computer.state === "unreachable" || computer.state === "identity-changed";
		return <Text style={{ color: warn ? c.danger : c.textMuted, fontSize: 14, paddingHorizontal: theme.spacing(4), paddingBottom: theme.spacing(2) }}>{text}</Text>;
	};

	if (home?.kind === "welcome") return <HomeWelcome />;

	return (
		<Screen>
			<ScrollView
				contentContainerStyle={{ paddingBottom: theme.spacing(6) }}
				refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshByHand} tintColor={c.accentText} colors={[c.accentText]} progressBackgroundColor={c.surfaceRaised} />}
			>
				<HomeHeading />
				{data === null ? <EmptyState message={t.sessions.loading} /> : null}
				{home && home.needsYou.length > 0 ? (
					<>
						<SectionTitle right={count(t.sessions.sessionCount(ordered.needsYou.length))}>{t.home.needsYou}</SectionTitle>
						{home.needsYou.map((session) => row(session, true))}
					</>
				) : null}
				{home && data ? <ShortcutsSection hosts={data.hosts} /> : null}
				{home ? <SectionTitle>{t.home.activeSessions}</SectionTitle> : null}
				{home?.emptySessions ? <EmptyState message={t.home.empty} hint={t.home.emptyHint} /> : null}
				{home?.computers.map((computer) => (
					<View key={computer.hostId}>
						<Text style={{ color: c.textMuted, fontSize: 14, paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(2) }}>{computer.name} · {t.home.computerStatus[computer.status]}</Text>
						{notice(computer)}
						{computer.sessions.map((s) => row(s))}
					</View>
				))}
				{data !== null && data.hosts.length > 0 ? (
					<Text style={{ color: c.textMuted, fontSize: 12, textAlign: "center", marginTop: theme.spacing(4) }}>{t.sessions.updated(formatTime(data.updatedAt))}</Text>
				) : null}
			</ScrollView>
		</Screen>
	);
}
