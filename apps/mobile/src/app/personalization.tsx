// Ajustes › «Personalización» (S16, S9): theme (with the one share icon for gifts), language, subagents on Home (with its preview, S10), terminal font size and key bar.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Card, Screen, Segmented } from "../ui/components";
import { GiftShareButton } from "../ui/gift-share";
import { SubagentsPreview } from "../ui/subagents-preview";
import { type LanguageChoice, usePreferences } from "../ui/preferences";
import { TerminalFontSettings } from "../ui/terminal-font-settings";
import { TerminalKeysEntry } from "../ui/terminal-keys-entry";
import type { ThemeId } from "../ui/theme";
import { SUBAGENTS_MODES, type SubagentsMode } from "../core/subagents-mode";

export default function PersonalizationScreen() {
 const router = useRouter();
 const { theme, setTheme, gifts, t, language, setLanguage, subagentsMode, setSubagentsMode } = usePreferences(); const c = theme.colors;
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
   <Card>
    <Text style={{ color: c.text, fontSize: 16, marginBottom: theme.spacing(2) }}>{t.settings.language}</Text>
    <Segmented<LanguageChoice> value={language} onChange={setLanguage} options={[{ value: "system", label: t.settings.system }, { value: "es", label: "Español" }, { value: "en", label: "English" }]} />
   </Card>
   <Card>
    <Text style={{ color: c.text, fontSize: 16, marginBottom: theme.spacing(2) }}>{t.settings.subagentsHome}</Text>
    <Segmented<SubagentsMode> value={subagentsMode} onChange={setSubagentsMode} options={SUBAGENTS_MODES.map(value => ({ value, label: t.settings.subagentsModes[value] }))} />
    <SubagentsPreview mode={subagentsMode} />
   </Card>
   <TerminalFontSettings><TerminalKeysEntry open={() => router.push("/terminal-keys")} /></TerminalFontSettings>
  </ScrollView>
 </Screen>;
}
