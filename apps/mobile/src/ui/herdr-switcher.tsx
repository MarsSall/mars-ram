import { useCallback, useEffect, useRef, useState, type ComponentRef } from "react";
import { AccessibilityInfo, AppState, Keyboard, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SavedHost } from "../core/host-catalog";
import { agentGroups, beginHerdrRefresh, finishHerdrRefresh, filterWorkspaces, type HerdrEntry, type HerdrStatus, type HerdrTab, type HerdrWorkspace, type SwitcherError, type SwitcherResult } from "../core/herdr-switcher";
import { beginServersRefresh, finishServersRefresh, serverOpenable, type Server, type ServersEntry } from "../core/servers";
import { catalog, herdrSwitcher, servers, sessions } from "../services";
import { usePreferences } from "./preferences";
import { en } from "./i18n/en";
import { AgentIcon } from "./agent-icon";

const frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
function StatusGlyph({ status, frame }: { status: HerdrStatus; frame: string }) {
 const { theme: { colors: c }, t: { switcher: s } } = usePreferences();
 const label = status === "working" ? s.working : status === "blocked" ? s.question : status === "done" ? s.ready : undefined;
 return <Text accessible={!!label} accessibilityLabel={label} style={{ width: 18, color: status === "blocked" ? c.danger : status === "done" ? c.done : c.working, fontFamily: "monospace", fontSize: 16 }}>{status === "working" ? frame : status === "blocked" ? "✗" : status === "done" ? "✓" : ""}</Text>;
}
function TabIcon({ kind }: { kind: HerdrTab["kind"] }) {
 const { theme: { colors: c } } = usePreferences();
 if (kind === "pi" || kind === "gentle-shell") return <AgentIcon program={kind} size={18} />;
 if (kind === "shell") return <View accessible={false} style={{ width: 18, height: 15, borderWidth: 1, borderColor: c.textMuted, borderRadius: 2, justifyContent: "center" }}><Text style={{ color: c.textMuted, fontFamily: "monospace", fontSize: 11, lineHeight: 12 }}>{">_"}</Text></View>;
 return <Text accessible={false} style={{ width: 18, color: c.textMuted, fontSize: 16 }}>◇</Text>;
}
// Memory only: survives drawer/screen remounts, never persists remote lists.
const remembered: { computers: SavedHost[]; entries: Record<string, HerdrEntry> } = { computers: [], entries: {} };
const rememberedServers: Record<string, ServersEntry> = {};
export function HerdrSwitcherDrawer({ visible, hostId, close, choose, chooseServer }: {
 visible: boolean; hostId: string; close: () => void;
 chooseServer: (computer: SavedHost, server: Server) => void;
 choose: (computer: SavedHost, workspace: string, tab?: string) => Promise<SwitcherResult<void>>;
}) {
 const { theme, t: { switcher: s, servers: ss } } = usePreferences(); const c = theme.colors; const insets = useSafeAreaInsets();
 const [computers, setComputers] = useState<SavedHost[]>(remembered.computers); const [selected, setSelected] = useState(hostId);
 const [entries, setEntries] = useState<Record<string, HerdrEntry>>(() => ({ ...remembered.entries }));
 const [serverMode, setServerMode] = useState(false);
 const [serverEntries, setServerEntries] = useState<Record<string, ServersEntry>>({ ...rememberedServers });
 const [serverAttempt, setServerAttempt] = useState(0);
 const [query, setQuery] = useState(""); const [segment, setSegment] = useState<"spaces" | "agents">("spaces");
 const [busy, setBusy] = useState(false); const [choiceError, setChoiceError] = useState<SwitcherError | null>(null);
 const [catalogLoaded, setCatalogLoaded] = useState(false);
 const [catalogError, setCatalogError] = useState(false); const [catalogAttempt, setCatalogAttempt] = useState(0);
 const [reduceMotion, setReduceMotion] = useState(true); const [frame, setFrame] = useState(0);
 const search = useRef<ComponentRef<typeof TextInput>>(null);
 function dismissInput() { search.current?.blur(); Keyboard.dismiss(); }
 function dismissDrawer() { dismissInput(); close(); }
 const active = useRef(false); const generation = useRef(0); const pending = useRef(new Set<string>());
 useEffect(() => {
  let alive = true; let changed = false;
  const off = AccessibilityInfo.addEventListener("reduceMotionChanged", value => { changed = true; setReduceMotion(value); });
  void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive && !changed) setReduceMotion(value); }).catch(() => {});
  return () => { alive = false; off.remove(); };
 }, []);
 useEffect(() => { if (!visible || reduceMotion) return; const timer = setInterval(() => setFrame(n => (n + 1) % frames.length), 80); return () => clearInterval(timer); }, [visible, reduceMotion]);
 useEffect(() => {
  active.current = visible; const current = ++generation.current; pending.current.clear();
  if (!visible) return;
  dismissInput();
  setEntries({ ...remembered.entries }); setServerMode(false); setSegment("spaces"); setQuery(""); setChoiceError(null); setSelected(hostId); setCatalogError(false); setCatalogLoaded(remembered.computers.length > 0); setComputers(remembered.computers);
  void catalog.list().then(hosts => { if (active.current && generation.current === current) { remembered.computers = [...hosts.filter(h => h.id === hostId), ...hosts.filter(h => h.id !== hostId)]; setComputers(remembered.computers); setCatalogLoaded(true); } }).catch(() => { if (active.current && generation.current === current) setCatalogError(true); });
  return () => { active.current = false; ++generation.current; };
 }, [visible, hostId, catalogAttempt]);
 const load = useCallback(async (computer: SavedHost) => {
  if (!active.current || pending.current.has(computer.id) || AppState.currentState !== "active") return;
  const current = generation.current; pending.current.add(computer.id);
  remembered.entries[computer.id] = beginHerdrRefresh(remembered.entries[computer.id]);
  setEntries({ ...remembered.entries });
  const result = await herdrSwitcher.list(computer);
  if (active.current && generation.current === current) {
   pending.current.delete(computer.id);
   remembered.entries[computer.id] = finishHerdrRefresh(remembered.entries[computer.id], result);
   setEntries({ ...remembered.entries });
  }
 }, []);
 useEffect(() => {
  if (!visible) return;
  const targets = segment === "agents" ? computers : computers.filter(h => h.id === selected);
  const refresh = () => { for (const computer of targets) void load(computer); };
  refresh(); const timer = setInterval(refresh, 5000);
  const subscription = AppState.addEventListener("change", state => { if (state === "active") refresh(); });
  return () => { clearInterval(timer); subscription.remove(); };
 }, [visible, selected, computers, segment, load]);
 useEffect(() => {
  if (!visible) return;
  const computer = computers.find(h => h.id === selected);
  if (!computer) return;
  let alive = true; let pending = false;
  const refresh = async () => {
   if (!alive || pending || AppState.currentState !== "active") return;
   pending = true;
   rememberedServers[computer.id] = beginServersRefresh(rememberedServers[computer.id]);
   setServerEntries({ ...rememberedServers });
   const result = await servers.list(computer);
   if (alive) { rememberedServers[computer.id] = finishServersRefresh(rememberedServers[computer.id], result); setServerEntries({ ...rememberedServers }); }
   pending = false;
  };
  void refresh(); const timer = setInterval(() => void refresh(), 5000);
  const activity = AppState.addEventListener("change", state => { if (state === "active") void refresh(); });
  return () => { alive = false; clearInterval(timer); activity.remove(); };
 }, [visible, selected, computers, serverAttempt]);
 const chooseLock = useRef(false);
 const lastChoice = useRef<{ computer: SavedHost; workspace: string; tab?: string } | null>(null);
 async function pick(computer: SavedHost, workspace: string, tab?: string) {
  if (chooseLock.current) return;
  dismissInput();
  lastChoice.current = { computer, workspace, tab };
  chooseLock.current = true; setBusy(true); setChoiceError(null);
  try { const result = await choose(computer, workspace, tab); if (result.ok) dismissDrawer(); else setChoiceError(result.code); }
  catch { setChoiceError("HERDR_FAILED"); }
  finally { chooseLock.current = false; setBusy(false); }
 }
 const frameText = frames[reduceMotion ? 0 : frame];
 function row(computer: SavedHost, workspace: HerdrWorkspace, tab?: HerdrTab, agent = false) {
  const current = computer.id === hostId && workspace.focused && (!tab || tab.focused);
  return <Pressable key={`${computer.id}/${workspace.id}/${tab?.id ?? ""}`} accessibilityRole="button" accessibilityState={{ selected: current, disabled: busy }} disabled={busy} onPress={() => void pick(computer, workspace.id, tab?.id)} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingLeft: tab && !agent ? 34 : 8, borderRadius: 10, backgroundColor: current ? `${c.accent}29` : "transparent" }}>
   {tab && !agent ? <TabIcon kind={tab.kind} /> : <StatusGlyph status={tab?.status ?? workspace.status} frame={frameText} />}
   {agent && tab ? <TabIcon kind={tab.kind} /> : null}
   <Text numberOfLines={1} style={{ color: c.text, fontWeight: !tab || agent ? "600" : "400", fontSize: tab && !agent ? 14 : 16, flexShrink: 1 }}>{tab?.label || workspace.label}</Text>
   {agent || (!tab && workspace.branch) ? <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: c.textMuted, fontFamily: theme.font.mono, fontSize: 12, flex: 1 }}>{agent ? computer.name : `⎇ ${workspace.branch}`}</Text> : null}
  </Pressable>;
 }
 function message(computer: SavedHost) {
  const entry = entries[computer.id];
  if (!entry || entry.state === "loading") return <Text accessibilityLiveRegion="polite" style={{ color: c.textMuted, padding: 12 }}>{s.loading(computer.name)}</Text>;
  if (entry.state === "error") return <View style={{ padding: 12 }}><Text accessibilityRole="alert" style={{ color: c.danger }}>{computer.name}: {s[entry.code]}</Text><Pressable accessibilityRole="button" onPress={() => { sessions.allowUnlockAgain(); void load(computer); }} style={{ minHeight: 48, justifyContent: "center" }}><Text style={{ color: c.accentText }}>{s.retry}</Text></Pressable></View>;
  return <>
   {entry.refreshError ? <Text accessibilityLiveRegion="polite" style={{ color: c.textMuted, padding: 12 }}>{s === en.switcher ? "Could not refresh" : "No se pudo actualizar"}</Text> : null}
   {entry.truncated ? <Text style={{ color: c.textMuted, padding: 12 }}>{s.truncated}</Text> : null}
  </>;
 }
 const computer = computers.find(h => h.id === selected); const entry = entries[selected];
 const serverEntry = serverEntries[selected];
 const serverPill = serverEntry?.state === "ok" ? ss.count(serverEntry.servers.filter(serverOpenable).length) : "⌁ …";
 const workspaces = entry?.state === "ok" ? filterWorkspaces(entry.workspaces, query) : [];
 const groups = agentGroups(computers.flatMap(computer => { const e = entries[computer.id]; return e?.state === "ok" ? [{ computer, workspaces: e.workspaces }] : []; }), query);
 return <Modal visible={visible} transparent animationType="none" onRequestClose={dismissDrawer} onShow={dismissInput} statusBarTranslucent navigationBarTranslucent>
  <View style={{ flex: 1 }}>
   <Pressable accessibilityRole="button" accessibilityLabel={s.close} onPress={dismissDrawer} style={{ position: "absolute", inset: 0, backgroundColor: "rgba(13,14,20,.6)" }} />
   <View accessibilityViewIsModal accessibilityLabel={s.title} style={{ width: 340, maxWidth: "92%", flex: 1, backgroundColor: c.surface, borderTopRightRadius: 24, borderBottomRightRadius: 24, paddingHorizontal: 12, paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 12), borderRightWidth: 1, borderColor: c.border }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
     <Pressable accessibilityRole="button" accessibilityLabel={`${computer?.name ?? ""} · ${s.close}`} onPress={dismissDrawer} style={{ flex: 1, minHeight: 48, justifyContent: "center" }}><Text numberOfLines={1} style={{ color: c.text, fontFamily: theme.font.mono }}>{computer?.name ?? ""} ▴</Text></Pressable>
     <Pressable accessibilityRole="button" accessibilityLabel={`${serverEntry?.state === "ok" ? serverPill : serverEntry?.state === "error" ? ss.failed : ss.loading(computer?.name ?? "")} · ${computer?.name ?? ""}`} accessibilityState={{ selected: serverMode }} aria-pressed={serverMode} onPress={() => { dismissInput(); setServerMode(value => !value); setSegment("spaces"); }} style={{ minHeight: 48, paddingHorizontal: 12, borderRadius: 24, justifyContent: "center", backgroundColor: serverMode ? c.done : c.surfaceRaised }}><Text style={{ color: serverMode ? c.onAccent : c.done, fontWeight: "600" }}>{serverPill}</Text></Pressable>
    </View>
    {!serverMode ? <TextInput ref={search} autoFocus={false} accessibilityLabel={s.search} placeholder={s.search} placeholderTextColor={c.textMuted} value={query} onChangeText={setQuery} style={{ minHeight: 48, borderRadius: 24, paddingHorizontal: 16, color: c.text, backgroundColor: c.surfaceRaised }} /> : null}
    <View style={{ flexDirection: "row", marginTop: 12, padding: 3, borderRadius: 10, backgroundColor: c.surfaceRaised }}>{(["spaces", "agents"] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: !serverMode && segment === value }} onPress={() => { setServerMode(false); setSegment(value); }} style={{ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: !serverMode && segment === value ? c.accent : "transparent" }}><Text style={{ color: !serverMode && segment === value ? c.onAccent : c.textMuted, fontWeight: "700" }}>{s[value]}</Text></Pressable>)}</View>
    {serverMode || segment === "spaces" ? <View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 8 }}>{computers.map(h => <Pressable key={h.id} accessibilityRole="button" accessibilityState={{ selected: selected === h.id }} onPress={() => setSelected(h.id)} style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 12, borderRadius: 24, borderWidth: 1, borderColor: selected === h.id ? c.accent : c.border, backgroundColor: selected === h.id ? c.surfaceRaised : "transparent" }}><Text style={{ color: c.text }}>{selected === h.id ? "● " : "○ "}{h.name}</Text></Pressable>)}</ScrollView></View> : null}
    <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }}>
     {catalogError ? <View><Text accessibilityRole="alert" style={{ color: c.danger }}>{s.HERDR_FAILED}</Text><Pressable accessibilityRole="button" onPress={() => setCatalogAttempt(n => n + 1)} style={{ minHeight: 48, justifyContent: "center" }}><Text style={{ color: c.accentText }}>{s.retry}</Text></Pressable></View> : null}
     {catalogLoaded && !computers.length ? <Text style={{ color: c.textMuted, padding: 12 }}>{s.noComputers}</Text> : null}
     {busy ? <Text accessibilityLiveRegion="polite" style={{ color: c.textMuted, padding: 12 }}>{s.focusing}</Text> : null}
     {choiceError ? <View style={{ padding: 12 }}><Text accessibilityRole="alert" style={{ color: c.danger }}>{s[choiceError]}</Text><Pressable accessibilityRole="button" disabled={busy} onPress={() => { const choice = lastChoice.current; if (choice) void pick(choice.computer, choice.workspace, choice.tab); }} style={{ minHeight: 48, justifyContent: "center" }}><Text style={{ color: c.accentText }}>{s.retry}</Text></Pressable></View> : null}
     {serverMode ? <>
      <Text accessibilityRole="header" style={{ color: c.textMuted, marginVertical: 16 }}>{computer?.name}</Text>
      {!serverEntry || serverEntry.state === "loading" ? <Text accessibilityLiveRegion="polite" style={{ color: c.textMuted, padding: 12 }}>{ss.loading(computer?.name ?? "")}</Text> : serverEntry.state === "error" ? <View><Text accessibilityRole="alert" style={{ color: c.danger }}>{serverEntry.code === "CLI_MISSING" ? ss.update : ss.failed}</Text><Pressable accessibilityRole="button" onPress={() => { sessions.allowUnlockAgain(); setServerAttempt(n => n + 1); }} style={{ minHeight: 48, justifyContent: "center" }}><Text style={{ color: c.accentText }}>{ss.retry}</Text></Pressable></View> : <>
       {serverEntry.refreshError ? <Text accessibilityLiveRegion="polite" style={{ color: c.attention }}>{ss.stale}</Text> : null}
       {serverEntry.truncated ? <Text style={{ color: c.textMuted }}>{ss.truncated}</Text> : null}
       {!serverEntry.servers.length ? <Text style={{ color: c.textMuted, padding: 12 }}>{ss.empty}</Text> : null}
       {serverEntry.servers.map(server => {
        const enabled = serverOpenable(server); const process = server.process ?? ss.unknown;
        const reason = server.scope === "other" ? ss.other(server.address) : !server.web ? ss.notWeb : null;
        return <Pressable key={server.port} accessibilityRole="button" accessibilityLabel={`${ss.open(server.port, process)}${reason ? ` · ${reason}` : ""}${server.scope === "all" ? ` · ${ss.all}` : ""}`} accessibilityState={{ disabled: !enabled }} disabled={!enabled} onPress={() => { if (computer) { dismissDrawer(); chooseServer(computer, server); } }} style={{ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, padding: 10, opacity: enabled ? 1 : .55 }}>
         <Text style={{ color: enabled ? c.accentText : c.textMuted, fontFamily: theme.font.mono, fontWeight: "700" }}>{server.port}</Text>
         <View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: c.text, fontWeight: "600" }}>{process}</Text><Text numberOfLines={1} style={{ color: c.textMuted, fontFamily: theme.font.mono, fontSize: 12 }}>{server.cwd ?? "—"}</Text>{reason ? <Text style={{ color: c.textMuted, fontSize: 12 }}>{reason}</Text> : null}</View>
         {server.scope === "all" ? <Text style={{ color: c.attention, borderWidth: 1, borderColor: c.attention, borderRadius: 10, padding: 4, fontSize: 11 }}>{ss.all}</Text> : null}
         {enabled ? <Text accessible={false} style={{ color: c.textMuted }}>›</Text> : null}
        </Pressable>;
       })}
      </>}
     </> : segment === "spaces" ? <>
      <Text accessibilityRole="header" style={{ color: c.textMuted, fontWeight: "700", fontSize: 13, letterSpacing: .6, marginVertical: 16 }}>{s.spaces.toLocaleUpperCase()} · {workspaces.length}</Text>
      {computer ? message(computer) : !catalogError && !catalogLoaded ? <Text style={{ color: c.textMuted }}>{s.loading("")}</Text> : null}
      {entry?.state === "ok" && !workspaces.length ? <Text style={{ color: c.textMuted, padding: 12 }}>{entry.workspaces.length ? s.noMatches : s.empty}</Text> : null}
      {computer ? workspaces.map(w => <View key={w.id}>{row(computer, w)}{w.tabs.map(tab => row(computer, w, tab))}</View>) : null}
     </> : <>
      {computers.map(h => <View key={h.id}>{message(h)}</View>)}
      {(["blocked", "working", "done", "idle"] as const).map(status => <View key={status}><Text accessibilityRole="header" style={{ color: c.textMuted, fontSize: 13, fontWeight: "700", letterSpacing: .6, marginVertical: 16 }}>{s[status].toLocaleUpperCase()} · {groups[status].length}</Text>{groups[status].map(({ computer, workspace, tab }) => row(computer, workspace, tab, true))}</View>)}
      {computers.every(h => entries[h.id]?.state === "ok") && !Object.values(groups).some(rows => rows.length) ? <Text style={{ color: c.textMuted, padding: 12 }}>{query ? s.noMatches : s.noAgents}</Text> : null}
     </>}
    </ScrollView>
   </View>
  </View>
 </Modal>;
}
