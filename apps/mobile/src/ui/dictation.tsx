import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useReducer, useRef, useState } from "react";
import { AppState, Modal, Pressable, Text, View } from "react-native";
import { DICTATION_MODEL, DictationRunner, formatElapsed, type DictationState } from "../core/dictation";
import { dictation } from "../services";
import { usePreferences } from "./preferences";

// design/voice-dictation/04-como-moshi.html: a line mic icon next to send (chats) or in the key
// bar (terminal). Hold to talk, double tap to lock, release or stop to transcribe on the phone.
export type Dictation = ReturnType<typeof useDictation>;
export function useDictation(onText: (text: string) => void) {
 const deliver = useRef(onText); deliver.current = onText;
 const [runner, setRunner] = useState<DictationRunner | null>(null);
 const [, render] = useReducer((n: number) => n + 1, 0);
 // One runner per mounted mic (core DictationRunner); leaving the foreground drops a recording,
 // unmounting disposes it (a start-up in flight and late results included).
 useEffect(() => {
  const current = new DictationRunner(dictation, text => deliver.current(text));
  const off = current.subscribe(render); setRunner(current);
  void dictation.warm();
  const activity = AppState.addEventListener("change", value => { if (value !== "active") current.dispatch({ type: "abort", now: Date.now() }); });
  return () => { off(); activity.remove(); current.dispose(); };
 }, []);
 const state = runner?.state ?? IDLE;
 const notice = (state.phase === "idle" && state.hint) || runner?.error || runner?.took !== null && runner?.took !== undefined;
 useEffect(() => {
  if (!runner || !notice) return;
  const timer = setTimeout(() => runner.clearNotice(), runner.error === "ENGINE_FAILED" ? 8000 : 3000);
  return () => clearTimeout(timer);
 }, [runner, notice, state]);
 return {
  state, error: runner?.error ?? null, needsModel: runner?.needsModel ?? false, step: runner?.step ?? null, stalled: runner?.stalled ?? null, took: runner?.took ?? null,
  elapsed: runner?.elapsed ?? 0,
  closeModel: () => runner?.closeModel(),
  pressIn: () => runner?.dispatch({ type: "pressIn", now: Date.now() }),
  pressOut: () => runner?.dispatch({ type: "pressOut", now: Date.now() }),
 };
}
const IDLE: DictationState = { phase: "idle" };

/** The mic: a plain line icon (chat) or a key-sized round key (terminal bar). */
export function DictationMic({ d, variant = "icon", disabled = false }: { d: Dictation; variant?: "icon" | "key"; disabled?: boolean }) {
 const { theme, t: { dictation: s } } = usePreferences(); const c = theme.colors;
 const recording = d.state.phase === "holding" || d.state.phase === "tapped" || d.state.phase === "locked";
 const locked = d.state.phase === "locked";
 const busy = d.state.phase === "transcribing";
 const size = variant === "key" ? 44 : 44;
 return <Pressable accessibilityRole="button" accessibilityLabel={locked ? s.stop : s.mic} accessibilityHint={s.micHint} accessibilityState={{ disabled: disabled || busy, selected: recording }}
  disabled={disabled || busy} onPressIn={d.pressIn} onPressOut={d.pressOut} hitSlop={4}
  style={{ width: variant === "key" ? undefined : size, minWidth: variant === "key" ? 24 : size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", alignSelf: variant === "key" ? "stretch" : "auto",
   backgroundColor: recording ? c.danger : variant === "key" ? c.surfaceRaised : "transparent", opacity: disabled || busy ? 0.4 : 1 }}>
  <Ionicons name={locked ? "stop" : recording ? "mic" : "mic-outline"} size={variant === "key" ? 20 : 24} color={recording ? c.onAccent : c.text} />
 </Pressable>;
}

