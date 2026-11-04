import { router, useFocusEffect, type Href } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import type { SavedHost } from "../core/host-catalog";
import { programNames, shortcutErrorKind, shortcutLabel, type Program, type Shortcut } from "../core/shortcuts";
import { shortcutHost, shortcuts, sessions } from "../services";
import { AgentIcon } from "./agent-icon";
import { SectionTitle } from "./components";
import { usePreferences } from "./preferences";

export function ShortcutErrorView({ code, computer, program }: { code: string; computer: string; program?: Program }) {
 const { theme: { colors: c }, t: { shortcuts: s } } = usePreferences();
 const [details, setDetails] = useState(false);
 const kind = shortcutErrorKind(code);
 const message = kind === "storageFailed" ? s.storageFailed : kind === "hostOutdated" ? s.hostOutdated(computer) : kind === "programMissing" ? s.programMissing(program ? programNames[program] : "", computer) : kind === "repoUnavailable" ? s.repoUnavailable : kind === "herdrUnavailable" ? s.herdrUnavailable(computer) : kind === "locked" ? s.locked : s.failed;
 return <View style={{ padding: 12 }}><Text accessibilityRole="alert" style={{ color: c.danger }}>{message}</Text><Pressable accessibilityRole="button" onPress={() => setDetails(v => !v)} style={{ minHeight: 48, justifyContent: "center" }}><Text style={{ color: c.accentText }}>{details ? s.hideDetails : s.details}</Text></Pressable>{details ? <Text selectable style={{ color: c.textMuted }}>{code}</Text> : null}</View>;
}

export function ShortcutsSection({ hosts }: { hosts: SavedHost[] }) {
 const { theme, t: { shortcuts: s } } = usePreferences(); const c = theme.colors;
 const [items, setItems] = useState<Shortcut[]>([]); const [busy, setBusy] = useState<string | null>(null);
 const lock = useRef(false); const [error, setError] = useState<{ code: string; computer: string; program?: Program } | null>(null);
 useFocusEffect(useCallback(() => { let active = true; void shortcuts.list().then(rows => { if (active) setItems(rows); }).catch(() => { if (active) setError({ code: "STORAGE_FAILED", computer: "" }); }); return () => { active = false; }; }, []));
 async function open(item: Shortcut) {
  if (lock.current) return;
  const computer = hosts.find(h => h.id === item.computerId);
  if (!computer) { setError({ code: "COMPUTER_MISSING", computer: "", program: item.program }); return; }
  lock.current = true; setBusy(item.id); setError(null); sessions.allowUnlockAgain();
  try {
   const result = await shortcutHost.launch(computer, item.repoPath, item.program);
   if (!result.ok) { setError({ code: result.code, computer: computer.name, program: item.program }); return; }
   router.push({ pathname: "/session/terminal/[id]", params: { id: computer.id, standalone: "1", computer: computer.name, focusWorkspace: result.value.workspace, focusTab: result.value.tab } });
  } catch { setError({ code: "FAILED", computer: computer.name, program: item.program }); }
  finally { lock.current = false; setBusy(null); }
 }
 function remove(item: Shortcut) {
  Alert.alert(s.remove, s.removeConfirm, [{ text: s.cancel, style: "cancel" }, { text: s.remove, style: "destructive", onPress: () => { void shortcuts.remove(item.id).then(setItems).catch(() => setError({ code: "STORAGE_FAILED", computer: "" })); } }]);
 }
 const tile = { width: "48%" as const, minHeight: 100, borderRadius: theme.radius.medium, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, padding: 12, justifyContent: "center" as const, gap: 6 };
 return <View><SectionTitle>{s.title}</SectionTitle><View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8, marginHorizontal: theme.spacing(4) }}>
  {items.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${shortcutLabel(item)} · ${hosts.find(h => h.id === item.computerId)?.name ?? ""}`} accessibilityHint={s.remove} accessibilityState={{ disabled: busy !== null }} disabled={busy !== null} onPress={() => void open(item)} onLongPress={() => remove(item)} style={tile}><AgentIcon program={item.program} size={24} /><Text numberOfLines={2} style={{ color: c.text, fontWeight: "700" }}>{shortcutLabel(item)}</Text><Text numberOfLines={1} style={{ color: c.textMuted }}>{busy === item.id ? s.opening : hosts.find(h => h.id === item.computerId)?.name ?? "—"}</Text></Pressable>)}
  <Pressable accessibilityRole="button" onPress={() => router.push("/shortcut" as Href)} style={[tile, { borderStyle: "dashed" }]}><Text style={{ color: c.accentText, fontSize: 24 }}>+</Text><Text style={{ color: c.text, fontWeight: "700" }}>{s.add}</Text></Pressable>
 </View>{error ? <ShortcutErrorView {...error} /> : null}</View>;
}
