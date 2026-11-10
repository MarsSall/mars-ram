import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, Text, View } from "react-native";
import { clampDpad, clampDpadTab, DPAD_SIZE, DPAD_TAB_HEIGHT, resolveDpadGesture } from "../core/terminal-controls";
import { CUSTOM_HOLD_MS, padSlots, terminalKeyInfo, type KeyId, type TerminalKeyLayout } from "../core/terminal-keys";
import { usePreferences } from "./preferences";
import { customAccessibleName, customButtonOf, keyName, padKeyFace } from "./terminal-key-view";

// Deliberately app-lifetime, not tied to one route or computer.
let remembered = { open: false, y: null as number | null };
/** The 9-slot pad from the saved layout; `act` gets "hold" only from custom buttons with «Enter al final» (S5). */
export function FloatingTerminalPad({ bounds, layout, act, disabled, onOpenChange, open: controlledOpen }: { bounds: { width: number; height: number }; layout: TerminalKeyLayout; act(key: KeyId, gesture: "tap" | "hold"): void; disabled: boolean; onOpenChange?(open: boolean): void; open?: boolean }) {
 const { t, theme } = usePreferences(); const s = t.terminal; const c = theme.colors;
 const [localOpen, setOpen] = useState(remembered.open);
 const open = controlledOpen ?? localOpen;
 const [y, setY] = useState(() => remembered.y ?? Math.max(0, (bounds.height - DPAD_TAB_HEIGHT) / 2));
 const slide = useRef(new Animated.Value(remembered.open ? 0 : DPAD_SIZE + 48)).current;
 const latest = useRef({ open, y, bounds }); latest.current = { open, y: clampDpadTab(y, bounds.height), bounds };
 function changeOpen(value: boolean) { remembered.open = value; latest.current.open = value; setOpen(value); onOpenChange?.(value); }
 useEffect(() => {
  const animation = Animated.timing(slide, { toValue: open ? 0 : DPAD_SIZE + 48, duration: 180, useNativeDriver: true });
  animation.start(); return () => animation.stop();
 }, [open, slide]);
 const start = useRef({ y: 0, distance: 0 });
 const gestures = useMemo(() => {
  const create = (tab: boolean) => PanResponder.create({
   onStartShouldSetPanResponder: () => tab,
   onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
   onPanResponderGrant: () => { start.current = { y: latest.current.y, distance: 0 }; },
   onPanResponderMove: (_, g) => {
    start.current.distance = Math.max(start.current.distance, Math.abs(g.dx), Math.abs(g.dy));
    if (tab && Math.abs(g.dy) > Math.abs(g.dx)) {
     const next = clampDpadTab(start.current.y + g.dy, latest.current.bounds.height);
     remembered.y = next; setY(next);
    }
   },
   onPanResponderRelease: (_, g) => {
    const distance = Math.max(start.current.distance, Math.abs(g.dx), Math.abs(g.dy));
    if (tab || distance > 8) changeOpen(resolveDpadGesture(latest.current.open, { dx: g.dx, dy: g.dy, vx: g.vx, distance }));
   },
   // A cancelled gesture never toggles the panel.
   onPanResponderTerminationRequest: () => false,
  });
  return { tab: create(true), pad: create(false) };
 }, []);
 const top = clampDpadTab(y, bounds.height);
 const padTop = clampDpad({ x: 0, y: top - (DPAD_SIZE - DPAD_TAB_HEIGHT) / 2 }, bounds).y;
 const fits = bounds.width >= DPAD_SIZE + 48 && bounds.height >= DPAD_SIZE + 48;
 // Do not hide toolbar keys if a small viewport cannot display the pad.
 useEffect(() => { onOpenChange?.(open && fits); }, [open, fits, onOpenChange]);
 useEffect(() => () => onOpenChange?.(false), [onOpenChange]);
 const key = (id: KeyId, left: number, keyTop: number) => {
  const info = terminalKeyInfo(layout, id); if (!info) return null;
  const face = padKeyFace(info), custom = customButtonOf(layout, id), hold = custom?.enter === true;
  return <Pressable key={id} accessibilityRole="button" accessibilityLabel={custom ? customAccessibleName(custom, t.terminalKeys) : keyName(info, s)} accessibilityHint={hold ? s.holdToSend : undefined} accessibilityState={{ disabled }} disabled={disabled}
   onPress={() => act(id, "tap")} onLongPress={hold ? () => act(id, "hold") : undefined} delayLongPress={hold ? CUSTOM_HOLD_MS : undefined}
   style={{ position: "absolute", left, top: keyTop, width: theme.touch, height: theme.touch, borderRadius: theme.touch / 2, alignItems: "center", justifyContent: "center", backgroundColor: face.accent ? `${c.accent}bf` : `${c.surfaceRaised}d9`, borderWidth: 1, borderColor: c.border, opacity: disabled ? 0.4 : 1 }}>
   <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ color: face.accent ? c.onAccent : custom ? c.accentText : c.text, fontWeight: "700", fontSize: face.size }}>{face.glyph}</Text>
  </Pressable>;
 };
 return <>
  <Animated.View {...gestures.pad.panHandlers} pointerEvents={open ? "auto" : "none"} accessibilityElementsHidden={!open} importantForAccessibility={open ? "auto" : "no-hide-descendants"} style={{ position: "absolute", right: 48, top: fits ? padTop : 0, width: fits ? DPAD_SIZE : Math.max(0, Math.min(DPAD_SIZE, bounds.width - 48)), height: fits ? DPAD_SIZE : Math.max(0, bounds.height - 48), overflow: "hidden", borderRadius: theme.touch / 2, backgroundColor: "transparent", transform: [{ translateX: slide }] }}>
   {fits ? <>
    {padSlots(layout).map(item => key(item.key, item.x, item.y))}
   </> : <Text accessibilityLiveRegion="polite" style={{ color: c.text, padding: 8 }}>{s.dpadSpace}</Text>}
  </Animated.View>
  <View {...gestures.tab.panHandlers} accessible accessibilityRole="button" accessibilityLabel={open ? s.closeDpad : s.openDpad} accessibilityState={{ expanded: open }} accessibilityActions={[{ name: "activate" }]} onAccessibilityTap={() => changeOpen(!latest.current.open)} onAccessibilityAction={event => { if (event.nativeEvent.actionName === "activate") changeOpen(!latest.current.open); }} style={{ position: "absolute", right: 0, top, width: 48, height: DPAD_TAB_HEIGHT, alignItems: "flex-end" }}>
   <View pointerEvents="none" style={{ width: 20, height: DPAD_TAB_HEIGHT, borderTopLeftRadius: theme.radius.medium, borderBottomLeftRadius: theme.radius.medium, backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.border, opacity: 0.72, alignItems: "center", justifyContent: "center" }}><Text style={{ color: c.text, fontWeight: "700" }}>{open ? "›" : "‹"}</Text></View>
  </View>
 </>;
}
