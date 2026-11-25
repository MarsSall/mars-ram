// claude-codex-support T3b: which agent runs a session. Original glyphs only, never an official mark.
import { Text, View } from "react-native";
import type { AgentKind } from "@workspace/protocol";
import { usePreferences } from "./preferences";

/** Simple geometric glyphs drawn as text; Pi keeps its own icon and gets no badge. */
export const AGENT_GLYPHS = { "claude-code": "◐", codex: "⬡", unknown: "◇" } as const;
export type BadgeAgent = Exclude<AgentKind, "pi"> | "unknown";

/** The glyph alone, sized like the program icons in shortcuts. */
export function AgentGlyph({ agent, size = 24 }: { agent: BadgeAgent; size?: number }) {
 const { theme: { colors: c } } = usePreferences();
 return <View accessible={false} style={{ width: size, height: size, borderRadius: size / 4, borderWidth: 1, borderColor: c.accentText, alignItems: "center", justifyContent: "center" }}>
  <Text accessible={false} style={{ color: c.accentText, fontSize: Math.round(size * 0.6), lineHeight: Math.round(size * 0.75) }}>{AGENT_GLYPHS[agent]}</Text>
 </View>;
}

/** A small label on Home cards and the session header; nothing for Pi, so Pi sessions look as before. */
export function AgentBadge({ agent }: { agent?: AgentKind | "unknown" }) {
 const { theme, t } = usePreferences(); const c = theme.colors;
 if (agent === undefined || agent === "pi") return null;
 const name = t.agents.names[agent];
 return <View accessible accessibilityLabel={t.agents.badge(name)} style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 6, paddingVertical: 2, borderRadius: theme.radius.small, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceRaised }}>
  <Text accessible={false} style={{ color: c.accentText, fontSize: 12 }}>{AGENT_GLYPHS[agent]}</Text>
  <Text accessible={false} style={{ color: c.text, fontSize: 12, fontWeight: "600" }}>{name}</Text>
 </View>;
}
