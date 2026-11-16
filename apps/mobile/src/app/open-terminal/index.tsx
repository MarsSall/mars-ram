import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { BackHandler, Image, Pressable, ScrollView, Text, View } from "react-native";
import type { SavedHost } from "../../core/host-catalog";
import { TERMINAL_ROUTE, openerInitialStep, terminalOpeners, type OpenerCheck } from "../../core/terminal-openers";
import { catalog, sessions, terminalOpenerHost } from "../../services";
import { Screen } from "../../ui/components";
import { hostRouteLine } from "../../ui/host-route-line";
import { usePreferences } from "../../ui/preferences";
import { ShortcutErrorView } from "../../ui/shortcuts";

const herdrIcon = require("../../../assets/brand/herdr.png");
type Step = "computer" | "opener";
type CheckState = { state: "loading" } | { state: "done"; value: OpenerCheck };
/** «Abrir terminal» on Inicio: choose the computer (skipped with one), then what to open. */
export default function OpenTerminalScreen() {
 const router = useRouter();
 const { theme, t } = usePreferences(); const o = t.openers; const c = theme.colors;
 const [hosts, setHosts] = useState<SavedHost[] | null>(null); const [catalogError, setCatalogError] = useState(false);
 const [computer, setComputer] = useState<SavedHost | null>(null); const [step, setStep] = useState<Step>("computer");
 const [check, setCheck] = useState<CheckState>({ state: "loading" }); const [attempt, setAttempt] = useState(0);
 useEffect(() => { let active = true; void catalog.list().then(rows => { if (!active) return; setHosts(rows); if (openerInitialStep(rows.length) === "opener") { setComputer(rows[0]); setStep("opener"); } }).catch(() => { if (active) setCatalogError(true); }); return () => { active = false; }; }, []);
 useEffect(() => {
  if (!computer || step !== "opener") return;
  let active = true; setCheck({ state: "loading" }); sessions.allowUnlockAgain();
  void terminalOpenerHost.check(computer).then(value => { if (active) setCheck({ state: "done", value }); });
  return () => { active = false; };
 }, [computer, step, attempt]);
 const back = useCallback(() => { if (step === "opener" && (hosts?.length ?? 0) > 1) { setStep("computer"); setComputer(null); } else router.back(); }, [step, hosts, router]);
 useEffect(() => { const subscription = BackHandler.addEventListener("hardwareBackPress", () => { back(); return true; }); return () => subscription.remove(); }, [back]);
 const row = { minHeight: 64, borderRadius: theme.radius.medium, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, marginHorizontal: 16, marginBottom: 8, padding: 12, justifyContent: "center" as const };
 const choices = check.state === "done" && check.value.ok ? check.value.openers : [];
 return <Screen>
  <Pressable accessibilityRole="button" onPress={back} style={{ minHeight: 48, paddingHorizontal: 16, justifyContent: "center" }}><Text style={{ color: c.accentText }}>‹ {o.back}</Text></Pressable>
  <Text accessibilityRole="header" style={{ color: c.text, fontSize: 26, fontWeight: "700", marginHorizontal: 16, marginBottom: 16 }}>{step === "computer" ? o.chooseComputer : o.chooseOpener}</Text>
  {computer && step === "opener" ? <View style={{ marginHorizontal: 16, marginBottom: 12, gap: 2 }}><Text style={{ color: c.textMuted }}>{computer.name}</Text><Text style={{ color: c.textMuted, fontFamily: theme.font.mono, fontSize: 13 }}>{hostRouteLine(t, computer)}</Text></View> : null}
  <ScrollView>
   {step === "computer" ? <>{hosts === null && !catalogError ? <Text accessibilityLiveRegion="polite" style={{ color: c.textMuted, margin: 16 }}>{o.loading}</Text> : null}{catalogError ? <Text accessibilityRole="alert" style={{ color: c.danger, margin: 16 }}>{o.failed}</Text> : null}{hosts?.length === 0 ? <Text style={{ color: c.textMuted, margin: 16 }}>{o.noComputers}</Text> : null}{hosts?.map(h => { const line = hostRouteLine(t, h); return <Pressable key={h.id} accessibilityRole="button" accessibilityLabel={`${h.name}, ${line}`} onPress={() => { setComputer(h); setStep("opener"); }} style={[row, { gap: 2 }]}><Text style={{ color: c.text, fontWeight: "700" }}>{h.name}</Text><Text style={{ color: c.textMuted, fontFamily: theme.font.mono, fontSize: 13 }}>{line}</Text></Pressable>; })}</> : null}
   {step === "opener" && computer ? check.state === "loading" ? <Text accessibilityLiveRegion="polite" style={{ color: c.textMuted, margin: 16 }}>{o.checking}</Text>
    : !check.value.ok ? <><ShortcutErrorView code={check.value.code} computer={computer.name} /><Pressable accessibilityRole="button" onPress={() => setAttempt(n => n + 1)} style={{ minHeight: 48, marginHorizontal: 16, justifyContent: "center" }}><Text style={{ color: c.accentText }}>{o.retry}</Text></Pressable></>
    : <>{choices.map(({ id, availability }) => {
     const opener = terminalOpeners.find(item => item.id === id)!;
     const enabled = availability.available;
     // Each unavailable reason is a copy key that names the computer.
     const why = availability.available ? null : o[availability.reason](computer.name);
     return <Pressable key={id} accessibilityRole="button" accessibilityLabel={`${o.names[id]} · ${computer.name}`} accessibilityHint={why ?? o.descriptions[id]} accessibilityState={{ disabled: !enabled }} disabled={!enabled}
      onPress={() => router.replace({ pathname: TERMINAL_ROUTE, params: opener.params(computer) })} style={[row, { flexDirection: "row", alignItems: "center", gap: 12, opacity: enabled ? 1 : 0.6 }]}>
      {id === "herdr" ? <Image source={herdrIcon} accessible={false} style={{ width: 28, height: 28 }} /> : <Ionicons name="terminal-outline" size={28} color={c.text} />}
      <View style={{ flex: 1, gap: 2 }}>
       <Text style={{ color: enabled ? c.text : c.textMuted, fontWeight: "700" }}>{o.names[id]}{enabled ? "" : ` · ${o.unavailable}`}</Text>
       <Text style={{ color: c.textMuted }}>{why ?? o.descriptions[id]}</Text>
      </View>
     </Pressable>;
    })}<Text style={{ color: c.textMuted, margin: 16 }}>{o.more}</Text></> : null}
  </ScrollView>
 </Screen>;
}
