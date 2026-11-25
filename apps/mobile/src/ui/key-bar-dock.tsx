// Where the terminal key bar lives (odd/tasks/key-bar-autohide.md). «Siempre visible» renders today's
// bar unchanged. In the hidden modes no row is reserved (S7): a hidden bar leaves the layout so the terminal
// reaches the safe area, and a shown one sits under the terminal, pushing it up. The handle tab and 💬
// (`KeyBarHandles`) never cover the terminal (S8): they sit below it, in the empty bottom band where Android
// draws its home line or, when they do not fit there, in a thin row of their own size (`keyBarHandleSlot`).
// 💬 is centred where it always was, the tab to its right (S6); both are tap only (no swipe, L4 and S8).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Pressable, View } from "react-native";
import {
 initialKeyBarState, isMousePointer, keyBarHandleMetrics, keyBarMotion, keyBarReducer, keyBarTimer,
 type KeyBarEvent, type KeyBarHandleSlot, type KeyBarMode, type KeyBarState,
} from "../core/key-bar-visibility";
import { usePreferences } from "./preferences";
import { TourAnchor } from "./tour/anchors";

type Dispatch = (event: KeyBarEvent) => void;
type PointerProps = { onPointerEnter(event: { nativeEvent: { pointerType?: string } }): void; onPointerLeave(event: { nativeEvent: { pointerType?: string } }): void };

// «Con un toque» stays as the user left it across terminals, for the app's lifetime (like the D-pad).
let tapShown = false;
/** The visibility rules with their hide timer; the D-pad and the mic hold the bar up while active. */
export function useKeyBarVisibility(mode: KeyBarMode, holds: { pad: boolean; mic: boolean }): { state: KeyBarState; dispatch: Dispatch } {
 const [state, setState] = useState(() => initialKeyBarState(mode, tapShown, { key: false, ...holds }));
 const latest = useRef(state);
 const dispatch = useCallback((event: KeyBarEvent) => {
  const next = keyBarReducer(latest.current, event);
  if (next === latest.current) return;
  latest.current = next; if (next.mode === "tap") tapShown = next.shown;
  setState(next);
 }, []);
 useEffect(() => { dispatch({ type: "mode-change", mode }); }, [mode, dispatch]);
 useEffect(() => { dispatch({ type: "hold", source: "pad", on: holds.pad }); }, [holds.pad, dispatch]);
 useEffect(() => { dispatch({ type: "hold", source: "mic", on: holds.mic }); }, [holds.mic, dispatch]);
 const timer = keyBarTimer(state);
 useEffect(() => {
  if (!timer) return;
  const id = setTimeout(() => dispatch({ type: "idle-timeout", epoch: timer.epoch }), timer.ms);
  return () => clearTimeout(id);
 }, [timer?.epoch, timer?.ms, dispatch]);
 return { state, dispatch };
}

function useReduceMotion(): boolean {
 const [reduceMotion, setReduceMotion] = useState(false);
 useEffect(() => {
  let alive = true; let changed = false;
  const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", value => { changed = true; setReduceMotion(value); });
  void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive && !changed) setReduceMotion(value); }).catch(() => {});
  return () => { alive = false; subscription.remove(); };
 }, []);
 return reduceMotion;
}

/** Mouse/trackpad hover only: a finger also sends pointer events and must never show or hide the bar. */
const pointerHandlers = (dispatch: Dispatch): PointerProps => ({
 onPointerEnter: event => { if (isMousePointer(event)) dispatch({ type: "pointer-enter" }); },
 onPointerLeave: event => { if (isMousePointer(event)) dispatch({ type: "pointer-leave" }); },
});

/** «Autodesplegable»: the very bottom of the screen (Android's inset) only listens to a mouse hover; it has
 * no touch handlers, so a swipe starting there stays Android's (S5). */
export function KeyBarHoverEdge({ height, dispatch }: { height: number; dispatch: Dispatch }) {
 if (height <= 0) return null;
 return <View {...pointerHandlers(dispatch)} accessible={false} importantForAccessibility="no-hide-descendants" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height }} />;
}

/** The bar's place in the layout: today's bar for «Siempre visible» (with 💬 on its top edge, as before);
 * in the hidden modes only the bar while it shows or slides out, and nothing at all when hidden (S7). */
