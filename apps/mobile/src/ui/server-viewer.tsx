import { useEffect, useRef, useState, type ReactNode } from "react";
import { Linking, PanResponder, Pressable, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import type { SavedHost } from "../core/host-catalog";
import { serverNavigation, type Server } from "../core/servers";
import { createServerTunnel } from "../services";
import { usePreferences } from "./preferences";

export type ServerSelection = { computer: SavedHost; server: Server };
/** The terminal stays mounted, including in full-page mode: no lost PTY/output. */
export function ServerViewer({ selection, close, children, topInset = 0 }: { selection: ServerSelection | null; close: () => void; children: ReactNode; topInset?: number }) {
 const { theme, t: { servers: s } } = usePreferences(); const c = theme.colors;
 const [split, setSplit] = useState(false); const [ratio, setRatio] = useState(.55);
 const [height, setHeight] = useState(0);
 const minimum = height > 48 ? Math.min(120 / (height - 48), .4) : .4;
 const boundedRatio = Math.max(minimum, Math.min(1 - minimum, ratio));
 const size = useRef({ height: 0, ratio: .55 }); size.current = { height, ratio: boundedRatio };
 const startRatio = useRef(.55);
 const separator = useRef(PanResponder.create({
  onStartShouldSetPanResponder: () => true,
  onMoveShouldSetPanResponder: () => true,
  onPanResponderGrant: () => { startRatio.current = size.current.ratio; },
  onPanResponderMove: (_event, gesture) => {
   const available = size.current.height - 48;
   if (available <= 0) return;
   const min = Math.min(120 / available, .4);
   setRatio(Math.max(min, Math.min(1 - min, startRatio.current + gesture.dy / available)));
  },
 })).current;
 const [tunnel] = useState(createServerTunnel);
 const [port, setPort] = useState<number | null>(null); const [failed, setFailed] = useState(false);
 const [attempt, setAttempt] = useState(0); const web = useRef<WebView<{}>>(null);
 useEffect(() => {
  setSplit(false);
 }, [selection]);
 useEffect(() => {
  setPort(null); setFailed(false);
  if (!selection) return;
  let alive = true; let opened = false;
  void tunnel.open(selection.computer, selection.server).then(result => {
   if (!alive) return;
   if (result.ok) { opened = true; setPort(result.localPort); } else setFailed(true);
  });
  const timer = setInterval(() => {
   if (alive && opened && !tunnel.connected()) {
    opened = false; setFailed(true); setPort(null);
    void tunnel.close().catch(() => {});
   }
  }, 1000);
  return () => { alive = false; clearInterval(timer); void tunnel.close().catch(() => {}); };
 }, [selection, attempt, tunnel]);
 const control = (label: string, glyph: string, action: () => void, pressed?: boolean) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: pressed }} aria-pressed={pressed} onPress={action} style={{ width: 48, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 24, backgroundColor: pressed ? c.accent : c.surfaceRaised }}><Text style={{ color: pressed ? c.onAccent : c.text, fontSize: 24 }}>{glyph}</Text></Pressable>;
 function navigation(url: string): boolean {
  const decision = port === null ? "block" : serverNavigation(url, port);
  if (decision === "external") void Linking.openURL(url).catch(() => {});
  return decision === "allow";
 }
 return <View style={{ flex: 1, paddingTop: selection ? topInset : 0, backgroundColor: c.surface }}>
  {selection ? <View style={{ flexDirection: "row", alignItems: "center", gap: 4, padding: 4, backgroundColor: c.surface }}>
   {control(s.close, "‹", () => { void tunnel.close().catch(() => {}); close(); })}
   <View style={{ flex: 1, borderRadius: 24, backgroundColor: c.surfaceRaised, padding: 10 }}><Text numberOfLines={1} style={{ color: c.text, fontFamily: theme.font.mono, fontSize: 12 }}>{selection.computer.name}:{selection.server.port} · {selection.server.process ?? s.unknown}</Text></View>
   {control(s.split, "⬓", () => setSplit(value => !value), split)}
   {control(s.reload, "⟳", () => { if (failed) setAttempt(n => n + 1); else web.current?.reload(); })}
  </View> : null}
  <View style={{ flex: 1 }} onLayout={event => setHeight(event.nativeEvent.layout.height)}>
   {selection ? <View style={{ height: split ? Math.max(0, height - 48) * boundedRatio : "100%", backgroundColor: c.background }}>
    {failed ? <Pressable accessibilityRole="button" accessibilityLabel={s.error} onPress={() => setAttempt(n => n + 1)} style={{ flex: 1, minHeight: 48, padding: 16, justifyContent: "center" }}><Text accessibilityRole="alert" style={{ color: c.danger }}>{s.error}</Text></Pressable> : port === null ? <Text accessibilityLiveRegion="polite" style={{ color: c.textMuted, padding: 16 }}>{s.opening}</Text> : <WebView<{}> key={`${port}/${attempt}`} ref={web} source={{ uri: `http://127.0.0.1:${port}/` }} style={{ flex: 1 }}
     incognito javaScriptEnabled domStorageEnabled
     originWhitelist={["*"]} onShouldStartLoadWithRequest={request => navigation(request.url)}
     onOpenWindow={event => { if (serverNavigation(event.nativeEvent.targetUrl, port) === "external") void Linking.openURL(event.nativeEvent.targetUrl).catch(() => {}); }}
     javaScriptCanOpenWindowsAutomatically={false} setSupportMultipleWindows
     // react-native-webview 14's Android manager fixes allowContentAccess=false (no JS prop).
     allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
     mixedContentMode="never" geolocationEnabled={false} thirdPartyCookiesEnabled={false} sharedCookiesEnabled={false}
     mediaPlaybackRequiresUserAction allowsInlineMediaPlayback={false}
     onError={() => setFailed(true)} onRenderProcessGone={() => setFailed(true)} onContentProcessDidTerminate={() => setFailed(true)} />}
   </View> : null}
   {selection && split ? <View {...separator.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel={s.resize} accessibilityActions={[{ name: "increment" }, { name: "decrement" }]} onAccessibilityAction={event => setRatio(value => Math.max(minimum, Math.min(1 - minimum, value + (event.nativeEvent.actionName === "increment" ? .1 : -.1))))} style={{ height: 48, justifyContent: "center", alignItems: "center", backgroundColor: c.surface }}><View style={{ width: 48, height: 4, borderRadius: 2, backgroundColor: c.textMuted }} /></View> : null}
   <View style={{ flex: 1, display: selection && !split ? "none" : "flex" }}>{children}</View>
  </View>
  {selection ? <Text style={{ color: c.textMuted, backgroundColor: c.surface, padding: 10, fontSize: 12 }}>{s.tunnel(selection.computer.name)}</Text> : null}
 </View>;
}
