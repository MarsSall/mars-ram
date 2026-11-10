import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Keyboard, KeyboardAvoidingView, PanResponder, Pressable, StatusBar, Text, View, useWindowDimensions } from "react-native";
import { WebView } from "react-native-webview";
import { initialWindowMetrics, useSafeAreaInsets } from "react-native-safe-area-context";
import { terminalHtml } from "../../../../assets/terminal/page";
import type { HerdrState, HerdrTerminal } from "../../../core/herdr-terminal";
import { applyTerminalCtrl, tapTerminalCtrl, decodeWebMessage, encodeTerminalMessage, terminalChromeInsets, type TerminalCtrlState, type TerminalMessage } from "../../../core/terminal-controls";
import { CUSTOM_HOLD_MS, catalogKeyBytes, terminalKeyInfo, type KeyId } from "../../../core/terminal-keys";
import { addAttachment, type Attachment } from "../../../core/attachment-draft";
import type { AttachmentSource } from "../../../core/media-source";
import { catalog, chooseAttachments, clipboard, createHerdrTerminal, herdrSwitcher, sessions, terminalFont, terminalKeys } from "../../../services";
import { AttachmentButton } from "../../../ui/attachment-composer";
import { attachmentError } from "../../../ui/attachment-messages";
import { FloatingTerminalPad } from "../../../ui/floating-terminal-pad";
import { FloatingSessionChat } from "../../../ui/floating-session-chat";
import { ChatHandle } from "../../../ui/chat-handle";
import { usePreferences } from "../../../ui/preferences";
import { customAccessibleName, customButtonOf, customInput, keyName, terminalBarItems } from "../../../ui/terminal-key-view";
import { herdrKeyBytes, parseHerdrKeys, type HerdrKeys } from "../../../core/herdr-keys";

import { fullChatMetadata } from "../../../core/pane-chat";
import { usePaneChat } from "../../../ui/use-pane-chat";
import { useLiveSession } from "../../../ui/use-live-session";
import { terminalActivityStatus } from "../../../ui/terminal-status";
import { TerminalActivity } from "../../../ui/terminal-activity";
import { HerdrSwitcherDrawer } from "../../../ui/herdr-switcher";
import { ServerViewer, type ServerSelection } from "../../../ui/server-viewer";
import { ProjectSheet, type SheetMode } from "../../../ui/project-sheet";
import { terminalDictation } from "../../../core/dictation";
import { DictationMic, DictationModelSheet, DictationStatus, dictationVisible, useDictation } from "../../../ui/dictation";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

