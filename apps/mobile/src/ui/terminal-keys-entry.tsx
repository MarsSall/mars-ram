// Ajustes › Terminal › «Personalizar teclas», with a small picture of the saved bar.
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { terminalKeyInfo } from "../core/terminal-keys";
import { terminalKeys } from "../services";
import { usePreferences } from "./preferences";
import { KeyFace } from "./terminal-key-face";

export function TerminalKeysEntry({ open }: { open: () => void }) {
 const { theme, t: { terminalKeys: k } } = usePreferences(); const c = theme.colors;
 const [layout, setLayout] = useState(terminalKeys.get);
 useEffect(() => { setLayout(terminalKeys.get()); return terminalKeys.subscribe(setLayout); }, []);
 return <View style={{ marginTop: theme.spacing(3), paddingTop: theme.spacing(2), borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
  <Pressable accessibilityRole="button" accessibilityLabel={k.entryLabel} onPress={open} style={({ pressed }) => ({ minHeight: theme.touch, flexDirection: "row", alignItems: "center", gap: theme.spacing(3), borderRadius: theme.radius.small, backgroundColor: pressed ? c.surfaceRaised : "transparent" })}>
   <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceRaised }}>
    <MaterialCommunityIcons name="keyboard-outline" size={22} color={c.text} />
   </View>
   <View style={{ flex: 1 }}>
    <Text style={{ color: c.text, fontSize: 16 }}>{k.entry}</Text>
    <Text style={{ color: c.textMuted, fontSize: 14 }}>{k.entryHint}</Text>
   </View>
   <Ionicons name="chevron-forward" size={22} color={c.textMuted} />
  </Pressable>
  <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ marginTop: theme.spacing(2), flexDirection: "row", gap: 2, padding: 4, borderWidth: 1, borderRadius: 24, borderColor: c.border, backgroundColor: c.surface }}>
   {layout.bar.map(id => { const info = terminalKeyInfo(layout, id); return info ? <View key={id} style={{ width: info.width, flexShrink: 1, flexGrow: 1, minWidth: 0, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: c.surfaceRaised }}><KeyFace info={info} scale={0.8} /></View> : null; })}
  </View>
  <Text style={{ color: c.textMuted, fontSize: 14, marginTop: theme.spacing(1) }}>{k.current}</Text>
 </View>;
}
