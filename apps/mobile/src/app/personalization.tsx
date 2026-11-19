// Ajustes › «Personalización» (S16): theme (with the one share icon for gifts), terminal font size and key bar.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Card, Screen, Segmented } from "../ui/components";
import { GiftShareButton } from "../ui/gift-share";
import { usePreferences } from "../ui/preferences";
import { TerminalFontSettings } from "../ui/terminal-font-settings";
import { TerminalKeysEntry } from "../ui/terminal-keys-entry";
import type { ThemeId } from "../ui/theme";

export default function PersonalizationScreen() {
 const router = useRouter();
 const { theme, setTheme, gifts, t } = usePreferences(); const c = theme.colors;
 const themeOptions: { value: ThemeId; label: string }[] = [{ value: "verde-profundo", label: t.settings.deepGreen }, { value: "oro-y-verde", label: t.settings.goldAndGreen }, ...gifts.map(gift => ({ value: gift.theme.id, label: gift.theme.label }))];
 return <Screen>
  <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing(1), paddingHorizontal: theme.spacing(2), paddingVertical: theme.spacing(2) }}>
   <Pressable accessibilityRole="button" accessibilityLabel={t.settings.back} onPress={() => router.back()} style={{ width: theme.touch, height: theme.touch, alignItems: "center", justifyContent: "center" }}>
    <Ionicons name="arrow-back" size={24} color={c.text} />
   </Pressable>
   <Text accessibilityRole="header" style={{ flex: 1, color: c.text, fontSize: 22, fontWeight: "700" }}>{t.settings.personalization}</Text>
  </View>
  <ScrollView contentContainerStyle={{ paddingBottom: theme.spacing(8) }}>
   <Card>
    <View style={{ flexDirection: "row", alignItems: "center", minHeight: gifts.length > 0 ? theme.touch : undefined, marginBottom: theme.spacing(2) }}>
     <Text style={{ color: c.text, fontSize: 16, flex: 1 }}>{t.settings.theme}</Text>
     <GiftShareButton gifts={gifts} />
    </View>
    <Segmented<ThemeId> value={theme.name} onChange={setTheme} options={themeOptions} compact={themeOptions.length > 2} />
   </Card>
   <TerminalFontSettings><TerminalKeysEntry open={() => router.push("/terminal-keys")} /></TerminalFontSettings>
  </ScrollView>
 </Screen>;
}
