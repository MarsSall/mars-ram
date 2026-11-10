// A layout key drawn like the terminal bar draws it (line icons for app controls, no emoji), for previews.
import { Text } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { TerminalKeyInfo } from "../core/terminal-keys";
import { usePreferences } from "./preferences";

const icons: Partial<Record<string, "clipboard-outline" | "mic-outline" | "move-outline">> = { paste: "clipboard-outline", mic: "mic-outline", dpad: "move-outline" };

export function KeyFace({ info, scale = 1 }: { info: TerminalKeyInfo; scale?: number }) {
 const { theme } = usePreferences(); const c = theme.colors;
 const icon = icons[info.id];
 if (icon) return <Ionicons name={icon} size={20 * scale} color={c.text} />;
 if (info.id === "keyboard") return <MaterialCommunityIcons name="keyboard-outline" size={21 * scale} color={c.text} />;
 const text = info.id === "attach" ? "＋" : info.label;
 const custom = info.kind === "custom";
 const size = info.id === "attach" ? 18 : info.id === "prefix" ? 10 : custom ? 11 : Array.from(text).length <= 2 ? 18 : 11;
 return <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
  style={{ color: info.id === "attach" || custom ? c.accentText : c.text, fontSize: size * scale, fontFamily: info.id === "attach" ? undefined : theme.font.mono, fontWeight: info.id === "prefix" ? "700" : "600" }}>{text}</Text>;
}
