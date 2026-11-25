import { useRouter, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { groupSessions, type ComputerSessions, type SessionGroups, type SessionSummary } from "../../core/session-list";
import { buildHome } from "../../core/home";
import { hostNetwork } from "../../core/host-catalog";
import { unreachableHint } from "../../core/network-hint";
import { networkHintText } from "../../ui/network-hint";
import { usePhoneNetworkState } from "../../ui/use-phone-network-state";
import { HomeHeading, HomeWelcome } from "../../ui/home-welcome";
import type { SessionRefreshReason } from "../../core/session-order";
import { Card, EmptyState, Screen, SectionTitle, StatusPill } from "../../ui/components";
import { formatTime, timeAgo } from "../../ui/format";
import { usePreferences } from "../../ui/preferences";
import { useSessions } from "../../ui/use-sessions";
import { ShortcutsSection } from "../../ui/shortcuts";
import { HostUpdateNotice } from '../../ui/host-update-notice';
import { AppUpdateNotice } from "../../ui/app-update-notice";
import { sheetSession, subagentGroups, SubagentsCount, SubagentsCounter, SubagentsGroupedSheet, SubagentsSheet, SubagentsSummary } from "../../ui/subagents";
import { TourAnchor } from "../../ui/tour/anchors";
import { useTourScroll } from "../../ui/tour/scroll";
import { AgentBadge } from "../../ui/agent-badge";

export default function HomeScreen() {
	const router = useRouter();
	const { theme, t, subagentsMode } = usePreferences();
	const { data, refreshing, refresh } = useSessions();
	const tourScroll = useTourScroll();
	// Read again with every session refresh: the user may switch VPNs from the quick settings without leaving the app.
	const phone = usePhoneNetworkState(data);
	const [ordered, setOrdered] = useState<SessionGroups>({ computers: [], needsYou: [], groupOrder: {} });
	// claude-codex L20: while Home is in view, refreshes never re-sort (a tap must open the card under the finger):
	// existing cards keep their place, new ones are appended, closed ones removed. The newest-first order is
	// applied on pull-to-refresh, or when Home is left, so the next visit already shows it in place.
	const nextOrder = useRef<SessionRefreshReason>("automatic");
	const latest = useRef(data); latest.current = data;
	// The session whose subagents sheet is open; the sheet reads it from each refresh (S4).
	const [subagentsKey, setSubagentsKey] = useState<string | null>(null);
	const listed = [...ordered.needsYou, ...ordered.computers.flatMap((computer) => computer.sessions)];
	const sheet = sheetSession(listed, subagentsKey);
	const sheetGone = subagentsKey !== null && sheet === null;
	useEffect(() => {
		// The session ended or its subagents finished while the sheet was open: close it, never show a stale list.
		if (sheetGone) setSubagentsKey(null);
	}, [sheetGone]);
	// «Arriba» (Personalización): one summary on top and one sheet grouped by session, read from each refresh.
	const [allOpen, setAllOpen] = useState(false);
	const groups = subagentGroups(listed);
	const allGone = allOpen && groups.length === 0;
	useEffect(() => {
		// Every subagent finished while the grouped sheet was open: close it instead of showing an empty list.
		if (allGone) setAllOpen(false);
	}, [allGone]);

	useFocusEffect(useCallback(() => () => {
		const shown = latest.current;
		if (shown) setOrdered((previous) => groupSessions(previous, shown.computers, "focus"));
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
	// Gift themes with monospace titles set session names in monospace too.
	const titleFont = theme.style?.titles === "mono" ? { fontFamily: theme.font.mono } : {};

	// Attention is global, so those rows also identify their computer.
	const row = (session: SessionSummary, priority = false) => (
		<Card
			key={session.key}
			style={{ backgroundColor: cardBackground, paddingVertical: theme.spacing(priority ? 4 : 3) }}
			onPress={() =>
				router.push({ pathname: "/session/[id]", params: { id: session.key, project: session.project, cwd: session.cwd, computer: nameOf(session.hostId), ...(session.agent ? { agent: session.agent } : {}) } })
			}
		>
			<View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: theme.spacing(2) }}>
				{priority ? <View style={{ flex: 1 }}><StatusPill status={session.status} /></View> : (
					<Text numberOfLines={1} style={{ color: c.text, fontSize: 16, fontWeight: "700", flex: 1, ...titleFont }}>{session.project}</Text>
				)}
				<Text style={{ color: c.textMuted, fontSize: 13 }}>{ago(session.lastActivityAt)}</Text>
			</View>
			{priority ? (
				<Text style={{ color: c.text, fontSize: 16, fontWeight: "700", marginTop: theme.spacing(3), ...titleFont }}>{session.project}</Text>
			) : <View style={{ marginTop: theme.spacing(1) }}><StatusPill status={session.status} /></View>}
			{session.agent ? <View style={{ marginTop: theme.spacing(2) }}><AgentBadge agent={session.agent} /></View> : null}
			{session.approvals?.length ? <Text accessibilityLiveRegion="polite" style={{ color: c.attention, fontSize: 14, fontWeight: "600", marginTop: theme.spacing(2) }}>{t.approvals.pending(session.approvals.length)}</Text> : null}
			{session.lastMessage ? (
				<Text numberOfLines={2} style={{ color: priority ? c.text : c.textMuted, fontSize: priority ? 16 : 14, marginTop: theme.spacing(2) }}>
					{session.lastMessage}
				</Text>
			) : null}
			{session.subagents && subagentsMode === "session" ? <SubagentsCounter items={session.subagents} onOpen={() => setSubagentsKey(session.key)} /> : null}
			{session.subagents && subagentsMode === "top" ? <SubagentsCount items={session.subagents} /> : null}
			{session.reloadNeeded ? <Text style={{ color: c.textMuted, fontSize: 13, marginTop: theme.spacing(2) }}>{t.hostUpdate.reload}</Text> : null}
			{priority ? <Text style={{ color: c.textMuted, fontSize: 13, textTransform: "uppercase", marginTop: theme.spacing(2) }}>{nameOf(session.hostId)}</Text> : null}
		</Card>
	);

	// Only an unreachable computer can get a hint; its own network on or an unknown phone keeps «no responde».
	const hintOf = (computer: ComputerSessions) => {
		const host = data?.hosts.find((h) => h.id === computer.hostId);
		const hint = host ? unreachableHint(hostNetwork(host), phone, computer.state !== "unreachable") : null;
		return hint ? networkHintText(t, hint) : null;
	};

	const notice = (computer: ComputerSessions) => {
		const text = {
			ok: null,
			"no-pi": t.sessions.noPi,
			unreachable: hintOf(computer)?.full ?? t.sessions.unreachable,
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
				{...tourScroll.props}
				contentContainerStyle={{ paddingBottom: theme.spacing(6) }}
				refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshByHand} tintColor={c.accentText} colors={[c.accentText]} progressBackgroundColor={c.surfaceRaised} />}
			>
				<HomeHeading />
				{subagentsMode === "top" && groups.length > 0 ? <SubagentsSummary groups={groups} onOpen={() => setAllOpen(true)} /> : null}
				<AppUpdateNotice />
				{home && home.needsYou.length > 0 ? (
					<>
						<SectionTitle right={count(t.sessions.sessionCount(ordered.needsYou.length))}>{t.home.needsYou}</SectionTitle>
						{home.needsYou.map((session) => row(session, true))}
					</>
				) : null}
				{home && data ? <ShortcutsSection hosts={data.hosts} /> : null}
				{/* The tour's first step: the same area whether it is loading, empty or full. */}
				<TourAnchor id="home.sessions" inset={{ horizontal: theme.spacing(2) }} onLayout={tourScroll.place("home.sessions")}>
				{data === null ? <EmptyState message={t.sessions.loading} /> : null}
				{home ? <SectionTitle>{t.home.activeSessions}</SectionTitle> : null}
				{home?.emptySessions ? <EmptyState message={t.home.empty} hint={t.home.emptyHint} /> : null}
				{home?.computers.map((computer) => {
					const hint = hintOf(computer);
					return (
					<View key={computer.hostId}>
						<Text accessibilityLabel={hint ? `${computer.name} · ${hint.full}` : undefined} style={{ color: c.textMuted, fontSize: 14, paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(2) }}>{computer.name} · {hint?.short ?? t.home.computerStatus[computer.status]}</Text>
						<HostUpdateNotice update={data?.updates[computer.hostId]} />
						{notice(computer)}
						{computer.sessions.map((s) => row(s))}
					</View>
					);
				})}
				</TourAnchor>
				{data !== null && data.hosts.length > 0 ? (
					<Text style={{ color: c.textMuted, fontSize: 12, textAlign: "center", marginTop: theme.spacing(4) }}>{t.sessions.updated(formatTime(data.updatedAt))}</Text>
				) : null}
			</ScrollView>
			{subagentsMode === "session" ? <SubagentsSheet visible={sheet !== null} title={sheet?.project ?? ""} items={sheet?.subagents ?? []} onClose={() => setSubagentsKey(null)} now={Date.now()} /> : null}
			{subagentsMode === "top" ? <SubagentsGroupedSheet visible={allOpen && groups.length > 0} groups={groups} onClose={() => setAllOpen(false)} now={Date.now()} /> : null}
		</Screen>
	);
}
