import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Image, PanResponder, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { projectFileState, projectTreeEntries, type ProjectFileState, type ProjectTreeEntry } from "../core/project-file-state";
import { hasTailscaleFeatures, type SavedHost } from "../core/host-catalog";
import { formatAge, formatSize, highlightLine, textLines, hostFilePath, summarizeChanges, type Change, type Commit, type ProjectErrorCode, type ProjectFile, type ProjectOptions, type ProjectResult, type ProjectStatus, type ProjectTree, type ProjectValue, type ProjectVerb } from "../core/project";
import { catalog, clipboard, createLinkService, projectBrowser } from "../services";
import { usePreferences } from "./preferences";
import type { Theme } from "./theme";
import type { Strings } from "./i18n/en";

// design/project-files/01-hoja-moshi.html: a sheet over the terminal with four bottom tabs.
// Swipe the grabber up for full screen, down to return or close; ⬓ splits a file or diff
// with the live terminal above it. Git is read-only (S1); files are shared (S2).
export type SheetMode = "sheet" | "full" | "split";
type Tab = "files" | "changes" | "history" | "branches";
type View_ = { kind: "list" } | { kind: "file"; path: string } | { kind: "diff"; path: string; commit?: string; list?: string[] } | { kind: "commit"; commit: Commit };
type Load<T> = { state: "loading" } | { state: "error"; code: ProjectErrorCode } | { state: "ok"; value: T };

