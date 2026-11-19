// design/subagentes-preview/01-miniatura-bajo-el-selector.html (S10): a «Preview» button under the
// «Subagentes en Inicio» selector opens a miniature of Home for the selected mode. It only ever uses
// the two invented sessions below, never real ones, and nothing inside it can be pressed.
import Ionicons from "@expo/vector-icons/Ionicons";
import type { SubagentItem } from "@workspace/protocol";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { SessionStatus } from "../core/session-list";
import type { SubagentsMode } from "../core/subagents-mode";
import { Card, StatusPill } from "./components";
import { usePreferences } from "./preferences";
import { type SubagentGroup, SubagentsCount, SubagentsCounter, SubagentsSummary } from "./subagents";

type SampleSession = { key: string; title: string; message: string; status: SessionStatus; items: SubagentItem[] };

/** Sample subagents: the first session has two, one asking; the second has one working. */
const SAMPLE_ITEMS: readonly SubagentItem[][] = [
	[
		{ id: "sample-1", agent: "explore", label: "", status: "running", question: true, since: 0 },
		{ id: "sample-2", agent: "apply", label: "", status: "running", question: false, since: 0 },
	],
	[{ id: "sample-3", agent: "verify", label: "", status: "running", question: false, since: 0 }],
];

const noop = () => {};

export function SubagentsPreview({ mode }: { mode: SubagentsMode }) {
	const { theme, t } = usePreferences();
	const c = theme.colors;
	const p = t.settings.subagentsPreview;
	const [open, setOpen] = useState(false);
	const sessions: SampleSession[] = [
		{ key: "sample-a", ...p.sample.first, status: "attention", items: SAMPLE_ITEMS[0]! },
		{ key: "sample-b", ...p.sample.second, status: "working", items: SAMPLE_ITEMS[1]! },
	];
	const groups: SubagentGroup[] = sessions.map((s) => ({ key: s.key, title: s.title, items: s.items }));
	const titleFont = theme.style?.titles === "mono" ? { fontFamily: theme.font.mono } : {};
	return (
		<View>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={open ? p.hide : p.show}
				accessibilityState={{ expanded: open }}
				onPress={() => setOpen((value) => !value)}
				style={({ pressed }) => ({
					minHeight: theme.touch,
					flexDirection: "row",
					alignItems: "center",
					alignSelf: "flex-start",
					gap: theme.spacing(1),
					marginTop: theme.spacing(1),
					opacity: pressed ? 0.7 : 1,
				})}
			>
				<Text style={{ color: c.accentText, fontSize: 14, fontWeight: "600" }}>{p.button}</Text>
				<Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={c.accentText} />
			</Pressable>
			{open ? (
				<View
					accessible
					accessibilityLabel={p.label(t.settings.subagentsModes[mode])}
					importantForAccessibility="yes"
					pointerEvents="none"
					style={{ borderWidth: 1, borderStyle: "dashed", borderColor: c.border, borderRadius: theme.radius.medium, padding: theme.spacing(3), gap: theme.spacing(2) }}
				>
					<Text style={{ color: c.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>{p.tag}</Text>
					{mode === "top" ? <SubagentsSummary groups={groups} onOpen={noop} style={{ marginHorizontal: 0, marginBottom: 0 }} /> : null}
					{sessions.map((session) => (
						<Card key={session.key} style={{ marginHorizontal: 0, marginBottom: 0, padding: theme.spacing(3) }}>
							<Text numberOfLines={1} style={{ color: c.text, fontSize: 15, fontWeight: "700", ...titleFont }}>{session.title}</Text>
							<View style={{ marginTop: theme.spacing(1) }}><StatusPill status={session.status} /></View>
							<Text numberOfLines={1} style={{ color: c.textMuted, fontSize: 13, marginTop: theme.spacing(1) }}>{session.message}</Text>
							{mode === "session" ? <SubagentsCounter items={session.items} onOpen={noop} /> : null}
							{mode === "top" ? <SubagentsCount items={session.items} /> : null}
						</Card>
					))}
				</View>
			) : null}
			<Text style={{ color: c.textMuted, fontSize: 13, marginTop: theme.spacing(2) }}>{p.hints[mode]}</Text>
		</View>
	);
}
