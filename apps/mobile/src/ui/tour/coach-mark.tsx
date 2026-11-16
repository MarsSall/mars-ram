// Mounts the coach mark over the real screens: measures its targets, runs the pulse and announces it.
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Keyboard, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TIPS, type TipId, type TourAnchorId, type TourPresentation } from "../../core/tour";
import { usePreferences } from "../preferences";
import type { Rect } from "./anchor-registry";
import { useTourAnchors } from "./anchors";
import { trackKeyboard } from "./coach-layout";
import { CoachMarkView } from "./coach-mark-view";

/** Static until the system preference is known; never briefly animate against it. */
function useReduceMotion(): boolean {
 const [reduceMotion, setReduceMotion] = useState(true);
 useEffect(() => {
  let alive = true; let changed = false;
  const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", value => { changed = true; setReduceMotion(value); });
  void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive && !changed) setReduceMotion(value); }).catch(() => {});
  return () => { alive = false; subscription.remove(); };
 }, []);
 return reduceMotion;
}

const sameRects = (a: Rect[], b: Rect[]) => a.length === b.length && a.every((r, i) => r === b[i]);
/** Window rects of the given targets that are on screen now. */
function useAnchorRects(ids: TourAnchorId[]): Rect[] {
 const registry = useTourAnchors();
 const key = ids.join(" ");
 const read = () => registry ? ids.map(id => registry.rect(id)).filter((r): r is Rect => r !== null) : [];
 const [rects, setRects] = useState(read);
 useEffect(() => {
  if (!registry) return;
  const update = () => setRects(current => { const next = read(); return sameRects(current, next) ? current : next; });
  update();
  registry.measure();
  return registry.subscribe(update);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [registry, key]);
 return rects;
}

export type CoachMarkProps =
 | { variant: "tour"; presentation: TourPresentation; onTarget: () => void; onSkip: () => void; onNext: () => void }
 | { variant: "tip"; tip: TipId; onDone: () => void };

/** Mount at the root, above the screens and inside TourAnchorsProvider (not in a Modal: taps must reach the real tab). */
export function CoachMark(props: CoachMarkProps) {
 const { theme, t } = usePreferences();
 const window = useWindowDimensions();
 const safe = useSafeAreaInsets();
 const reduceMotion = useReduceMotion();
 const registry = useTourAnchors();
 const [bubbleHeight, setBubbleHeight] = useState(96);
 // The floating chat's tip sits on the keyboard: its bubble must stay above it.
 const [keyboard, setKeyboard] = useState(0);
 useEffect(() => trackKeyboard(Keyboard, setKeyboard), []);
 const anchors = props.variant === "tip" ? TIPS[props.tip].anchors : props.presentation.anchor ? [props.presentation.anchor] : [];
 const targets = useAnchorRects(anchors);
 const value = useRef(new Animated.Value(0)).current;
 useEffect(() => {
  if (reduceMotion) { value.setValue(0); return; }
  const loop = Animated.loop(Animated.timing(value, { toValue: 1, duration: 1600, useNativeDriver: true }));
  loop.start();
  return () => loop.stop();
 }, [reduceMotion, value]);
 const pulse = reduceMotion ? null : { scale: value.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }), opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }) };

 // On a navigate step the real control gets the tap; its anchor reports it.
 const navigateAnchor = props.variant === "tour" && props.presentation.mode === "target" && props.presentation.step.kind === "navigate" ? props.presentation.anchor : null;
 const onTarget = props.variant === "tour" ? props.onTarget : null;
 useEffect(() => {
  if (!registry || !navigateAnchor || !onTarget) return;
  return registry.onTap(id => { if (id === navigateAnchor) onTarget(); });
 }, [registry, navigateAnchor, onTarget]);

 // Live regions do not speak when they first appear; announce the opening step or tip once.
 const announced = useRef(false);
 useEffect(() => {
  if (announced.current) return;
  announced.current = true;
  const text = props.variant === "tour" ? `${t.tour.dialog(props.presentation.number, props.presentation.total)}. ${t.tour.steps[props.presentation.step.id]}` : `${t.tips.dialog}. ${t.tips.lines[props.tip].join(" ")}`;
  AccessibilityInfo.announceForAccessibility(text);
 });

 const shared = { targets, window: { width: window.width, height: window.height }, insets: { top: safe.top, bottom: safe.bottom }, bubbleHeight, keyboard, theme, t, reduceMotion, pulse, onBubbleLayout: (height: number) => { if (Math.abs(height - bubbleHeight) > 1) setBubbleHeight(height); } };
 return props.variant === "tour" ? <CoachMarkView {...shared} {...props} /> : <CoachMarkView {...shared} {...props} />;
}
