import { useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { appUpdates } from "../services";
import { usePreferences } from "./preferences";

/** Google Play update notice. No loading/error UI: the check is optional and silent on failure. */
export function AppUpdateNotice() {
 const { t, theme } = usePreferences();
 const state = useSyncExternalStore(appUpdates.subscribe, appUpdates.snapshot);
 if (state.phase === "idle" || state.dismissed) return null;
 const c = theme.colors;
 const action = (label: string, onPress: () => void, primary: boolean) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
   style={{ minHeight: theme.touch, justifyContent: "center", paddingHorizontal: theme.spacing(3) }}>
   <Text style={{ color: primary ? c.accentText : c.textMuted, fontSize: 16, fontWeight: primary ? "700" : "400" }}>{label}</Text>
  </Pressable>
 );
 const message = { available: t.appUpdate.available, downloading: t.appUpdate.downloading, downloaded: t.appUpdate.downloaded }[state.phase];
 return (
  <View accessibilityLiveRegion="polite" style={{ marginHorizontal: theme.spacing(4), marginVertical: theme.spacing(2), padding: theme.spacing(3), gap: theme.spacing(1), borderRadius: theme.radius.medium, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceRaised }}>
   <Text style={{ color: c.text, fontSize: 15, fontWeight: "600" }}>{message}</Text>
   {state.failed ? <Text style={{ color: c.textMuted, fontSize: 14 }}>{t.appUpdate.failed}</Text> : null}
   <View style={{ flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap" }}>
    {action(t.appUpdate.dismiss, () => appUpdates.dismiss(), false)}
    {state.phase === "available" ? action(t.appUpdate.update, () => { void appUpdates.update(); }, true) : null}
    {state.phase === "downloaded" ? action(t.appUpdate.restart, () => { void appUpdates.restart(); }, true) : null}
   </View>
  </View>
 );
}
