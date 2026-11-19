// design/subagentes-inicio/02-hoja-inferior.html: a session's subagents on Home (S4). The card keeps
// one counter line; tapping it opens a bottom sheet with the whole list. Both read the summary that
// the Home refresh already brings, so the sheet updates while it is open.
import type { SubagentItem } from "@workspace/protocol";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import type { SessionSummary } from "../core/session-list";
import { timeAgo } from "./format";
import type { Strings } from "./i18n/en";
import { usePreferences } from "./preferences";
import type { Theme } from "./theme";

/** «hace N min», «recién» under a minute, then hours and days, like the rest of Home. */
export function agoText(t: Strings, now: number, then: number): string {
	const { unit, n } = timeAgo(now, then);
	if (unit === "now") return t.time.now;
	if (unit === "minutes") return t.time.minutesAgo(n);
	return unit === "hours" ? t.time.hoursAgo(n) : t.time.daysAgo(n);
}

/** One subagent's state line and its color: a question always reads as needing the user (S5). */
export function subagentState(t: Strings, colors: Theme["colors"], item: SubagentItem, now: number): { text: string; color: string } {
	const s = t.subagents;
	if (item.question) return { text: s.attention(agoText(t, now, item.since)), color: colors.attention };
	if (item.status === "running") return { text: s.working(agoText(t, now, item.since)), color: colors.working };
	if (item.status === "queued") return { text: s.queued, color: colors.textMuted };
	return { text: s.waiting(agoText(t, now, item.since)), color: colors.textMuted };
}

/**
 * The session the open sheet shows, from the latest refresh. When that session is gone or no
 * longer has subagents, there is nothing to show: the caller closes the sheet instead of keeping a
 * stale list on screen.
 */
export function sheetSession(sessions: readonly SessionSummary[], key: string | null): (SessionSummary & { subagents: SubagentItem[] }) | null {
	if (key === null) return null;
	const session = sessions.find((s) => s.key === key);
	return session?.subagents && session.subagents.length > 0 ? (session as SessionSummary & { subagents: SubagentItem[] }) : null;
}

/** «⑂ N subagentes · M te pregunta algo ›», a full-width button inside the session card. */
export function SubagentsCounter({ items, onOpen }: { items: SubagentItem[]; onOpen: () => void }) {
	const { theme, t } = usePreferences();
	const c = theme.colors;
	const asking = items.filter((item) => item.question).length;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={t.subagents.label(items.length, asking)}
			onPress={onOpen}
			style={({ pressed }) => ({
				minHeight: theme.touch,
				flexDirection: "row",
				alignItems: "center",
				gap: theme.spacing(2),
				marginTop: theme.spacing(1),
				marginBottom: -theme.spacing(2),
				borderRadius: theme.radius.small,
				opacity: pressed ? 0.7 : 1,
			})}
		>
			<Text style={{ flex: 1, color: c.accentText, fontSize: 14, fontWeight: "600" }}>
				{t.subagents.counter(items.length)}
				{asking > 0 ? <Text style={{ color: c.attention }}> {t.subagents.asking(asking)}</Text> : null}
			</Text>
			<Text accessible={false} style={{ color: c.accentText, fontSize: 18 }}>›</Text>
		</Pressable>
	);
}

/** The bottom sheet: «Listo», the scrim, or the hardware back button close it. */
export function SubagentsSheet({ title, items, visible, onClose, now }: { title: string; items: SubagentItem[]; visible: boolean; onClose: () => void; now: number }) {
	const { theme, t } = usePreferences();
	const c = theme.colors;
	const s = t.subagents;
	return (
		<Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
			<Pressable accessibilityLabel={s.done} onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} />
			<View
				accessibilityViewIsModal
				style={{
					backgroundColor: c.surfaceRaised,
					borderTopLeftRadius: theme.radius.large,
					borderTopRightRadius: theme.radius.large,
					borderTopWidth: 1,
					borderColor: c.border,
					paddingHorizontal: theme.spacing(4),
					paddingTop: theme.spacing(3),
					paddingBottom: theme.spacing(6),
					maxHeight: "80%",
				}}
			>
				<View accessible={false} style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: "center", marginBottom: theme.spacing(3) }} />
				<Text accessibilityRole="header" style={{ color: c.text, fontSize: 17, fontWeight: "700", marginBottom: theme.spacing(2) }}>{s.title(title)}</Text>
				<ScrollView>
					{items.map((item, i) => {
						const state = subagentState(t, c, item, now);
						return (
							<View
								key={item.id}
								accessible
								style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing(3), paddingVertical: theme.spacing(2), borderTopWidth: i === 0 ? 0 : 1, borderColor: c.border }}
							>
								<View style={{ borderRadius: theme.radius.small, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, paddingHorizontal: 7, paddingVertical: 3 }}>
									<Text style={{ color: c.textMuted, fontSize: 11, fontWeight: "700" }}>{item.agent}</Text>
								</View>
								<View style={{ flex: 1, gap: 2 }}>
									{item.label ? <Text style={{ color: c.text, fontSize: 14 }}>{item.label}</Text> : null}
									<Text style={{ color: state.color, fontSize: 12 }}>{state.text}</Text>
								</View>
							</View>
						);
					})}
				</ScrollView>
				<Pressable
					accessibilityRole="button"
					onPress={onClose}
					style={({ pressed }) => ({ minHeight: theme.touch, marginTop: theme.spacing(3), borderRadius: theme.radius.medium, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}
				>
					<Text style={{ color: c.accentText, fontSize: 16, fontWeight: "600" }}>{s.done}</Text>
				</Pressable>
			</View>
		</Modal>
	);
}