/** What the mic is doing, in place of the draft line (chat) or above the key bar (terminal). */
export function DictationStatus({ d, terminal = false }: { d: Dictation; terminal?: boolean }) {
 const { theme, t: { dictation: s } } = usePreferences(); const c = theme.colors;
 const phase = d.state.phase;
 const line = (color: string, text: string, time?: string, dot = false) => <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 }}>
  {dot ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.danger }} /> : null}
  <Text style={{ flex: 1, color, fontFamily: theme.font.mono, fontSize: 14 }}>{text}</Text>
  {time ? <Text style={{ color, fontFamily: theme.font.mono, fontSize: 13 }}>{time}</Text> : null}
 </View>;
 if (phase === "holding" || phase === "tapped") return line(c.danger, terminal ? s.listeningTerminal : s.listening, formatElapsed(d.elapsed), true);
 if (phase === "locked") return line(c.danger, s.locked, formatElapsed(d.elapsed), true);
 if (phase === "transcribing") return line(c.working, d.step ? s.steps[d.step.step](d.step.seconds) : s.transcribing);
 if (d.error) return line(c.danger, d.stalled ? s.stalled(s.steps[d.stalled]()) : s.errors[d.error]);
 if (phase === "idle" && d.state.hint) return line(c.textMuted, s.holdHint);
 if (phase === "idle" && d.took !== null) return line(c.textMuted, s.took(d.took));
 return null;
}

/** First use: the voice model is downloaded once and stays on the phone. */
export function DictationModelSheet({ visible, close }: { visible: boolean; close: () => void }) {
 const { theme, t: { dictation: s } } = usePreferences(); const c = theme.colors;
 const [progress, setProgress] = useState<number | null>(null);
 const [failed, setFailed] = useState(false);
 const task = useRef<ReturnType<typeof dictation.download> | null>(null);
 useEffect(() => { if (!visible) { setProgress(null); setFailed(false); } }, [visible]);
 // A download outlives neither the sheet nor the screen that showed it.
 useEffect(() => () => { void task.current?.cancel(); task.current = null; }, []);
 async function download() {
  setFailed(false); setProgress(0);
  task.current = dictation.download((written, total) => setProgress(written / total));
  const result = await task.current.promise; task.current = null;
  if (result.ok) close(); else { setProgress(null); setFailed(true); }
 }
 async function cancel() { await task.current?.cancel(); task.current = null; close(); }
 const mb = (n: number) => Math.round(n / 1e6);
 const model = DICTATION_MODEL;
 const button = (label: string, action: () => void, primary: boolean) => <Pressable accessibilityRole="button" onPress={action} style={{ minHeight: theme.touch, borderRadius: theme.radius.medium, alignItems: "center", justifyContent: "center", marginTop: theme.spacing(2), backgroundColor: primary ? c.accent : c.surfaceRaised }}><Text style={{ color: primary ? c.onAccent : c.text, fontWeight: "700" }}>{label}</Text></Pressable>;
 return <Modal visible={visible} transparent animationType="slide" onRequestClose={() => void cancel()}>
  <Pressable accessibilityLabel={s.cancel} onPress={() => void cancel()} style={{ flex: 1, backgroundColor: "rgba(13,14,20,0.62)" }} />
  <View accessibilityViewIsModal style={{ backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: c.border, padding: theme.spacing(4), paddingBottom: theme.spacing(6) }}>
   <Text accessibilityRole="header" style={{ color: c.text, fontSize: 19, fontWeight: "700", marginBottom: theme.spacing(2) }}>{s.setupTitle}</Text>
   <Text style={{ color: c.textMuted, fontSize: 14, lineHeight: 21 }}>{s.setupBody(mb(model.bytes))}</Text>
   {progress !== null ? <>
    <View style={{ height: 8, borderRadius: 4, backgroundColor: c.surfaceRaised, overflow: "hidden", marginTop: theme.spacing(3) }}><View style={{ height: 8, width: `${Math.round(progress * 100)}%`, backgroundColor: c.accent }} /></View>
    <Text accessibilityLiveRegion="polite" style={{ color: c.textMuted, fontFamily: theme.font.mono, fontSize: 12, marginTop: 6 }}>{s.downloading(mb(progress * model.bytes), mb(model.bytes))}</Text>
   </> : null}
   {failed ? <Text accessibilityRole="alert" style={{ color: c.danger, marginTop: theme.spacing(2) }}>{s.errors.DOWNLOAD_FAILED}</Text> : null}
   {progress === null ? button(s.download(mb(model.bytes)), () => void download(), true) : null}
   {button(s.cancel, () => void cancel(), false)}
  </View>
 </Modal>;
}

/** Whether DictationStatus has something to show (so callers skip an empty row). */
export const dictationVisible = (d: Dictation) => d.state.phase !== "idle" || Boolean(d.error) || Boolean(d.state.hint) || d.took !== null;
