import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, Text, View } from "react-native";
import { clampDpad, clampDpadTab, DPAD_SIZE, DPAD_TAB_HEIGHT, resolveDpadGesture, terminalPadLayout } from "../core/terminal-controls";
import { usePreferences } from "./preferences";

// Deliberately app-lifetime, not tied to one route or computer.
let remembered = { open: false, y: null as number | null };
export function FloatingTerminalPad({ bounds, press, disabled, onOpenChange, open: controlledOpen }: { bounds: { width: number; height: number }; press(key: string): void; disabled: boolean; onOpenChange?(open: boolean): void; open?: boolean }) {
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
 const labels = { esc: s.escape, backspace: s.backspace, up: s.up, left: s.left, enter: s.enter, right: s.right, down: s.down };
 const glyphs = { esc: "Esc", backspace: "⌫", up: "↑", left: "←", enter: "↵", right: "→", down: "↓" };
 const key = (name: keyof typeof labels, left: number, keyTop: number) => <Pressable key={name} accessibilityRole="button" accessibilityLabel={labels[name]} accessibilityState={{ disabled }} disabled={disabled} onPress={() => press(name)} style={{ position: "absolute", left, top: keyTop, width: theme.touch, height: theme.touch, borderRadius: theme.touch / 2, alignItems: "center", justifyContent: "center", backgroundColor: name === "enter" ? `${c.accent}bf` : `${c.surfaceRaised}d9`, borderWidth: 1, borderColor: c.border, opacity: disabled ? 0.4 : 1 }}><Text style={{ color: name === "enter" ? c.onAccent : c.text, fontWeight: "700", fontSize: name === "esc" ? 12 : name === "enter" ? 26 : 18 }}>{glyphs[name]}</Text></Pressable>;
 return <>
  <Animated.View {...gestures.pad.panHandlers} pointerEvents={open ? "auto" : "none"} accessibilityElementsHidden={!open} importantForAccessibility={open ? "auto" : "no-hide-descendants"} style={{ position: "absolute", right: 48, top: fits ? padTop : 0, width: fits ? DPAD_SIZE : Math.max(0, Math.min(DPAD_SIZE, bounds.width - 48)), height: fits ? DPAD_SIZE : Math.max(0, bounds.height - 48), overflow: "hidden", borderRadius: theme.touch / 2, backgroundColor: "transparent", transform: [{ translateX: slide }] }}>
   {fits ? <>
    {terminalPadLayout().map(item => key(item.key, item.x, item.y))}
   </> : <Text accessibilityLiveRegion="polite" style={{ color: c.text, padding: 8 }}>{s.dpadSpace}</Text>}
  </Animated.View>
  <View {...gestures.tab.panHandlers} accessible accessibilityRole="button" accessibilityLabel={open ? s.closeDpad : s.openDpad} accessibilityState={{ expanded: open }} accessibilityActions={[{ name: "activate" }]} onAccessibilityTap={() => changeOpen(!latest.current.open)} onAccessibilityAction={event => { if (event.nativeEvent.actionName === "activate") changeOpen(!latest.current.open); }} style={{ position: "absolute", right: 0, top, width: 48, height: DPAD_TAB_HEIGHT, alignItems: "flex-end" }}>
   <View pointerEvents="none" style={{ width: 20, height: DPAD_TAB_HEIGHT, borderTopLeftRadius: theme.radius.medium, borderBottomLeftRadius: theme.radius.medium, backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.border, opacity: 0.72, alignItems: "center", justifyContent: "center" }}><Text style={{ color: c.text, fontWeight: "700" }}>{open ? "›" : "‹"}</Text></View>
  </View>
 </>;
}
