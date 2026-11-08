import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { BackHandler, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { SavedHost } from "../../core/host-catalog";
import { SHORTCUT_LIMIT, programNames, shortcutInitialStep, type Program, type Repo, type ReposResponse } from "../../core/shortcuts";
import { catalog, newShortcutId, sessions, shortcutHost, shortcuts } from "../../services";
import { AgentIcon } from "../../ui/agent-icon";
import { PrimaryButton, Screen } from "../../ui/components";
import { usePreferences } from "../../ui/preferences";
import { ShortcutErrorView } from "../../ui/shortcuts";

type Step = "computer" | "repo" | "program";
type RepoState = { state: "loading" } | { state: "error"; code: string } | { state: "ready"; value: Extract<ReposResponse, { ok: true }> };
export default function AddShortcutScreen() {
 const router = useRouter();
 const { theme, t: { shortcuts: s } } = usePreferences(); const c = theme.colors;
 const [hosts, setHosts] = useState<SavedHost[] | null>(null); const [catalogError, setCatalogError] = useState(false);
 const [computer, setComputer] = useState<SavedHost | null>(null); const [step, setStep] = useState<Step>("computer");
 const [repos, setRepos] = useState<RepoState>({ state: "loading" }); const [query, setQuery] = useState("");
 const [repo, setRepo] = useState<Repo | null>(null); const [program, setProgram] = useState<Program | null>(null);
 const [saving, setSaving] = useState(false); const [saveError, setSaveError] = useState<"limit" | "failed" | null>(null); const [attempt, setAttempt] = useState(0);
 useEffect(() => { let active = true; setCatalogError(false); void catalog.list().then(rows => { if (!active) return; setHosts(rows); if (shortcutInitialStep(rows.length) === "repo") { setComputer(rows[0]); setStep("repo"); } }).catch(() => { if (active) setCatalogError(true); }); return () => { active = false; }; }, []);
 useEffect(() => {
  if (!computer || step !== "repo") return;
  let active = true; setRepos({ state: "loading" }); sessions.allowUnlockAgain();
  void shortcutHost.repos(computer).then(result => { if (active) setRepos(result.ok ? { state: "ready", value: result.value } : { state: "error", code: result.code }); }).catch(() => { if (active) setRepos({ state: "error", code: "FAILED" }); });
  return () => { active = false; };
 }, [computer, step, attempt]);
 const back = useCallback(() => { if (saving) return; if (step === "program") setStep("repo"); else if (step === "repo" && (hosts?.length ?? 0) > 1) { setStep("computer"); setComputer(null); setQuery(""); } else router.back(); }, [step, hosts, saving, router]);
 useEffect(() => { const subscription = BackHandler.addEventListener("hardwareBackPress", () => { back(); return true; }); return () => subscription.remove(); }, [back]);
 async function save() {
  if (!computer || !repo || !program || saving) return;
  setSaving(true); setSaveError(null);
  try { await shortcuts.add({ id: newShortcutId(), computerId: computer.id, repoPath: repo.path, repoName: repo.name, program }); router.back(); }
  catch (error) { setSaveError(error instanceof Error && error.message === "SHORTCUT_LIMIT" ? "limit" : "failed"); setSaving(false); }
 }
 const row = { minHeight: 64, borderRadius: theme.radius.medium, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, marginHorizontal: 16, marginBottom: 8, padding: 12, justifyContent: "center" as const };
 const selectedRepos = repos.state === "ready" ? repos.value.repos.filter(r => `${r.name} ${r.path}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : [];
 return <Screen footer={step === "program" ? <PrimaryButton label={saving ? s.saving : s.save} onPress={() => void save()} disabled={!program || saving} /> : undefined}>
  <Pressable accessibilityRole="button" onPress={back} style={{ minHeight: 48, paddingHorizontal: 16, justifyContent: "center" }}><Text style={{ color: c.accentText }}>‹ {s.back}</Text></Pressable>
  <Text accessibilityRole="header" style={{ color: c.text, fontSize: 26, fontWeight: "700", marginHorizontal: 16, marginBottom: 16 }}>{step === "computer" ? s.chooseComputer : step === "repo" ? s.chooseRepo : s.chooseProgram}</Text>
  {computer && step !== "computer" ? <Text style={{ color: c.textMuted, marginHorizontal: 16, marginBottom: 12 }}>{computer.name}{repo && step === "program" ? ` · ${repo.name}` : ""}</Text> : null}
  {step === "repo" ? <TextInput accessibilityLabel={s.search} placeholder={s.search} placeholderTextColor={c.textMuted} value={query} onChangeText={setQuery} style={{ minHeight: 48, marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 12, borderRadius: 10, backgroundColor: c.surfaceRaised, color: c.text }} /> : null}
  <ScrollView keyboardShouldPersistTaps="handled">
   {step === "computer" ? <>{hosts === null && !catalogError ? <Text style={{ color: c.textMuted, margin: 16 }}>{s.loading}</Text> : null}{catalogError ? <Text accessibilityRole="alert" style={{ color: c.danger, margin: 16 }}>{s.failed}</Text> : null}{hosts?.length === 0 ? <Text style={{ color: c.textMuted, margin: 16 }}>{s.noComputers}</Text> : null}{hosts?.map(h => <Pressable key={h.id} accessibilityRole="button" onPress={() => { setComputer(h); setRepo(null); setProgram(null); setStep("repo"); }} style={row}><Text style={{ color: c.text, fontWeight: "700" }}>{h.name}</Text></Pressable>)}</> : null}
   {step === "repo" ? <>{repos.state === "loading" ? <Text accessibilityLiveRegion="polite" style={{ color: c.textMuted, margin: 16 }}>{s.loading}</Text> : repos.state === "error" ? <><ShortcutErrorView code={repos.code} computer={computer?.name ?? ""} /><Pressable accessibilityRole="button" onPress={() => setAttempt(n => n + 1)} style={{ minHeight: 48, marginHorizontal: 16, justifyContent: "center" }}><Text style={{ color: c.accentText }}>{s.retry}</Text></Pressable></> : <>{repos.value.truncated ? <Text style={{ color: c.textMuted, margin: 16 }}>{s.truncated}</Text> : null}{repos.value.repos.length === 0 ? <View style={{ margin: 16, gap: 8 }}><Text style={{ color: c.text }}>{s.empty(repos.value.roots.join(", ") || s.noRoots)}</Text><Text selectable style={{ color: c.textMuted }}>{s.hint}</Text></View> : selectedRepos.length === 0 ? <Text style={{ color: c.textMuted, margin: 16 }}>{s.noMatches}</Text> : null}{selectedRepos.map(r => <Pressable key={r.path} accessibilityRole="button" onPress={() => { setRepo(r); setProgram(null); setStep("program"); }} style={row}><Text style={{ color: c.text, fontWeight: "700" }}>{r.name}</Text><Text style={{ color: c.textMuted }} numberOfLines={1}>{r.path}</Text></Pressable>)}</>}</> : null}
   {step === "program" ? <>{(["gentle-shell", "pi", "opencode"] as const).map(p => <Pressable key={p} accessibilityRole="radio" accessibilityState={{ checked: p === program }} onPress={() => setProgram(p)} style={[row, { flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 12, borderColor: p === program ? c.accentText : c.border }]}><AgentIcon program={p} /><Text style={{ color: c.text, fontWeight: "700" }}>{programNames[p]}</Text></Pressable>)}<Text style={{ color: c.textMuted, margin: 16 }}>{s.more}</Text>{saveError ? <Text accessibilityRole="alert" style={{ color: c.danger, margin: 16 }}>{saveError === "limit" ? s.limit(SHORTCUT_LIMIT) : s.saveFailed}</Text> : null}</> : null}
  </ScrollView>
 </Screen>;
}