function useProject<V extends ProjectVerb>(computer: SavedHost | null, verb: V, options: ProjectOptions | null, attempt: number): Load<ProjectValue[V]> {
 const [load, setLoad] = useState<Load<ProjectValue[V]>>({ state: "loading" });
 const key = JSON.stringify(options);
 useEffect(() => {
  // Nothing to load (sheet hidden or not ready): drop the old result, so a stale tree can never
  // re-pin the previous workspace when the sheet opens again.
  if (!computer || !options) { setLoad({ state: "loading" }); return; }
  let alive = true; setLoad({ state: "loading" });
  void projectBrowser.run(computer, verb, options).then((result: ProjectResult<V>) => { if (alive) setLoad(result.ok ? { state: "ok", value: result.value } : { state: "error", code: result.code }); });
  return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [computer, verb, key, attempt]);
 return load;
}

const stateTokens = { modified: "fileModified", deleted: "fileDeleted", uncommitted: "fileUncommitted", "last-commit": "fileLastCommit" } as const;
const stateMarks: Record<ProjectFileState, string> = { modified: "M", deleted: "D", uncommitted: "?", "last-commit": "●" };
type Ctx = {
 lastFiles: Change[]; colorNotice: string | null;
 c: Theme["colors"]; theme: Theme; p: Strings["project"]; live: SavedHost | null; attempt: number; ws: string | null; root: ProjectTree["root"] | null; changes: Change[]; mode: SheetMode;
 setView(view: View_): void; setDir(dir: string): void; icon(name: keyof typeof Ionicons.glyphMap, color?: string, size?: number): ReactNode;
 header(title: string, subtitle: string, splitButton: boolean): ReactNode; failure(code: ProjectErrorCode): ReactNode; loading(): ReactNode;
 shareBar(path: string, size: number): ReactNode; changeRow(change: Change, onPress: () => void): ReactNode;
};
function Files({ x, tree, dir }: { x: Ctx; tree: Load<ProjectTree>; dir: string }) {
 const { c, theme, p, setView, setDir, icon, loading, failure } = x;
 if (tree.state === "loading") return loading();
 // A wholly deleted folder has no filesystem listing; its known deletions still form a navigable tree.
 const deletedFolder = tree.state === "error" && tree.code === "NOT_FOUND" && dir && x.root && projectTreeEntries(dir, [], x.changes).length > 0;
 if (tree.state === "error" && !deletedFolder) return failure(tree.code);
 const now = Date.now(); const value: ProjectTree = tree.state === "ok" ? tree.value : { version: 1, root: x.root!, path: dir, entries: [], truncated: false };
 const crumbs = value.path ? value.path.split("/") : [];
 const entries = projectTreeEntries(value.path, value.entries, x.changes);
 const row = (entry: ProjectTreeEntry) => {
  const path = value.path ? `${value.path}/${entry.name}` : entry.name; const age = entry.missing ? "" : formatAge(entry.mtime, now);
  const state = projectFileState(path, x.changes, x.lastFiles, entry.kind === "dir");
  const label = entry.kind === "dir" ? p.folder(entry.name, age) : entry.kind === "link" ? p.link(entry.name) : p.file(entry.name, age);
  return <Pressable key={entry.name} accessibilityRole="button" accessibilityLabel={`${label}${state ? `, ${p.fileStates[state]}` : ""}`} disabled={entry.kind === "link" || entry.kind === "other"} onPress={() => entry.kind === "dir" ? setDir(path) : entry.missing ? setView({ kind: "diff", path }) : setView({ kind: "file", path })} style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, borderRadius: theme.radius.medium, backgroundColor: pressed ? c.surfaceRaised : "transparent" })}>
   <Text accessible={false} style={{ color: c.textMuted, width: 12 }}>{entry.kind === "dir" ? "›" : ""}</Text>
   {icon(entry.kind === "dir" ? "folder" : entry.kind === "link" ? "link-outline" : /\.(png|jpe?g|gif|webp)$/i.test(entry.name) ? "image-outline" : "document-text-outline", entry.kind === "dir" ? c.accentText : c.textMuted)}
   <Text numberOfLines={1} style={{ flex: 1, color: state ? c[stateTokens[state]] : entry.name.startsWith(".") || entry.kind === "link" ? c.textMuted : c.text, textDecorationLine: state === "deleted" && entry.kind !== "dir" ? "line-through" : "none", fontSize: 16 }}>{entry.name}</Text>
   {state ? <Text accessible={false} style={{ color: c[stateTokens[state]], fontFamily: theme.font.mono, fontSize: 12 }}>{x.changes.find(ch => ch.path === path)?.status ?? stateMarks[state]}</Text> : null}
   <Text style={{ color: c.textMuted, fontFamily: theme.font.mono, fontSize: 13 }}>{age}</Text>
  </Pressable>;
 };
 return <ScrollView>
  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", paddingHorizontal: 6 }}>
   <Pressable accessibilityRole="button" onPress={() => setDir("")} style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: 4 }}><Text style={{ color: crumbs.length ? c.textMuted : c.text, fontFamily: theme.font.mono, fontSize: 13 }}>{value.root.name}</Text></Pressable>
   {crumbs.map((part, i) => <Pressable key={i} accessibilityRole="button" onPress={() => setDir(crumbs.slice(0, i + 1).join("/"))} style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: 4 }}><Text style={{ color: i === crumbs.length - 1 ? c.text : c.textMuted, fontFamily: theme.font.mono, fontSize: 13 }}>/ {part}</Text></Pressable>)}
  </ScrollView>
  {value.root.git ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 10, paddingBottom: 8 }}>{(Object.keys(stateTokens) as ProjectFileState[]).map(state => <Text key={state} style={{ color: c[stateTokens[state]], fontSize: 11 }}>{stateMarks[state]} {p.fileStates[state]}</Text>)}</ScrollView> : null}
  {value.root.git && x.colorNotice ? <Text accessibilityLiveRegion="polite" style={{ color: c.textMuted, paddingHorizontal: 10, fontSize: 12 }}>{x.colorNotice}</Text> : null}
  {entries.length ? entries.map(row) : <Text style={{ color: c.textMuted, padding: 12 }}>{p.empty}</Text>}
  {value.truncated ? <Text style={{ color: c.attention, padding: 12, fontSize: 12 }}>{p.truncated}</Text> : null}
 </ScrollView>;
}
function FileView({ x, path }: { x: Ctx; path: string }) {
 const { c, p, live, attempt, ws, header, loading, failure, shareBar } = x;
 const file = useProject(live, "file", ws ? { path, workspace: ws } : null, attempt);
 const name = path.split("/").at(-1)!;
 const lines = useMemo(() => file.state === "ok" && file.value.kind === "text" ? textLines(file.value.content!) : [], [file]);
 const meta = file.state === "ok" ? [file.value.language, file.value.kind === "text" ? p.lines(lines.length) : null, formatSize(file.value.size)].filter(Boolean).join(" · ") : "";
 return <View style={{ flex: 1 }}>
  {header(name, path, file.state === "ok" && file.value.kind === "text")}
  {meta ? <Text style={{ color: c.textMuted, fontSize: 12, paddingHorizontal: 12, paddingBottom: 6 }}>{meta}</Text> : null}
  {file.state === "loading" ? loading() : file.state === "error" ? failure(file.code) : <Content x={x} value={file.value} lines={lines} />}
  {file.state === "ok" ? shareBar(path, file.value.size) : null}
 </View>;
}
function Content({ x, value, lines }: { x: Ctx; value: ProjectFile; lines: string[] }) {
 const { c, theme, p } = x;
 if (value.kind === "image") return <View style={{ flex: 1, padding: 16, alignItems: "center", justifyContent: "center", backgroundColor: c.terminalBackground }}><Image accessible accessibilityLabel={value.path} resizeMode="contain" source={{ uri: `data:image/${/\.jpe?g$/i.test(value.path) ? "jpeg" : value.path.split(".").at(-1)!.toLowerCase()};base64,${value.content}` }} style={{ width: "100%", height: "100%" }} /></View>;
 if (value.kind === "binary") return <Text style={{ flex: 1, color: c.textMuted, padding: 16 }}>{p.binary}</Text>;
 const colors = { plain: c.terminalText, keyword: "#bb9af7", string: c.done, comment: c.textMuted, number: "#ff9e64" };
 return <View style={{ flex: 1, backgroundColor: c.terminalBackground }}>
  <ScrollView horizontal>
   <FlatList data={lines} keyExtractor={(_line, i) => String(i)} initialNumToRender={60} windowSize={11} contentContainerStyle={{ paddingVertical: 8 }}
    ListFooterComponent={value.truncated ? <Text style={{ color: c.attention, padding: 10, fontSize: 12 }}>{p.cut}</Text> : undefined}
    renderItem={({ item, index }) => <Text style={{ fontFamily: theme.font.mono, fontSize: 12.5, lineHeight: 20, paddingRight: 16 }}>
     <Text style={{ color: c.textMuted }}>{String(index + 1).padStart(4, " ")}  </Text>
     {highlightLine(item, value.language).map((token, i) => <Text key={i} style={{ color: colors[token.kind], fontStyle: token.kind === "comment" ? "italic" : "normal" }}>{token.text}</Text>)}
    </Text>} />
  </ScrollView>
 </View>;
}
function DiffView({ x, target }: { x: Ctx; target: Extract<View_, { kind: "diff" }> }) {
 const { c, theme, p, live, attempt, ws, changes, setView, header, loading, failure } = x;
 const diff = useProject(live, "diff", ws ? { path: target.path, workspace: ws, ...(target.commit ? { commit: target.commit } : {}) } : null, attempt);
 const list = target.list ?? []; const index = list.indexOf(target.path);
 const change = changes.find(ch => ch.path === target.path);
 const lines = diff.state === "ok" ? diff.value.diff.split("\n").filter((line, i, all) => line || i < all.length - 1) : [];
 const go = (to: number) => setView({ ...target, path: list[to]! });
 return <View style={{ flex: 1 }}>
  {header(target.path.split("/").at(-1)!, `${target.path}${change && change.added !== null ? ` · +${change.added} −${change.removed}` : ""}`, true)}
  {diff.state === "loading" ? loading() : diff.state === "error" ? failure(diff.code) : <ScrollView style={{ flex: 1, backgroundColor: c.terminalBackground }}><ScrollView horizontal><View style={{ paddingVertical: 6 }}>
   {lines.map((line, i) => { const kind = line.startsWith("@@") ? "hunk" : line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : "ctx";
    return <Text key={i} style={{ fontFamily: theme.font.mono, fontSize: 11.5, lineHeight: 18, paddingHorizontal: 8, color: kind === "hunk" ? c.working : kind === "add" ? c.done : kind === "del" ? c.danger : c.textMuted, backgroundColor: kind === "add" ? "rgba(158,206,106,0.13)" : kind === "del" ? "rgba(247,118,142,0.13)" : "transparent" }}>{line || " "}</Text>; })}
   {diff.value.truncated ? <Text style={{ color: c.attention, padding: 10, fontSize: 12 }}>{p.cut}</Text> : null}
  </View></ScrollView></ScrollView>}
  {list.length > 1 ? <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderColor: c.border }}>
   {[[p.previous, index - 1], [p.next, index + 1]].map(([label, to]) => <Pressable key={label as string} accessibilityRole="button" disabled={(to as number) < 0 || (to as number) >= list.length} onPress={() => go(to as number)} style={{ flex: 1, minHeight: 44, borderRadius: 14, justifyContent: "center", paddingHorizontal: 12, backgroundColor: c.surfaceRaised, opacity: (to as number) < 0 || (to as number) >= list.length ? 0.4 : 1 }}>
    <Text style={{ color: c.text, fontWeight: "600" }}>{label as string}</Text><Text style={{ color: c.textMuted, fontSize: 11 }}>{p.position(index + 1, list.length)}</Text>
   </Pressable>)}
  </View> : null}
 </View>;
}
function Changes({ x, status }: { x: Ctx; status: Load<ProjectStatus> }) {
 const { c, theme, p, setView, icon, loading, failure, changeRow } = x;
 if (status.state === "loading") return loading();
 if (status.state === "error") return failure(status.code);
 const value = status.value; const sum = summarizeChanges(value.changes); const list = value.changes.map(ch => ch.path);
 return <ScrollView>
  <View style={{ margin: 10, padding: 12, borderRadius: theme.radius.medium, backgroundColor: c.surfaceRaised }}>
   <Text style={{ color: c.text, fontSize: 15, fontWeight: "700" }}>{sum.count ? p.changed(sum.count) : p.clean} {sum.count ? <Text style={{ fontFamily: theme.font.mono, fontSize: 12, fontWeight: "400" }}><Text style={{ color: c.done }}>+{sum.added}</Text> <Text style={{ color: c.danger }}>−{sum.removed}</Text></Text> : null}</Text>
   {value.branch ? <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 4 }}>{p.uncommitted(value.branch)}</Text> : null}
   {value.lastCommit ? <View style={{ flexDirection: "row", gap: 10, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderColor: c.border }}>
    {icon("time-outline", c.textMuted, 18)}
    <View style={{ flex: 1 }}><Text style={{ color: c.textMuted, fontFamily: theme.font.mono, fontSize: 12 }}>{p.lastCommit(value.lastCommit.hash, formatAge(value.lastCommit.time, Date.now()))}</Text><Text style={{ color: c.text, fontSize: 13, fontWeight: "600", marginTop: 2 }}>{value.lastCommit.subject}</Text></View>
   </View> : null}
  </View>
  {value.changes.map(ch => changeRow(ch, () => setView({ kind: "diff", path: ch.path, list })))}
  {value.truncated ? <Text style={{ color: c.attention, padding: 12, fontSize: 12 }}>{p.truncated}</Text> : null}
 </ScrollView>;
}
function History({ x }: { x: Ctx }) {
 const { c, theme, p, live, attempt, ws, root, setView, loading, failure } = x;
 const log = useProject(live, "log", ws ? { limit: 50, workspace: ws } : null, attempt);
 if (log.state === "loading") return loading();
 if (log.state === "error") return failure(log.code);
 const now = Date.now();
 return <ScrollView>
  {root?.branch ? <Text style={{ margin: 10, marginTop: 14, color: c.textMuted, fontSize: 13, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>{root.branch}</Text> : null}
  {log.value.commits.length ? log.value.commits.map(commit => <Pressable key={commit.hash} accessibilityRole="button" accessibilityLabel={`${commit.subject}, ${commit.hash}, ${p.ago(formatAge(commit.time, now))}`} onPress={() => setView({ kind: "commit", commit })} style={({ pressed }) => ({ minHeight: 60, flexDirection: "row", gap: 12, paddingHorizontal: 10, paddingVertical: 8, borderRadius: theme.radius.medium, backgroundColor: pressed ? c.surfaceRaised : "transparent" })}>
   <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: c.accentText, marginTop: 5 }} />
   <View style={{ flex: 1 }}><Text style={{ color: c.text, fontSize: 14, fontWeight: "600", lineHeight: 19 }}>{commit.subject}</Text><Text style={{ color: c.textMuted, fontFamily: theme.font.mono, fontSize: 12 }}>{commit.hash} · {formatAge(commit.time, now)}</Text></View>
   <Text accessible={false} style={{ color: c.textMuted }}>›</Text>
  </Pressable>) : <Text style={{ color: c.textMuted, padding: 12 }}>{p.noCommits}</Text>}
 </ScrollView>;
}
function CommitView({ x, commit }: { x: Ctx; commit: Commit }) {
 const { c, theme, p, live, attempt, ws, setView, header, loading, failure, changeRow } = x;
 const shown = useProject(live, "show", ws ? { commit: commit.hash, workspace: ws } : null, attempt);
 const files = shown.state === "ok" ? shown.value.files : [];
 return <View style={{ flex: 1 }}>
  {header(`Commit ${commit.hash}`, p.ago(formatAge(commit.time, Date.now())), false)}
  <ScrollView>
   <View style={{ margin: 10, padding: 12, borderRadius: theme.radius.medium, backgroundColor: c.surfaceRaised }}><Text style={{ color: c.text, fontSize: 15, fontWeight: "700" }}>{commit.subject}</Text>{shown.state === "ok" ? <Text style={{ color: c.textMuted, fontFamily: theme.font.mono, fontSize: 12, marginTop: 4 }}>{p.commitFiles(files.length)}</Text> : null}</View>
   {shown.state === "loading" ? loading() : shown.state === "error" ? failure(shown.code) : files.map(ch => changeRow(ch, () => setView({ kind: "diff", path: ch.path, commit: commit.hash, list: files.map(f => f.path) })))}
  </ScrollView>
 </View>;
}
function Branches({ x }: { x: Ctx }) {
 const { c, theme, p, live, attempt, ws, icon, loading, failure } = x;
 const branches = useProject(live, "branches", ws ? { workspace: ws } : null, attempt);
 if (branches.state === "loading") return loading();
 if (branches.state === "error") return failure(branches.code);
 return <ScrollView accessibilityRole="list">
  {branches.value.branches.map(b => <View key={b.name} accessible style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, borderRadius: theme.radius.medium, backgroundColor: b.current ? "rgba(158,206,106,0.12)" : "transparent" }}>
   {icon("git-branch-outline", b.current ? c.done : c.textMuted, 18)}
   <Text numberOfLines={1} style={{ flex: 1, color: b.current ? c.text : c.textMuted, fontFamily: theme.font.mono, fontSize: 14 }}>{b.name}</Text>
   {b.current ? <Text style={{ color: c.onAccent, backgroundColor: c.done, fontSize: 11, fontWeight: "700", borderRadius: 10, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 2 }}>{p.current}</Text> : null}
   <Text style={{ color: c.textMuted, fontFamily: theme.font.mono, fontSize: 12 }}>{b.upstream === null ? p.noUpstream : b.ahead || b.behind ? `↑${b.ahead ?? 0} ↓${b.behind ?? 0}` : p.upToDate}</Text>
  </View>)}
  {branches.value.truncated ? <Text style={{ color: c.attention, padding: 12, fontSize: 12 }}>{p.truncated}</Text> : null}
  <Text style={{ color: c.textMuted, fontSize: 12, lineHeight: 18, margin: 10 }}>{p.branchesNote}</Text>
 </ScrollView>;
}
export function ProjectSheet({ visible, hostId, mode, setMode, close, paste, top }: { visible: boolean; hostId: string; mode: SheetMode; setMode: (mode: SheetMode) => void; close: () => void; paste: (text: string) => Promise<boolean>; top: number }) {
 const { theme, t: { project: p } } = usePreferences(); const c = theme.colors;
 const { height } = useWindowDimensions();
 const [computer, setComputer] = useState<SavedHost | null>(null);
 const [tab, setTab] = useState<Tab>("files"); const [dir, setDir] = useState("");
 const [view, setView] = useState<View_>({ kind: "list" }); const [attempt, setAttempt] = useState(0);
 const [notice, setNotice] = useState<string | null>(null); const [busy, setBusy] = useState(false);
 useEffect(() => { if (!visible) return; void catalog.list().then(hosts => setComputer(hosts.find(h => h.id === hostId) ?? null)); }, [visible, hostId]);
 useEffect(() => { if (!visible) { setView({ kind: "list" }); setDir(""); setTab("files"); setNotice(null); setPinned(null); setAttempt(0); } }, [visible]);
 useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 3000); return () => clearTimeout(timer); }, [notice]);
 const live = visible ? computer : null;
 // Herdr focus is shared with the computer: pin the workspace the first tree resolved, so
 // every later read stays in the project the sheet opened on even if focus moves.
 const [pinned, setPinned] = useState<string | null>(null);
 const rootTree = useProject(live, "tree", attempt === 0 || !pinned ? {} : { workspace: pinned }, attempt);
 useEffect(() => { if (visible && live && rootTree.state === "ok" && !pinned) setPinned(rootTree.value.root.workspace); }, [visible, live, rootTree, pinned]);
 const ws = pinned;
 // The root listing is already loaded for the header; only subfolders need their own read.
 const folder = useProject(live, "tree", ws && tab === "files" && view.kind === "list" && dir ? { path: dir, workspace: ws } : null, attempt);
 const tree = dir ? folder : rootTree;
 const status = useProject(live, "status", ws ? { workspace: ws } : null, attempt);
 const root = rootTree.state === "ok" ? rootTree.value.root : null;
 const changes = status.state === "ok" ? status.value.changes : [];
 const lastCommit = status.state === "ok" ? status.value.lastCommit : null;
 const lastShown = useProject(live, "show", ws && lastCommit ? { workspace: ws, commit: lastCommit.hash } : null, attempt);
 const lastFiles = status.state === "ok" && lastCommit && lastShown.state === "ok" && lastShown.value.commit.hash === lastCommit.hash ? lastShown.value.files : [];
 const colorNotice = status.state === "loading" || (lastCommit && lastShown.state === "loading") ? p.colorsLoading
  : status.state === "error" || (lastCommit && lastShown.state === "error") ? p.colorsUnavailable
  : (status.state === "ok" && status.value.truncated) || (lastCommit && lastShown.state === "ok" && lastShown.value.truncated) ? p.truncated : null;
 const modeRef = useRef(mode); modeRef.current = mode;
 const grab = useMemo(() => PanResponder.create({
  onStartShouldSetPanResponder: () => true,
  onPanResponderRelease: (_event, gesture) => {
   if (gesture.dy < -40) setMode("full");
   else if (gesture.dy > 60) { if (modeRef.current === "full") setMode("sheet"); else close(); }
  },
 }), [setMode, close]);
 const round = (label: string, icon: ReactNode, action: () => void, selected = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} hitSlop={6} onPress={action} style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: selected ? c.accent : c.surfaceRaised }}>{icon}</Pressable>;
 const icon = (name: keyof typeof Ionicons.glyphMap, color = c.text, size = 20) => <Ionicons name={name} size={size} color={color} />;
 const share = useCallback(async (path: string, size: number, how: "link" | "chat") => {
  if (!computer || !root || busy) return;
  setBusy(true);
  try {
   if (how === "chat") { if (await paste(hostFilePath(root.path, path))) { setNotice(p.sent); close(); } return; }
   const result = await createLinkService(computer).createFromHost(async () => {
    const staged = await projectBrowser.run(computer, "stage-link", { path, ...(ws ? { workspace: ws } : {}) });
    return staged.ok ? { ok: true, staged: staged.value.staged, size } : { ok: false };
   });
   if (!result.ok) { setNotice(result.code === "TAILSCALE_ONLY" ? p.tailscaleOnly : p.linkFailed); return; }
   await clipboard.writeText(result.value.url).catch(() => {}); setNotice(p.linkCreated);
  } finally { setBusy(false); }
 }, [computer, root, busy, paste, close, p, ws]);
 if (!visible) return null;
 const sheetTop = mode === "full" ? top : mode === "split" ? Math.round(height * 0.45) : top + 64;

 function body(): ReactNode {
  if (view.kind === "file") return <FileView x={x} path={view.path} />;
  if (view.kind === "diff") return <DiffView x={x} target={view} />;
  if (view.kind === "commit") return <CommitView x={x} commit={view.commit} />;
  if (tab === "files") return <Files x={x} tree={tree} dir={dir} />;
  if (tab === "changes") return <Changes x={x} status={status} />;
  if (tab === "history") return <History x={x} />;
  return <Branches x={x} />;
 }
 function failure(code: ProjectErrorCode) {
  return <View style={{ margin: 10, padding: 16, borderRadius: 14, backgroundColor: c.surfaceRaised }}>
   <Text accessibilityRole="alert" style={{ color: code === "NOT_GIT" ? c.text : c.danger, fontSize: 15, lineHeight: 21 }}>{p.errors[code]}</Text>
   {code === "PROJECT_FAILED" || code === "NOT_FOUND" ? <Pressable accessibilityRole="button" onPress={() => setAttempt(n => n + 1)} style={{ marginTop: 12, minHeight: 48, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 18, borderRadius: theme.radius.medium, backgroundColor: c.accent }}><Text style={{ color: c.onAccent, fontWeight: "700" }}>{p.retry}</Text></Pressable> : null}
  </View>;
 }
 function loading() { return <View style={{ padding: 16, flexDirection: "row", gap: 10, alignItems: "center" }}><ActivityIndicator color={c.textMuted} /><Text accessibilityLiveRegion="polite" style={{ color: c.textMuted }}>{p.loading(root?.name ?? computer?.name ?? "")}</Text></View>; }
 function header(title: string, subtitle: string, splitButton: boolean) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
   {round(p.back, icon("chevron-back"), () => setView({ kind: "list" }))}
   <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: c.text, fontFamily: theme.font.mono, fontSize: 15 }}>{title}</Text><Text numberOfLines={1} style={{ color: c.textMuted, fontSize: 12 }}>{subtitle}</Text></View>
   <Text style={{ color: c.textMuted, fontSize: 11, fontWeight: "600", borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>{p.readOnly}</Text>
   {splitButton ? round(mode === "split" ? p.unsplit : p.split, <Text style={{ color: mode === "split" ? c.onAccent : c.text, fontSize: 18 }}>⬓</Text>, () => setMode(mode === "split" ? "sheet" : "split"), mode === "split") : null}
  </View>;
 }
 function shareBar(path: string, size: number) {
  const action = (label: string, hint: string, glyph: keyof typeof Ionicons.glyphMap, primary: boolean, run: () => void) => <Pressable accessibilityRole="button" accessibilityLabel={`${label}. ${hint}`} disabled={busy} onPress={run} style={{ flex: 1, height: 40, borderRadius: 20, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: primary ? c.accent : c.surfaceRaised, opacity: busy ? 0.6 : 1 }}>{icon(glyph, primary ? c.onAccent : c.text, 16)}<Text style={{ color: primary ? c.onAccent : c.text, fontSize: 13, fontWeight: "600" }}>{label}</Text></Pressable>;
  return <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
   {/* A ZeroTier computer serves no links (zerotier S3): the hint says so and the core refuses. */}
   {action(p.createLink, computer && !hasTailscaleFeatures(computer) ? p.tailscaleOnly : p.createLinkHint, "link-outline", false, () => void share(path, size, "link"))}
   {action(p.sendChat, p.sendChatHint, "chatbubble-outline", true, () => void share(path, size, "chat"))}
  </View>;
 }




 function changeRow(change: Change, onPress: () => void) {
  const tone = change.status === "A" || change.status === "?" ? c.done : change.status === "D" ? c.danger : c.attention;
  const folder = change.path.split("/").slice(0, -1).join("/");
  return <Pressable key={change.path} accessibilityRole="button" accessibilityLabel={`${p.status[change.status]} ${change.path}${change.added !== null ? `, +${change.added} −${change.removed}` : ""}`} onPress={onPress} style={({ pressed }) => ({ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, borderRadius: theme.radius.medium, backgroundColor: pressed ? c.surfaceRaised : "transparent" })}>
   <Text style={{ width: 22, textAlign: "center", borderRadius: 6, overflow: "hidden", color: tone, backgroundColor: c.surfaceRaised, fontFamily: theme.font.mono, fontWeight: "700", fontSize: 12, paddingVertical: 2 }}>{change.status}</Text>
   <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: c.text, fontFamily: theme.font.mono, fontSize: 13 }}>{change.path.split("/").at(-1)}</Text>{folder ? <Text numberOfLines={1} style={{ color: c.textMuted, fontFamily: theme.font.mono, fontSize: 11 }}>{folder}</Text> : null}</View>
   {change.added !== null ? <Text style={{ fontFamily: theme.font.mono, fontSize: 12 }}><Text style={{ color: c.done }}>+{change.added}</Text> <Text style={{ color: c.danger }}>−{change.removed}</Text></Text> : null}
   <Text accessible={false} style={{ color: c.textMuted }}>›</Text>
  </Pressable>;
 }




 const x: Ctx = { c, theme, p, live, attempt, ws, root, changes, lastFiles, colorNotice, mode, setView, setDir, icon, header, failure, loading, shareBar, changeRow };
 const tabs: [Tab, string, keyof typeof Ionicons.glyphMap][] = [["files", p.files, "folder-outline"], ["changes", p.changes, "document-text-outline"], ["history", p.history, "time-outline"], ["branches", p.branches, "git-branch-outline"]];
 return <>
  {mode === "split" ? null : <Pressable accessibilityRole="button" accessibilityLabel={p.close} onPress={close} style={{ position: "absolute", inset: 0, backgroundColor: "rgba(13,14,20,0.62)" }} />}
  <View accessibilityViewIsModal={mode !== "split"} style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: sheetTop, backgroundColor: c.surface, borderTopLeftRadius: mode === "full" ? 0 : 24, borderTopRightRadius: mode === "full" ? 0 : 24, borderTopWidth: 1, borderColor: c.border }}>
   <View {...grab.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel={mode === "full" ? p.grabHintFull : p.grabHint} accessibilityActions={[{ name: "increment" }, { name: "decrement" }]} onAccessibilityAction={event => event.nativeEvent.actionName === "increment" ? setMode("full") : mode === "full" ? setMode("sheet") : close()} style={{ alignItems: "center", paddingTop: 8, paddingBottom: 4, gap: 3 }}>
    <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: c.border }} />
    <Text style={{ color: c.textMuted, fontSize: 11 }}>{mode === "full" ? p.grabHintFull : p.grabHint}</Text>
   </View>
   <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingBottom: 6 }}>
    {icon("git-network-outline", c.text, 22)}
    <Text numberOfLines={1} style={{ flex: 1, color: c.text, fontSize: 20, fontWeight: "700" }}>{root?.name ?? computer?.name ?? ""}</Text>
    {root?.branch ? <View style={{ flexDirection: "row", alignItems: "center", gap: 4, maxWidth: 160 }}>{icon("git-branch-outline", c.textMuted, 14)}<Text numberOfLines={1} ellipsizeMode="middle" style={{ flexShrink: 1, color: c.textMuted, fontFamily: theme.font.mono, fontSize: 12 }}>{root.branch}</Text></View> : null}
    {round(p.close, icon("close"), close)}
   </View>
   <View style={{ flex: 1, paddingHorizontal: view.kind === "list" ? 8 : 0 }}>{rootTree.state === "error" && view.kind === "list" && tab === "files" ? failure(rootTree.code) : body()}</View>
   {notice ? <Text accessibilityLiveRegion="polite" style={{ color: c.text, backgroundColor: c.surfaceRaised, marginHorizontal: 12, marginBottom: 6, padding: 10, borderRadius: 10 }}>{notice}</Text> : null}
   <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: 6, marginHorizontal: 12, marginTop: 6, marginBottom: 12, padding: 6, borderRadius: 30, borderWidth: 1, borderColor: c.border, backgroundColor: c.background }}>
    {tabs.map(([id, label, glyph]) => { const on = tab === id && view.kind === "list" || tab === id;
     return <Pressable key={id} accessibilityRole="tab" accessibilityLabel={id === "changes" && changes.length ? `${label}, ${changes.length}` : label} accessibilityState={{ selected: tab === id }} onPress={() => { setTab(id); setView({ kind: "list" }); }} style={{ flex: 1, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", gap: 2, backgroundColor: on ? c.surfaceRaised : "transparent" }}>
      {icon(glyph, on ? c.text : c.textMuted, 20)}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Text style={{ color: on ? c.text : c.textMuted, fontSize: 11, fontWeight: "600" }}>{label}</Text>{id === "changes" && changes.length ? <Text style={{ minWidth: 18, textAlign: "center", borderRadius: 9, overflow: "hidden", backgroundColor: c.attention, color: c.onAccent, fontSize: 11, fontWeight: "700", paddingHorizontal: 4 }}>{changes.length}</Text> : null}</View>
     </Pressable>; })}
   </View>
  </View>
 </>;
}
