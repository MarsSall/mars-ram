import { useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { TERMINAL_FONT, stepTerminalFontSize } from "../core/terminal-font";
import { terminalFont } from "../services";
import { Card, SectionTitle } from "./components";
import { usePreferences } from "./preferences";

/** Settings › Terminal: the one font size every terminal starts with; pinch zoom changes the same value. */
export function TerminalFontSettings() {
 const { theme, t: { terminalFont: s } } = usePreferences(); const c = theme.colors;
 const size = useSyncExternalStore(terminalFont.subscribe, terminalFont.get);
 const [failed, setFailed] = useState(false);
 const change = (delta: number) => {
  const next = stepTerminalFontSize(size, delta);
  if (next === size) return;
  setFailed(false); void terminalFont.set(next).catch(() => setFailed(true));
 };
 const step = (label: string, text: string, delta: number, disabled: boolean) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={() => change(delta)}
  style={{ minWidth: theme.touch, minHeight: theme.touch, alignItems: "center", justifyContent: "center", borderRadius: theme.touch / 2, backgroundColor: c.surfaceRaised, opacity: disabled ? 0.4 : 1 }}>
  <Text style={{ color: c.text, fontSize: 22, fontWeight: "600" }}>{text}</Text>
 </Pressable>;
 return <>
  <SectionTitle>{s.title}</SectionTitle>
  <Card>
   <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing(2) }}>
    <Text style={{ color: c.text, fontSize: 16, flex: 1 }}>{s.size}</Text>
    {step(s.smaller, "−", -1, size <= TERMINAL_FONT.min)}
    <Text accessibilityLiveRegion="polite" accessibilityLabel={s.value(size)} style={{ color: c.text, fontSize: 16, minWidth: 32, textAlign: "center", fontVariant: ["tabular-nums"] }}>{size}</Text>
    {step(s.larger, "+", 1, size >= TERMINAL_FONT.max)}
   </View>
   <View style={{ marginTop: theme.spacing(2), padding: theme.spacing(2), borderRadius: theme.radius.small, backgroundColor: c.terminalBackground, overflow: "hidden" }}>
    <Text accessible={false} numberOfLines={1} style={{ color: c.text, fontFamily: theme.font.mono, fontSize: size }}>{s.preview}</Text>
   </View>
   <Text style={{ color: c.textMuted, marginTop: theme.spacing(2) }}>{s.hint}</Text>
   {failed ? <Text accessibilityRole="alert" style={{ color: c.danger }}>{s.failed}</Text> : null}
  </Card>
 </>;
}