const page = { html: terminalHtml, baseUrl: "about:blank" };
export default function TerminalScreen() {
 const router = useRouter();
 const params = useLocalSearchParams<{ id: string; standalone?: string; project?: string; cwd?: string; computer?: string; focusWorkspace?: string; focusTab?: string }>();
 const { id } = params;
 const { theme, t } = usePreferences(); const s = t.terminal; const c = theme.colors;
 const insets = useSafeAreaInsets();
 const window = useWindowDimensions();
 // 5.10.1 includes displayCutout on Android 30+ even with statusBars hidden.
 // Retain pre-hide metrics too; key by orientation so rotation cannot reuse
 // a portrait top inset as a landscape inset. Never cache the IME as bottom.
 const orientation = window.width > window.height ? "landscape" : "portrait";
 const initial = initialWindowMetrics;
 const initialMatches = initial && (initial.frame.width > initial.frame.height ? "landscape" : "portrait") === orientation;
 const safe = useRef<Record<string, { top: number; bottom: number }>>({});
 const previous = safe.current[orientation];
 const stableInsets = {
  top: Math.max(insets.top, previous?.top ?? 0, initialMatches ? initial.insets.top : 0),
  bottom: Math.max(insets.bottom, previous?.bottom ?? 0, initialMatches ? initial.insets.bottom : 0),
 };
 safe.current[orientation] = stableInsets;
 const routeSessionKey = params.standalone === "1" ? undefined : id;
 const hostId = params.standalone === "1" ? id : id.split("/")[0];
 const { sessionKey, session: chatSession, refresh: refreshPaneChat } = usePaneChat(hostId, routeSessionKey);
 const live = useLiveSession(sessionKey);
 const web = useRef<WebView<{}>>(null); const focused = useRef(true);
 const [terminal, setTerminal] = useState<HerdrTerminal | null>(null);
 const [state, setState] = useState<HerdrState>({ status: "connecting" });
 const [ready, setReady] = useState(false); const [pageFailed, setPageFailed] = useState(false); const [attempt, setAttempt] = useState(0);
 // One stored size for every terminal; Settings changes reach an open terminal live.
 const [fontSize, setFontSize] = useState(terminalFont.get); const font = useRef(fontSize); font.current = fontSize;
 useEffect(() => { setFontSize(terminalFont.get()); return terminalFont.subscribe(setFontSize); }, []);
 // One saved bar + D-pad layout for every computer; «Guardar» in Settings reaches an open terminal live.
 const [keys, setKeys] = useState(terminalKeys.get);
 useEffect(() => { setKeys(terminalKeys.get()); return terminalKeys.subscribe(setKeys); }, []);
 const [bounds, setBounds] = useState({ width: 0, height: 0 });
 const [ctrlState, setCtrlState] = useState<TerminalCtrlState>({ mode: "off", tappedAt: null }); const ctrl = useRef(ctrlState);
 const [computerName, setComputerName] = useState(params.computer ?? s.title);
 const [herdrKeys, setHerdrKeys] = useState<HerdrKeys>(parseHerdrKeys(null));
 const [keysReady, setKeysReady] = useState(false);
 const [prefixPanel, setPrefixPanel] = useState(false); const [prefixWaiting, setPrefixWaiting] = useState(false);
 const [prefixNotice, setPrefixNotice] = useState(false); const prefixLongPress = useRef(false);
 const [holdHint, setHoldHint] = useState(false);
 const [padOpen, setPadOpen] = useState(false);
 const [switcherOpen, setSwitcherOpen] = useState(false);
 const [serverSelection, setServerSelection] = useState<ServerSelection | null>(null);
 const [project, setProject] = useState<SheetMode | null>(null);
 // Dictation types at the prompt as one bracketed paste, never Enter (voice-dictation 04).
 const dictating = useDictation(text => { void write(terminalDictation(text)); });
 const switcherActive = useRef(false);
 const blurTerminal = useCallback(() => {
  web.current?.postMessage(encodeTerminalMessage({ type: "blur" }));
  Keyboard.dismiss();
 }, []);
 const openSwitcher = useCallback(() => {
  switcherActive.current = true;
  blurTerminal(); setSwitcherOpen(true);
 }, [blurTerminal]);
 const closeSwitcher = useCallback(() => {
  // Do not restore WebView input focus when the modal releases its window.
  blurTerminal(); setSwitcherOpen(false); switcherActive.current = false;
 }, [blurTerminal]);
 const edgeSwipe = useRef(PanResponder.create({
  onMoveShouldSetPanResponder: (_event, gesture) => gesture.dx > 24 && Math.abs(gesture.dy) < 24,
  onPanResponderRelease: (_event, gesture) => { if (gesture.dx > 40) openSwitcher(); },
 })).current;
 const [chatOpen, setChatOpen] = useState(false);
 useEffect(() => { if (!sessionKey) setChatOpen(false); }, [sessionKey]);
 function fullChat() { if (!sessionKey) return; blurTerminal(); setChatOpen(false); router.push({ pathname: "/session/[id]", params: { id: sessionKey, chat: "1", fromTerminal: "1", computer: computerName, ...fullChatMetadata(sessionKey, routeSessionKey, chatSession, params) } }); }
 const mode = useRef(false); const [keyboard, setKeyboard] = useState(() => Keyboard.isVisible());
 const busy = useRef(false); const [sending, setSending] = useState(false);
 const [progress, setProgress] = useState<[number, number] | null>(null);
 const [error, setError] = useState<string | null>(null); const [detail, setDetail] = useState<string | null>(null);
 const [details, setDetails] = useState(false); const [selection, setSelection] = useState("");
 const sendPage = useCallback((message: TerminalMessage) => { if (message.type === "focus" && switcherActive.current) return; if (message.type === "focus") web.current?.requestFocus(); web.current?.postMessage(encodeTerminalMessage(message)); }, []);
 function updateCtrl(value: TerminalCtrlState) { ctrl.current = value; setCtrlState(value); }
 useFocusEffect(useCallback(() => {
  const entry = StatusBar.pushStackEntry({ hidden: true });
  return () => StatusBar.popStackEntry(entry);
 }, []));
 useEffect(() => {
  if (!terminal || state.status !== "open") { setKeysReady(false); return; }
  let alive = true;
  void terminal.keys().then(keys => { if (alive) { setHerdrKeys(keys); setKeysReady(true); } });
  return () => { alive = false; };
 }, [terminal, state.status]);
 useEffect(() => {
  if (!prefixNotice) return;
  const timer = setTimeout(() => setPrefixNotice(false), 3000);
  return () => clearTimeout(timer);
 }, [prefixNotice]);
 useEffect(() => {
  if (!holdHint) return;
  const timer = setTimeout(() => setHoldHint(false), 2000);
  return () => clearTimeout(timer);
 }, [holdHint]);

 useEffect(() => {
  let alive = true; let current: HerdrTerminal | null = null; let unsubscribe: (() => void) | undefined;
  setTerminal(null); setState({ status: "connecting" }); setError(null); mode.current = false;
  void catalog.list().then(hosts => {
   if (!alive) return;
   const computer = hosts.find(host => host.id === hostId);
   if (!computer) { setState({ status: "closed", reason: s.missingComputer }); return; }
   setComputerName(computer.name);
   current = createHerdrTerminal(computer, { cols: 80, rows: 24, sessionKey: routeSessionKey });
   current.setActive(focused.current && AppState.currentState === "active");
   unsubscribe = current.subscribe(setState); setTerminal(current);
  }).catch(() => { if (alive) setState({ status: "closed", reason: s.error }); });
  return () => { alive = false; unsubscribe?.(); void current?.close(); };
 }, [hostId, routeSessionKey, attempt, s.missingComputer, s.error]);

 // Each visible/ready emulator owns output. Subscribe before the first PTY open;
 // later attachments reset the page and ask the core for a debounced full redraw.
 useFocusEffect(useCallback(() => {
  focused.current = true;
  let off: (() => void) | undefined;
  const activate = (active: boolean) => {
   terminal?.setActive(active);
   if (!active) { off?.(); off = undefined; updateCtrl({ mode: "off", tappedAt: null }); setPrefixWaiting(false); setPrefixPanel(false); return; }
   if (!terminal || !ready || off) return;
   off = terminal.subscribeOutput(bytes => {
    for (let i = 0; i < bytes.length; i += 32768) sendPage({ type: "output", bytes: bytes.slice(i, i + 32768) });
   }, () => { mode.current = false; setSelection(""); sendPage({ type: "reset" }); });
   sendPage({ type: "fontSize", value: font.current }); sendPage({ type: "fit" });
   void terminal.open();
  };
  activate(AppState.currentState === "active");
  const activity = AppState.addEventListener("change", value => activate(value === "active"));
  return () => { focused.current = false; activate(false); activity.remove(); };
 }, [terminal, ready, sendPage]));
 useFocusEffect(useCallback(() => {
  setKeyboard(Keyboard.isVisible());
  const active = AppState.addEventListener("change", value => { if (value === "active") setKeyboard(Keyboard.isVisible()); });
  const show = Keyboard.addListener("keyboardDidShow", () => setKeyboard(true));
  const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboard(false));
  return () => { show.remove(); hide.remove(); active.remove(); };
 }, []));
 useEffect(() => { if (ready) sendPage({ type: "fontSize", value: fontSize }); }, [ready, fontSize, sendPage]);

 const pendingFocus = useRef<string | null>(null);
 useEffect(() => {
  if (state.status !== "open" || !params.focusWorkspace) return;
  const target = `${hostId}/${params.focusWorkspace}/${params.focusTab ?? ""}`;
  if (pendingFocus.current === target) return;
  pendingFocus.current = target;
  let alive = true;
  void catalog.list().then(async hosts => {
   const computer = hosts.find(h => h.id === hostId);
   const result = computer ? await herdrSwitcher.focus(computer, params.focusWorkspace!, params.focusTab) : { ok: false as const, code: "HERDR_FAILED" as const };
   if (!result.ok && alive) { setError(t.switcher[result.code]); pendingFocus.current = null; }
  }).catch(() => { if (alive) { setError(t.switcher.HERDR_FAILED); pendingFocus.current = null; } });
  return () => { alive = false; };
 }, [state.status, hostId, params.focusWorkspace, params.focusTab, t.switcher]);
 const open = state.status === "open" && ready;
 async function write(bytes: Uint8Array) {
  if (!terminal || !open) return false;
  setPrefixWaiting(false);
  const result = await terminal.write(bytes);
  if (!result.ok) { setError(s.keyFailed); setDetail(result.message); }
  return result.ok;
 }
 function input(bytes: Uint8Array) { const next = applyTerminalCtrl(ctrl.current, bytes); updateCtrl(next.state); void write(next.bytes); }
 // Catalog keys go through Ctrl like typed input, in the page's cursor mode; agent keys use this computer's Herdr binding.
 // A custom button with «Ignorar Ctrl» sends its text as written and leaves Ctrl for the next key.
 function act(id: KeyId, gesture: "tap" | "hold") {
  const custom = customButtonOf(keys, id);
  if (custom) { const result = customInput(custom, gesture, ctrl.current); updateCtrl(result.ctrl); if (result.bytes) void write(result.bytes); else if (result.hint) setHoldHint(true); return; }
  const info = terminalKeyInfo(keys, id);
  if (!info?.send) return;
  const bytes = catalogKeyBytes(info, { cursorMode: mode.current, herdr: herdrKeys });
  if ("binding" in info.send) { if (!keysReady) return; if (bytes) void write(bytes); else setError(herdrKeys[info.send.binding] ? s.bindingUnavailable : s.notConfigured); return; }
  if (bytes) input(bytes);
 }
 async function sendPrefix() {
  const bytes = herdrKeyBytes(herdrKeys.prefix);
  if (!bytes) return;
  setPrefixPanel(false); setChatOpen(false);
  if (await write(bytes)) { setPrefixWaiting(true); setPrefixNotice(true); sendPage({ type: "focus" }); }
 }
 async function pasteClipboard() {
  if (!open || busy.current) return;
  try { const text = await clipboard.readText(); if (text) await write(new TextEncoder().encode(`\x1b[200~${text}\x1b[201~`)); }
  catch { setError(s.pasteFailed); }
 }
 async function attach(source: AttachmentSource) {
  if (!terminal || !open || busy.current) return;
  busy.current = true; setSending(true); setError(null); setDetail(null); setProgress(null);
  try {
   const chosen = await chooseAttachments(source);
   if (!chosen.ok) { setError(t.attachments[chosen.reason]); return; }
   let items: readonly Attachment[] = [];
   for (const item of chosen.items) {
    const added = addAttachment(items, item);
    if (!added.ok) { setError(attachmentError(added.message, t.attachments)); return; }
    items = added.items;
   }
   const result = await terminal.pasteAttachmentPaths(items, (n, total) => setProgress(n ? [n, total] : null));
   if (!result.ok) { setError(attachmentError(result.message, t.attachments)); setDetail(result.message); }
  } catch { setError(t.attachments.sourceFailed); }
  finally { busy.current = false; setSending(false); setProgress(null); }
 }
 // `icon` replaces the text with a line icon (no emoji in the chrome, voice-dictation L7).
 const button = (label: string, action: () => void, text = label, disabled = false, selected = false, expanded?: boolean, compact = false, icon?: ReactNode) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected, expanded }} disabled={disabled} onPress={action} hitSlop={{ top: compact ? 2 : 9, bottom: compact ? 2 : 9, left: compact ? 0 : 7, right: compact ? 0 : 7 }} style={{ height: compact ? 44 : 30, minWidth: compact ? 0 : 34, width: compact ? "100%" : undefined, paddingHorizontal: compact ? 1 : 6, alignItems: "center", justifyContent: "center", borderRadius: compact ? 22 : theme.radius.small, backgroundColor: selected && !(text === "Ctrl" && ctrlState.mode === "armed") ? c.accent : compact ? c.surfaceRaised : "transparent", opacity: disabled ? 0.4 : 1, borderBottomWidth: selected ? 2 : 0, borderColor: c.accentText }}>{icon ?? <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ color: selected ? text === "Ctrl" && ctrlState.mode === "armed" ? c.accent : c.onAccent : c.text, fontSize: text.length <= 2 ? 18 : compact ? 11 : 12, fontFamily: theme.font.mono, fontWeight: "600" }}>{text}</Text>}</Pressable>;
 const key = (name: KeyId, label: string, text = label, waiting = false) => button(label, () => act(name, "tap"), text, !open || sending || waiting, false, undefined, true);
 // S5: a button with «Enter al final» sends only after CUSTOM_HOLD_MS; its tap shows s.holdToSend.
 const customKey = (id: KeyId) => {
  const custom = customButtonOf(keys, id); if (!custom) return null;
  const disabled = !open || sending;
  return <Pressable accessibilityRole="button" accessibilityLabel={customAccessibleName(custom, t.terminalKeys)} accessibilityHint={custom.enter ? s.holdToSend : undefined} accessibilityState={{ disabled }} disabled={disabled} hitSlop={{ top: 2, bottom: 2 }}
   onPress={() => act(id, "tap")} onLongPress={custom.enter ? () => act(id, "hold") : undefined} delayLongPress={CUSTOM_HOLD_MS}
   style={{ height: 44, width: "100%", paddingHorizontal: 1, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: c.surfaceRaised, opacity: disabled ? 0.4 : 1 }}>
   <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ color: c.accentText, fontFamily: theme.font.mono, fontWeight: "700", fontSize: 11 }}>{custom.name}</Text>
  </Pressable>;
 };
 function reconnect() { sessions.allowUnlockAgain(); if (!ready) web.current?.reload(); setAttempt(n => n + 1); }
 const reason = state.status === "closed" || state.status === "unlock-required" ? state.reason : null;
 const status = pageFailed ? s.error : state.status === "open" ? null : state.status === "connecting" ? s.connecting : state.status === "reconnecting" ? s.reconnecting : state.status === "unlock-required" ? t.sessions.locked : reason === "Herdr se cerró" ? s.normalExit : s.closed;

 const activityStatus = terminalActivityStatus(Boolean(sessionKey) && open && !pageFailed, live.view, s.activity);

 const chrome = terminalChromeInsets(stableInsets, keyboard);
 return <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.terminalBackground }}>
 <View style={{ flex: 1, paddingLeft: insets.left, paddingRight: insets.right, paddingBottom: chrome.bottom }}>
 <ServerViewer topInset={stableInsets.top} selection={serverSelection} close={() => setServerSelection(null)}>
  <View style={{ height: chrome.stripHeight, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, backgroundColor: c.terminalBackground }}>
   <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", overflow: "hidden" }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${computerName} · ${s.switchSession}`} accessibilityState={{ expanded: switcherOpen }} onPressIn={openSwitcher} onPress={event => { event.stopPropagation(); openSwitcher(); }} onResponderTerminationRequest={() => false} style={{ flex: 1, minWidth: 0, height: chrome.stripHeight, flexDirection: "row", alignItems: "center" }}>
     <Text numberOfLines={1} ellipsizeMode="tail" style={{ flexShrink: 1, color: c.text, fontSize: 15, fontFamily: theme.font.mono }}>{computerName}</Text><Text accessible={false} style={{ color: c.textMuted, fontSize: 12 }}> ▾</Text>
    </Pressable>
   </View>
   <View pointerEvents="none" style={{ width: chrome.cameraGap }} />
   <View style={{ flex: 1, minWidth: 0, overflow: "hidden", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
   <View style={{ flexShrink: 1, minWidth: 0, backgroundColor: c.surfaceRaised, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 6 }}>
    {activityStatus ? <TerminalActivity status={activityStatus} color={c[activityStatus.kind]} /> : <Text accessibilityLiveRegion="polite" numberOfLines={1} ellipsizeMode="tail" style={{ color: open ? c.textMuted : c.attention, fontSize: 11 }}>{open ? "● " : state.status === "connecting" || state.status === "reconnecting" ? "◌ " : "× "}{status ?? (open ? s.connected : s.connecting)}</Text>}
   </View>
   <Pressable accessibilityRole="button" accessibilityLabel={t.project.open} accessibilityState={{ expanded: project !== null }} hitSlop={6} onPress={() => { blurTerminal(); setProject("sheet"); }} style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: c.attention }}>
    <Ionicons name="git-branch-outline" size={20} color={c.onAccent} />
   </Pressable>
   </View>
  </View>
  <View style={{ flex: 1, backgroundColor: c.terminalBackground, overflow: "hidden" }} onLayout={event => { setBounds(event.nativeEvent.layout); sendPage({ type: "fit" }); }}>
   <WebView<{}> ref={web} source={page} pointerEvents={switcherOpen ? "none" : "auto"} focusable={!switcherOpen} style={{ flex: 1, backgroundColor: c.terminalBackground }} javaScriptEnabled
    originWhitelist={["*"]} onShouldStartLoadWithRequest={request => request.url === "about:blank"} onOpenWindow={() => {}}
    allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
    mixedContentMode="never" domStorageEnabled={false} thirdPartyCookiesEnabled={false} sharedCookiesEnabled={false} cacheEnabled={false}
    geolocationEnabled={false} javaScriptCanOpenWindowsAutomatically={false} setSupportMultipleWindows keyboardDisplayRequiresUserAction={false}
    allowsInlineMediaPlayback={false} mediaPlaybackRequiresUserAction
    // Opt-in marker for patches/react-native-webview: Android keyboard without suggestions (text already sent cannot be replaced).
    applicationNameForUserAgent="MarsRamTerminal"
    onError={() => { setReady(false); setPageFailed(true); }}
    onRenderProcessGone={() => { setReady(false); setPageFailed(true); }}
    onContentProcessDidTerminate={() => { setReady(false); setPageFailed(true); }}
    onMessage={event => {
     const message = decodeWebMessage(event.nativeEvent.data); if (!message) return;
     if (message.type === "ready") { setReady(true); setPageFailed(false); mode.current = false; }
     else if (message.type === "input" && !switcherActive.current) input(message.bytes);
     else if (message.type === "size") terminal?.resize(message.cols, message.rows);
     else if (message.type === "cursorMode") mode.current = message.enabled;
     else if (message.type === "selection") setSelection(message.text);
     else if (message.type === "fontSize") void terminalFont.set(message.value).catch(() => { /* Zoom keeps working this session; Settings reports save failures. */ });
    }} />
   {status ? <View style={{ position: "absolute", left: theme.spacing(1), right: theme.spacing(1), top: theme.spacing(1), padding: theme.spacing(2), backgroundColor: c.surfaceRaised, borderRadius: theme.radius.small }}>
    <Text accessibilityLiveRegion="polite" style={{ color: c.attention }}>{status}</Text>
    {pageFailed || state.status === "closed" || state.status === "unlock-required" ? <>
     {reason && reason !== "Herdr se cerró" ? <Text selectable style={{ color: c.text }}>{reason === "HERDR_NOT_FOUND" ? s.herdrNotFound : reason}</Text> : null}
     {button(state.status === "unlock-required" ? s.unlock : s.reconnect, reconnect)}
    </> : null}
   </View> : null}
   {bounds.height > 0 ? <FloatingTerminalPad bounds={bounds} layout={keys} act={act} disabled={!open || sending} open={padOpen} onOpenChange={setPadOpen} /> : null}
   {prefixNotice ? <View style={{ position: "absolute", bottom: 8, left: 8, right: 8, padding: 10, borderRadius: 10, backgroundColor: c.surface }}><Text accessibilityLiveRegion="polite" style={{ color: c.attention }}>{s.prefixSent}</Text></View> : null}
   {holdHint ? <View style={{ position: "absolute", bottom: 8, left: 8, right: 8, padding: 10, borderRadius: 10, backgroundColor: c.surface }}><Text accessibilityLiveRegion="polite" style={{ color: c.attention }}>{s.holdToSend}</Text></View> : null}
  </View>
  {chatOpen && sessionKey ? <FloatingSessionChat key={sessionKey} sessionKey={sessionKey} live={live} expand={fullChat} close={() => { setChatOpen(false); Keyboard.dismiss(); }} /> : null}
  {selection ? <View style={{ flexDirection: "row", gap: 4 }}>{button(s.copy, () => { void clipboard.writeText(selection).then(() => setSelection("")).catch(() => setError(s.keyFailed)); })}{button(s.close, () => setSelection(""), "×")}</View> : null}
  {error ? <Text accessibilityRole="alert" style={{ color: c.danger, paddingHorizontal: 8 }}>{error}</Text> : null}
  {detail ? <View>{button(s.details, () => setDetails(value => !value))}{details ? <Text selectable style={{ color: c.textMuted }}>{detail}</Text> : null}</View> : null}
  {prefixPanel ? <View style={{ padding: 8, backgroundColor: c.surface, borderTopWidth: 1, borderColor: c.border }}>
   <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text accessibilityRole="header" style={{ color: c.textMuted }}>PREFIX</Text>{button(s.close, () => setPrefixPanel(false), "×")}</View>
   <View style={{ flexDirection: "row", gap: 8 }}>
    {(["previous_agent", "next_agent"] as const).map(binding => {
     const spec = herdrKeys[binding]; const bytes = spec ? herdrKeyBytes(spec, herdrKeys.prefix) : null;
     const label = binding === "previous_agent" ? s.previousAgent : s.nextAgent;
     return <View key={binding} style={{ flex: 1 }}>{bytes ? <Pressable accessibilityRole="button" disabled={!open || sending} onPress={() => { void write(bytes); setPrefixPanel(false); }} style={{ minHeight: 48, justifyContent: "center", alignItems: "center", backgroundColor: c.surfaceRaised, borderRadius: 6 }}><Text style={{ color: c.text }}>{label}</Text></Pressable> : <Text style={{ color: c.textMuted, paddingVertical: 8 }}>{label} · {spec ? s.bindingUnavailable : s.notConfigured}</Text>}</View>;
    })}
   </View>
  </View> : null}
  {progress ? <Text accessibilityLiveRegion="polite" style={{ color: c.text }}>{t.attachments.uploading(...progress)}</Text> : null}
  {dictationVisible(dictating) ? <View style={{ marginHorizontal: 10, marginTop: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 18, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}><DictationStatus d={dictating} terminal /></View> : null}
  <View style={{ paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8 }}>
  {sessionKey && !chatOpen ? <View pointerEvents="box-none" style={{ position: "absolute", top: -4, left: 0, right: 0, alignItems: "center", zIndex: 2 }}><ChatHandle state="closed" change={next => { if (next === "full") fullChat(); else if (next === "floating") { blurTerminal(); setChatOpen(true); } }} /></View> : null}
  <View accessibilityLabel={s.toolbar} style={{ flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0, padding: 6, borderWidth: 1, borderRadius: 30, borderColor: c.border, backgroundColor: c.surface }}>
   {terminalBarItems(keys, { keyboard, prefixPanel }).map(({ id: name, info }) => <View key={name} style={{ width: info.width, flexGrow: 1, flexShrink: 1, height: 44, alignItems: "center", justifyContent: "center" }}>
    {name === "attach" ? <>
     <AttachmentButton compact label={s.attach} disabled={!open || sending} busy={sending} select={attach} />
    </> : name === "ctrl" ? <>
     {button(ctrlState.mode === "locked" ? s.ctrlLocked : s.ctrlArmed, () => { updateCtrl(tapTerminalCtrl(ctrl.current, Date.now())); }, "Ctrl", !open, ctrlState.mode !== "off", undefined, true)}
     {ctrlState.mode === "locked" ? <View pointerEvents="none" accessible={false} style={{ position: "absolute", top: 1, right: 1 }}><Ionicons name="lock-closed" size={10} color={c.accentText} /></View> : null}
    </>
     : name === "prefix" ? <Pressable accessibilityRole="button" accessibilityLabel={prefixWaiting ? s.prefixWaiting : "PREFIX"} accessibilityState={{ expanded: prefixPanel, selected: prefixWaiting }} disabled={!open || sending || !keysReady} hitSlop={{ top: 2, bottom: 2 }} onPressIn={() => { prefixLongPress.current = false; }} onLongPress={() => { prefixLongPress.current = true; setChatOpen(false); Keyboard.dismiss(); setPrefixPanel(value => !value); }} onPress={() => { if (!prefixLongPress.current) { if (herdrKeyBytes(herdrKeys.prefix)) void sendPrefix(); else setError(s.bindingUnavailable); } }} style={{ height: 44, width: "100%", paddingHorizontal: 1, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: c.surfaceRaised, borderBottomWidth: prefixWaiting ? 2 : 0, borderColor: c.attention, opacity: open && keysReady ? 1 : 0.4 }}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ color: prefixWaiting ? c.attention : c.text, fontWeight: "700", fontSize: 10 }}>PREFIX</Text></Pressable>
     : name === "dpad" ? button(padOpen ? s.closeDpad : s.openDpad, () => setPadOpen(value => !value), "", false, padOpen, padOpen, true, <Ionicons name="move-outline" size={20} color={padOpen ? c.onAccent : c.text} />)
     : name === "mic" ? <DictationMic d={dictating} variant="key" disabled={!open || sending} />
     : name === "paste" ? button(s.paste, () => void pasteClipboard(), "", !open || sending, false, undefined, true, <Ionicons name="clipboard-outline" size={20} color={c.text} />)
     : name === "keyboard" ? button(keyboard ? s.hideKeyboard : s.showKeyboard, () => { if (keyboard) Keyboard.dismiss(); else { setChatOpen(false); sendPage({ type: "focus" }); } }, "", false, false, undefined, true, <MaterialCommunityIcons name="keyboard-outline" size={21} color={c.text} />)
     : info.kind === "custom" ? customKey(name)
     : key(name, keyName(info, s), info.label, info.send !== null && "binding" in info.send && !keysReady)}
   </View>)}
  </View>
  </View>
 </ServerViewer>
 </View>
 <View {...edgeSwipe.panHandlers} style={{ position: "absolute", left: 0, top: chrome.stripHeight, bottom: 80, width: 18 }} />
 <HerdrSwitcherDrawer visible={switcherOpen} hostId={hostId} close={closeSwitcher} chooseServer={(computer, server) => { blurTerminal(); setServerSelection({ computer, server }); }} choose={async (computer, workspace, tab) => {
  if (computer.id === hostId) {
   const result = await herdrSwitcher.focus(computer, workspace, tab);
   if (result.ok) refreshPaneChat();
   return result;
  }
  router.push({ pathname: "/session/terminal/[id]", params: { id: computer.id, standalone: "1", computer: computer.name, focusWorkspace: workspace, ...(tab ? { focusTab: tab } : {}) } });
  return { ok: true, value: undefined };
 }} />
 <DictationModelSheet visible={dictating.needsModel} close={dictating.closeModel} />
 <ProjectSheet visible={project !== null} hostId={hostId} mode={project ?? "sheet"} setMode={setProject} top={chrome.stripHeight}
  close={() => { blurTerminal(); setProject(null); }}
  paste={async text => { const sent = await write(new TextEncoder().encode(`\x1b[200~${text}\x1b[201~`)); if (sent) sendPage({ type: "focus" }); return sent; }} />
 </KeyboardAvoidingView>;
}
