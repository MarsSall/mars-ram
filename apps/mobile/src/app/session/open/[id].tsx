import { useRouter, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { sessionDestination } from "../../../core/terminal-controls";
import { sessions } from "../../../services";
import { usePreferences } from "../../../ui/preferences";
import { Screen } from "../../../ui/components";

/** Resolve live bridge evidence before choosing terminal-first or the chat fallback. */
export default function OpenSession() {
 const router = useRouter();
 const params = useLocalSearchParams<{ id: string; project?: string; cwd?: string; computer?: string }>();
 const { t, theme } = usePreferences();
 const [failed, setFailed] = useState(false); const [attempt, setAttempt] = useState(0);
 useEffect(() => {
  let alive = true; setFailed(false);
  void sessions.terminalCapability(params.id).then(capability => {
   if (!alive) return;
   const destination = sessionDestination(capability);
   if (destination === "unavailable") { setFailed(true); return; }
   if (destination === "terminal") router.replace({ pathname: "/session/terminal/[id]", params });
   else router.replace({ pathname: "/session/[id]", params: { ...params, notHerdr: "1" } });
  }).catch(() => { if (alive) setFailed(true); });
  return () => { alive = false; };
 }, [params.id, params.project, params.cwd, params.computer, attempt, router]);
 return <Screen title={t.terminal.title}><View style={{ padding: 16, gap: 12 }}>
  {!failed ? <ActivityIndicator color={theme.colors.accentText} /> : null}
  <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.text }}>{failed ? t.terminal.error : t.terminal.connecting}</Text>
  {failed ? <Pressable accessibilityRole="button" accessibilityLabel={t.terminal.retry} onPress={() => { sessions.allowUnlockAgain(); setAttempt(n => n + 1); }} style={{ minHeight: 48, justifyContent: "center" }}><Text style={{ color: theme.colors.accentText }}>{t.terminal.retry}</Text></Pressable> : null}
  <Pressable accessibilityRole="button" accessibilityLabel={t.session.back} onPress={() => router.back()} style={{ minHeight: 48, justifyContent: "center" }}><Text style={{ color: theme.colors.text }}>{t.session.back}</Text></Pressable>
 </View></Screen>;
}