export function KeyBarDock({ mode, shown, dispatch, chat, children }: { mode: KeyBarMode; shown: boolean; dispatch: Dispatch; chat: ReactNode; children: ReactNode }) {
 const reduceMotion = useReduceMotion();
 // The bar stays mounted while it slides out, then leaves the layout so the terminal gets the room back.
 const [mounted, setMounted] = useState(shown);
 const opacity = useRef(new Animated.Value(shown ? 1 : 0)).current;
 const translateY = useRef(new Animated.Value(0)).current;
 useEffect(() => {
  if (mode === "always") return;
  if (shown) setMounted(true);
  const target = keyBarMotion(shown, reduceMotion);
  if (shown && !reduceMotion) translateY.setValue(keyBarMotion(false, false).translateY);
  const animation = Animated.parallel([
   Animated.timing(opacity, { toValue: target.opacity, duration: target.duration, useNativeDriver: true }),
   Animated.timing(translateY, { toValue: target.translateY, duration: target.duration, useNativeDriver: true }),
  ]);
  animation.start(({ finished }) => { if (finished && !shown) setMounted(false); });
  return () => animation.stop();
 }, [mode, shown, reduceMotion, opacity, translateY]);
 if (mode === "always") return <View style={{ paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8 }}>
  {chat ? <View pointerEvents="box-none" style={{ position: "absolute", top: -4, left: 0, right: 0, alignItems: "center", zIndex: 2 }}>{chat}</View> : null}
  {children}
 </View>;
 if (!mounted && !shown) return null;
 return <View {...(mode === "auto" ? pointerHandlers(dispatch) : {})} pointerEvents={shown ? "auto" : "none"} accessibilityElementsHidden={!shown} importantForAccessibility={shown ? "auto" : "no-hide-descendants"} style={{ paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8 }}>
  <Animated.View style={{ opacity, transform: [{ translateY }] }}>{children}</Animated.View>
 </View>;
}

/** The tab's pill alone at a size (also the preview in «Personalizar teclas»); it is only drawn, never touched. */
export function KeyBarTabFace({ size, shown }: { size: number; shown: boolean }) {
 const { theme } = usePreferences(); const c = theme.colors;
 const m = keyBarHandleMetrics(size);
 return <View pointerEvents="none" style={{ width: m.pillWidth, height: m.pillHeight, borderRadius: m.pillHeight / 2, backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.border, opacity: 0.72, alignItems: "center", justifyContent: "center" }}>
  <Ionicons name={shown ? "chevron-down" : "chevron-up"} size={m.tabIcon} color={c.text} />
 </View>;
}

/** The hidden modes' handle tab and 💬 in their `slot` below the terminal (the screen lays the row out or puts
 * it in the bottom band). The row is exactly the slot's height and transparent; each touch area is that tall,
 * widened sideways to ≥ 48 dp, with no hitSlop up into the terminal or down off the screen. 💬's box keeps its
 * width without a chat (standalone terminals) so the tab does not move. */
export function KeyBarHandles({ mode, shown, dispatch, slot, size, chat }: { mode: KeyBarMode; shown: boolean; dispatch: Dispatch; slot: KeyBarHandleSlot | null; size: number; chat: ReactNode }) {
 const { t } = usePreferences(); const s = t.terminal;
 if (mode === "always" || !slot) return null;
 const m = keyBarHandleMetrics(size);
 const label = shown ? s.hideBar : s.showBar;
 const toggle = () => dispatch({ type: "handle-tap" });
 // «Autodesplegable»: a screen reader's activation arrives here instead of onPress (an "activate" action
 // replaces the click on Android), so a bar it opens is not hidden by the idle wait.
 const assistive = mode === "auto" ? {
  accessibilityActions: [{ name: "activate" as const }],
  onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => { if (event.nativeEvent.actionName === "activate") dispatch({ type: "handle-tap", assistive: true }); },
 } : {};
 return <View {...(mode === "auto" ? pointerHandlers(dispatch) : {})} pointerEvents="box-none" style={{ height: slot.height, flexDirection: "row" }}>
  <View pointerEvents="none" style={{ flex: 1 }} />
  <View pointerEvents="box-none" style={{ width: m.touchWidth }}>{chat}</View>
  <View pointerEvents="box-none" style={{ flex: 1, alignItems: "center" }}>
   {/* The tab's first-visit tip target; the wrapper is the Pressable's own size and never takes its touch. */}
   <TourAnchor id="terminal.keyBarTab">
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: shown }} onPress={toggle} {...assistive}
     style={{ width: m.touchWidth, height: slot.height, alignItems: "center", justifyContent: "center" }}>
     <KeyBarTabFace size={size} shown={shown} />
    </Pressable>
   </TourAnchor>
  </View>
 </View>;
}
