import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View } from "react-native";
import { HOME_OPEN_TERMINAL } from "../core/tour";
import { usePreferences } from "./preferences";
import { TourAnchor } from "./tour/anchors";

/** The Atajos row on Inicio: «Agregar atajo» and, next to it, «Abrir terminal». */
export function ShortcutActions({ add, openTerminal }: { add: () => void; openTerminal: () => void }) {
 const { theme, t } = usePreferences(); const c = theme.colors;
 const tile = { width: "48%" as const, minHeight: 100, borderRadius: theme.radius.medium, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, padding: 12, justifyContent: "center" as const, gap: 6 };
 return <View style={{ flexDirection: "row", justifyContent: "space-between", marginHorizontal: theme.spacing(4), marginTop: 8 }}>
  <Pressable accessibilityRole="button" accessibilityLabel={t.shortcuts.add} onPress={add} style={[tile, { borderStyle: "dashed" }]}><Text style={{ color: c.accentText, fontSize: 24 }}>+</Text><Text style={{ color: c.text, fontWeight: "700" }}>{t.shortcuts.add}</Text></Pressable>
  {/* The tour's «Abrir terminal» step rings this tile; the wrapper takes the 48% so the row is unchanged. */}
  <TourAnchor id={HOME_OPEN_TERMINAL} style={{ width: "48%" }}><Pressable accessibilityRole="button" accessibilityLabel={t.openers.button} onPress={openTerminal} style={[tile, { width: "100%", borderStyle: "dashed" }]}><Ionicons name="terminal-outline" size={24} color={c.accentText} /><Text style={{ color: c.text, fontWeight: "700" }}>{t.openers.button}</Text></Pressable></TourAnchor>
 </View>;
}
