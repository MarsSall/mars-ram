// Personalizar teclas › size of the hidden key bar's tab and 💬 (key-bar-autohide S9): a free slider like the
// font size, with ± steps, screen reader increment/decrement and a live preview of the two handles.
import { useMemo, useRef } from "react";
import { PanResponder, Pressable, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import { KEY_BAR_HANDLE_SIZE, clampKeyBarHandleSize } from "../core/key-bar-visibility";
import { ChatHandleFace } from "./chat-handle";
import { KeyBarTabFace } from "./key-bar-dock";
import { usePreferences } from "./preferences";

const THUMB = 24;
const TAP_SLOP = 8;

/** A move on the track becomes a drag only when it goes sideways past the slop; vertical moves stay with the page. */
export const isSidewaysDrag = (dx: number, dy: number) => Math.abs(dx) > TAP_SLOP && Math.abs(dx) > Math.abs(dy);
const { min, max } = KEY_BAR_HANDLE_SIZE;

export function KeyBarHandleSizeSlider({ value, onChange }: { value: number; onChange(size: number): void }) {
 const { theme, t } = usePreferences(); const c = theme.colors; const h = t.terminalKeys.handleSize;
 const track = useRef({ width: 0, start: 0 });
 // The track sits inside Ajustes' ScrollView: a touch only becomes a drag once it moves sideways (L10), so a vertical
 // scroll that starts on it keeps scrolling the page; a tap without movement sets the value where it lands.
 const touch = useRef<{ x: number; pageX: number; pageY: number; dragged: boolean } | null>(null);
 const latest = useRef({ onChange }); latest.current.onChange = onChange;
 const at = (x: number) => clampKeyBarHandleSize(min + (track.current.width > 0 ? x / track.current.width : 0) * (max - min));
 const pan = useMemo(() => PanResponder.create({
  onStartShouldSetPanResponder: () => false,
  onMoveShouldSetPanResponder: (_event, gesture) => isSidewaysDrag(gesture.dx, gesture.dy),
  onPanResponderGrant: () => { track.current.start = touch.current?.x ?? 0; if (touch.current) touch.current.dragged = true; },
  onPanResponderMove: (_event, gesture) => latest.current.onChange(at(track.current.start + gesture.dx)),
  onPanResponderTerminationRequest: () => false,
  // `at` only reads refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }), []);
 const tap = {
  onTouchStart: (event: GestureResponderEvent) => { const { locationX, pageX, pageY } = event.nativeEvent; touch.current = { x: locationX, pageX, pageY, dragged: false }; },
  onTouchEnd: (event: GestureResponderEvent) => {
   const start = touch.current; touch.current = null;
   if (start && !start.dragged && Math.abs(event.nativeEvent.pageX - start.pageX) <= TAP_SLOP && Math.abs(event.nativeEvent.pageY - start.pageY) <= TAP_SLOP) latest.current.onChange(at(start.x));
  },
  onTouchCancel: () => { touch.current = null; },
 };
 const step = (by: number) => { const next = clampKeyBarHandleSize(value + by); if (next !== value) onChange(next); };
 const stepButton = (label: string, text: string, by: number) => {
  const disabled = by < 0 ? value <= min : value >= max;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={() => step(by)}
   style={{ minWidth: theme.touch, minHeight: theme.touch, alignItems: "center", justifyContent: "center", borderRadius: theme.touch / 2, backgroundColor: c.surfaceRaised, opacity: disabled ? 0.4 : 1 }}>
   <Text style={{ color: c.text, fontSize: 22, fontWeight: "600" }}>{text}</Text>
  </Pressable>;
 };
 const fraction = (value - min) / (max - min);
 return <View style={{ gap: theme.spacing(2), marginTop: theme.spacing(2) }}>
  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: theme.spacing(2) }}>
   <Text style={{ flex: 1, color: c.text, fontSize: 16 }}>{h.title}</Text>
   <Text accessibilityLiveRegion="polite" style={{ color: c.text, fontSize: 16, fontVariant: ["tabular-nums"] }}>{h.value(value)}</Text>
  </View>
  <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing(2) }}>
   {stepButton(h.smaller, "−", -1)}
   <View {...pan.panHandlers} {...tap} accessible accessibilityRole="adjustable" accessibilityLabel={h.title} accessibilityValue={{ min, max, now: value, text: h.value(value) }}
    accessibilityActions={[{ name: "increment" }, { name: "decrement" }]} onAccessibilityAction={event => step(event.nativeEvent.actionName === "increment" ? 1 : event.nativeEvent.actionName === "decrement" ? -1 : 0)}
    onLayout={(event: LayoutChangeEvent) => { track.current.width = event.nativeEvent.layout.width; }}
    style={{ flex: 1, minHeight: theme.touch, justifyContent: "center" }}>
    <View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: c.surfaceRaised }}>
     <View style={{ width: `${Math.round(fraction * 100)}%`, height: 4, borderRadius: 2, backgroundColor: c.accentText }} />
    </View>
    <View pointerEvents="none" style={{ position: "absolute", left: `${Math.round(fraction * 100)}%`, marginLeft: -THUMB / 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: c.accentText }} />
   </View>
   {stepButton(h.larger, "+", 1)}
  </View>
  <View accessible accessibilityLabel={h.preview} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing(4), minHeight: max + theme.spacing(4), borderRadius: theme.radius.small, backgroundColor: c.terminalBackground }}>
   <ChatHandleFace size={value} />
   <KeyBarTabFace size={value} shown={false} />
  </View>
  <Text style={{ color: c.textMuted, fontSize: 14 }}>{h.hint}</Text>
 </View>;
}
