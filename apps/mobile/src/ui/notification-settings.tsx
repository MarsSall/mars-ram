import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { notifications, notificationSystem } from "../services";
import type { NotificationMode } from "../core/notifications";
import { Card, SectionTitle, Segmented } from "./components";
import { usePreferences } from "./preferences";
import { notificationCopy } from "./notification-copy";

export function NotificationSettingsCard() {
 const { theme, locale } = usePreferences(); const copy = notificationCopy[locale];
 const state = useSyncExternalStore(notifications.subscribe, notifications.snapshot);
 const [exempt, setExempt] = useState<boolean | null>(null);
 const [settingsError, setSettingsError] = useState(false);
 const [help, setHelp] = useState(false);
 useEffect(() => {
  const refresh = () => { notifications.refreshStatus(); try { setExempt(notificationSystem.batteryExempt()); } catch { setExempt(null); } };
  refresh(); const timer = setInterval(refresh, 2000);
  const subscription = AppState.addEventListener("change", s => { if (s === "active") refresh(); });
  return () => { clearInterval(timer); subscription.remove(); };
 }, []);
 const error = state.error === "WATCH_TIMEOUT" ? copy.timeout : state.error === "NOTIFICATIONS_DENIED" ? copy.denied : state.error === "TAILSCALE_REQUIRED" ? copy.tailscale : state.error === "APP_NOT_VISIBLE" || state.error === "START_NOT_ALLOWED" ? copy.visible : state.error === "NO_COMPUTERS" ? copy.empty : state.error ? copy.generic : null;
 const text = { color: theme.colors.textMuted, marginTop: 8 };
 const button = (label: string, action: () => Promise<unknown>, changesMode = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={changesMode && state.busy} onPress={() => { setSettingsError(false); void action().catch(() => setSettingsError(true)); }} style={{ minHeight: 48, justifyContent: "center", opacity: changesMode && state.busy ? 0.5 : 1 }}><Text style={{ color: theme.colors.accentText }}>{label}</Text></Pressable>;
 const c = theme.colors;
 const helpButton = <Pressable accessibilityRole="button" accessibilityLabel={copy.help} onPress={() => setHelp(true)} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}><View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: c.textMuted, alignItems: "center", justifyContent: "center" }}><Text style={{ color: c.textMuted, fontSize: 14, fontWeight: "700" }}>?</Text></View></Pressable>;
 const paragraph = { color: c.textMuted, fontSize: 14, lineHeight: 21, marginTop: 12 };
 return <><SectionTitle right={helpButton}>{copy.title}</SectionTitle><Card>
  <Segmented<NotificationMode> compact value={state.mode} onChange={mode => { if (!state.busy) void notifications.choose(mode); }} options={[{ value: "off", label: copy.off }, { value: "while-working", label: copy.working }, { value: "always", label: copy.always }]} />
  <Text style={text}>{state.mode === "off" ? copy.offShort : state.mode === "while-working" ? copy.workingShort : copy.alwaysShort}</Text>
  {state.busy ? <Text accessibilityLiveRegion="polite" style={text}>{copy.loading}</Text> : null}
  {state.mode !== "off" ? <Text accessibilityLiveRegion="polite" style={text}>{state.status.state === "running" ? copy.running : state.status.state === "starting" ? copy.starting : copy.stopped}</Text> : null}
  {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.danger, marginTop: 8 }}>{error}</Text> : null}
  {state.computers.map(c => <Text key={c.hostId} accessibilityLiveRegion="polite" style={{ ...text, color: c.result === "ok" ? theme.colors.textMuted : theme.colors.danger }}>{c.name}: {c.result === "ok" ? (state.mode === "while-working" ? copy.connected : copy.registered) : c.result === "PREPARATION_TIMEOUT" ? copy.timeout : c.result === "CONNECTION_FAILED" ? copy.connectionFailed : c.result === "UPDATE_REQUIRED" ? copy.update : copy.failed}</Text>)}
  {state.error === "NOTIFICATIONS_DENIED" ? button(copy.settings, notificationSystem.openSettings) : null}
  {state.mode !== "off" ? button(copy.retry, () => notifications.choose(state.mode), true) : null}
  {state.mode === "always" ? <>
   <Text testID="battery-state" style={text}>{exempt === null ? copy.loading : exempt ? copy.batteryOn : copy.batteryOff}</Text>
   {button(copy.battery, notificationSystem.openBattery)}
  </> : null}
  {settingsError ? <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>{copy.settingsFailed}</Text> : null}
 </Card>
 <Modal visible={help} transparent animationType="slide" onRequestClose={() => setHelp(false)}>
  <Pressable accessibilityLabel={copy.close} onPress={() => setHelp(false)} style={{ flex: 1, backgroundColor: "rgba(13,14,20,0.62)" }} />
  <View accessibilityViewIsModal style={{ maxHeight: "80%", backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: c.border, padding: theme.spacing(4), paddingBottom: theme.spacing(6) }}>
   <Text accessibilityRole="header" style={{ color: c.text, fontSize: 19, fontWeight: "700" }}>{copy.helpTitle}</Text>
   <ScrollView style={{ flexShrink: 1 }}>
    {[copy.offHelp, copy.workingHelp, copy.alwaysHelp, copy.batteryHelp, copy.limits, copy.consent].map(line => <Text key={line} style={paragraph}>{line}</Text>)}
   </ScrollView>
   <Pressable accessibilityRole="button" accessibilityLabel={copy.close} onPress={() => setHelp(false)} style={{ minHeight: theme.touch, borderRadius: theme.radius.medium, alignItems: "center", justifyContent: "center", marginTop: theme.spacing(3), backgroundColor: c.surfaceRaised }}><Text style={{ color: c.text, fontWeight: "700" }}>{copy.close}</Text></Pressable>
  </View>
 </Modal></>;
}
