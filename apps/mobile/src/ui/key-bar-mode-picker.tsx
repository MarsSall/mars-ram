// Personalizar teclas › «Cómo se muestra la barra» (key-bar-autohide S4): one radio row per mode with its help line.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View } from "react-native";
import { KEY_BAR_MODES, type KeyBarMode } from "../core/key-bar-visibility";
import { usePreferences } from "./preferences";

export function KeyBarModePicker({ value, onChange }: { value: KeyBarMode; onChange(mode: KeyBarMode): void }) {
 const { theme, t } = usePreferences(); const c = theme.colors; const m = t.terminalKeys.barMode;
 return <View accessibilityRole="radiogroup" style={{ gap: theme.spacing(1) }}>
  <Text accessibilityRole="header" style={{ color: c.textMuted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 }}>{m.title}</Text>
  {KEY_BAR_MODES.map(mode => {
   const option = m.options[mode], checked = mode === value;
   return <Pressable key={mode} accessibilityRole="radio" accessibilityState={{ checked }} accessibilityLabel={`${option.label}. ${option.help}`} onPress={() => onChange(mode)}
    style={{ minHeight: theme.touch, flexDirection: "row", alignItems: "center", gap: theme.spacing(3), paddingVertical: theme.spacing(2) }}>
    <Ionicons name={checked ? "radio-button-on" : "radio-button-off"} size={22} color={checked ? c.accentText : c.textMuted} />
    <View style={{ flex: 1 }}>
     <Text style={{ color: c.text, fontSize: 16 }}>{option.label}</Text>
     <Text style={{ color: c.textMuted, fontSize: 14 }}>{option.help}</Text>
    </View>
   </Pressable>;
  })}
 </View>;
}
