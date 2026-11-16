// «Tocá para seguir» (design/app-tour-interactivo/03): a ring on the real control, a hand,
// a small bubble and «Saltar recorrido». The tip variant has «Entendido» and no counter.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Fragment } from "react";
import { Animated, Pressable, Text, View, type ViewStyle } from "react-native";
import type { TipId, TourPresentation } from "../../core/tour";
import type { Strings } from "../i18n/en";
import type { Theme } from "../theme";
import type { Rect } from "./anchor-registry";
import { HAND, layoutCoachMark, union } from "./coach-layout";

type AnimatedNumber = number | Animated.AnimatedInterpolation<number>;
type Shared = {
 targets: Rect[];
 window: { width: number; height: number };
 insets: { top: number; bottom: number };
 bubbleHeight: number;
 /** The open keyboard's height; 0 when closed. */
 keyboard?: number;
 theme: Theme;
 t: Strings;
 reduceMotion: boolean;
 /** The pulse's scale and opacity; null under reduced motion. */
 pulse: { scale: AnimatedNumber; opacity: AnimatedNumber } | null;
 onBubbleLayout?: (height: number) => void;
};
export type CoachMarkViewProps =
 | (Shared & { variant: "tour"; presentation: TourPresentation; onTarget: () => void; onSkip: () => void; onNext: () => void })
 | (Shared & { variant: "tip"; tip: TipId; onDone: () => void });

const absolute = (rect: Rect, grow = 0): ViewStyle => ({ position: "absolute", left: rect.x - grow, top: rect.y - grow, width: rect.width + 2 * grow, height: rect.height + 2 * grow });
/** Round controls get a round ring; cards and bars the large radius. */
const ringRadius = (rect: Rect, theme: Theme, grow: number) => Math.min(rect.width, rect.height) <= 52 ? Math.max(rect.width, rect.height) / 2 + grow : theme.radius.large + grow;
const swallow = () => true;

/** Everything around the open target swallows touches; with no open target, the whole screen. */
function blockers(open: Rect | null, window: { width: number; height: number }): Rect[] {
 if (!open) return [{ x: 0, y: 0, ...window }];
 const right = open.x + open.width, bottom = open.y + open.height;
 return [
  { x: 0, y: 0, width: window.width, height: open.y },
  { x: 0, y: bottom, width: window.width, height: window.height - bottom },
  { x: 0, y: open.y, width: open.x, height: open.height },
  { x: right, y: open.y, width: window.width - right, height: open.height },
 ].filter(r => r.width > 0 && r.height > 0);
}

/** Plain functions, not components, so the view stays one tree of host elements. */
function ring(key: string, { rect, theme, reduceMotion, pulse, badge }: { rect: Rect; theme: Theme; reduceMotion: boolean; pulse: Shared["pulse"]; badge: string | null }) {
 const c = theme.colors;
 return <Fragment key={key}>
  <View testID="tour-halo" pointerEvents="none" style={{ ...absolute(rect, 5), borderWidth: 2, borderColor: c.accent, borderRadius: ringRadius(rect, theme, 5) }} />
  <View testID="tour-ring" pointerEvents="none" style={{ ...absolute(rect, 3), borderWidth: 3, borderColor: c.accentText, borderRadius: ringRadius(rect, theme, 3) }} />
  {reduceMotion || !pulse
   ? <View testID="tour-dashed" pointerEvents="none" style={{ ...absolute(rect, 9), borderWidth: 2, borderStyle: "dashed", borderColor: c.accentText, borderRadius: ringRadius(rect, theme, 9) }} />
   : <Animated.View testID="tour-pulse" pointerEvents="none" style={{ ...absolute(rect, 3), borderWidth: 3, borderColor: c.accentText, borderRadius: ringRadius(rect, theme, 3), opacity: pulse.opacity, transform: [{ scale: pulse.scale }] }} />}
  {badge ? <View pointerEvents="none" style={{ position: "absolute", left: rect.x + rect.width - 6, top: rect.y + rect.height - 18, width: 24, height: 24, borderRadius: 12, backgroundColor: c.accentText, alignItems: "center", justifyContent: "center" }}>
   <Text style={{ color: c.surface, fontSize: 13, fontWeight: "700" }}>{badge}</Text>
  </View> : null}
 </Fragment>;
}

function bubbleButton({ label, primary, onPress, theme }: { label: string; primary: boolean; onPress: () => void; theme: Theme }) {
 const c = theme.colors;
 return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ minHeight: theme.touch, minWidth: theme.touch, paddingHorizontal: theme.spacing(4), borderRadius: theme.radius.medium, alignItems: "center", justifyContent: "center", backgroundColor: primary ? c.accent : "transparent", shadowColor: primary ? theme.primaryFill.shadowColor : undefined }}>
  <Text style={{ color: primary ? c.onAccent : c.accentText, fontSize: 16, fontWeight: primary ? "700" : "600" }}>{label}</Text>
 </Pressable>;
}

export function CoachMarkView(props: CoachMarkViewProps) {
 const { targets, window, insets, bubbleHeight, keyboard = 0, theme, t, reduceMotion, pulse } = props;
 const c = theme.colors;
 const tour = props.variant === "tour" ? props.presentation : null;
 // A target that is not on screen yet never strands the user: explain it with «Siguiente».
 const mode = tour ? (tour.mode === "target" && targets.length === 0 ? "explain" : tour.mode) : "tip";
 const shown = mode === "target" || mode === "tip" ? targets : [];
 const target = union(shown);
 const layout = layoutCoachMark({ target, window, insets, bubbleHeight, keyboard });
 const open = tour && mode === "target" && tour.step.kind === "navigate" ? target : null;
 const tapTarget = tour && mode === "target" && tour.step.kind === "action" && props.variant === "tour" ? { rect: target!, onPress: props.onTarget } : null;

 const sentence = tour ? t.tour.steps[tour.step.id] : null;
 const lines = props.variant === "tip" ? t.tips.lines[props.tip] : [sentence!];
 const kicker = props.variant === "tip" ? t.tips.label(t.tips.names[props.tip]) : tour && tour.mode === "explain" ? t.tour.explainContext : null;
 const counter = tour ? t.tour.counter(tour.number, tour.total) : null;
 const hint = tour && mode === "target" && tour.step.hint ? `${counter} · ${t.tour.hints[tour.step.hint]}` : mode === "explain" ? counter : null;
 const label = tour ? `${t.tour.dialog(tour.number, tour.total)}. ${sentence}` : `${t.tips.dialog}. ${[kicker, ...lines].join(" ")}`;
 const notch = layout.notchLeft === null ? null : layout.side === "below"
  ? { top: -8, borderBottomWidth: 8, borderBottomColor: c.accentText }
  : { bottom: -8, borderTopWidth: 8, borderTopColor: c.accentText };

 return <View pointerEvents="box-none" style={{ position: "absolute", left: 0, top: 0, width: window.width, height: window.height }}>
  {blockers(open ?? tapTarget?.rect ?? null, window).map((rect, i) => <View key={`b${i}`} testID="tour-blocker" onStartShouldSetResponder={swallow} style={absolute(rect)} />)}
  {tapTarget ? <Pressable testID="tour-target" onPress={tapTarget.onPress} accessibilityRole="button" accessibilityLabel={`${sentence} ${hint ?? ""}`.trim()} style={absolute(tapTarget.rect)} /> : null}
  {shown.map((rect, i) => ring(`r${i}`, { rect, theme, reduceMotion, pulse, badge: shown.length > 1 ? String(i + 1) : null }))}
  {layout.hand ? <View pointerEvents="none" style={{ position: "absolute", left: layout.hand.left, top: layout.hand.top, width: HAND, height: HAND }}>
   <Ionicons name="hand-left" size={HAND} color={c.text} />
  </View> : null}
  <View onLayout={event => props.onBubbleLayout?.(event.nativeEvent.layout.height)} style={{ position: "absolute", left: layout.bubble.left, top: layout.bubble.top, width: layout.bubble.width, backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.accentText, borderRadius: theme.radius.large, paddingVertical: theme.spacing(3), paddingHorizontal: theme.spacing(4) }}>
   {notch && layout.notchLeft !== null ? <View pointerEvents="none" style={{ position: "absolute", left: layout.notchLeft, width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderLeftColor: "transparent", borderRightColor: "transparent", ...notch }} /> : null}
   <View testID="tour-bubble" accessible accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={label}>
    {kicker ? <Text style={{ marginBottom: 6, fontSize: 13, lineHeight: 16, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", color: c.textMuted }}>{kicker}</Text> : null}
    {lines.length > 1
     ? lines.map((line, i) => <View key={line} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", marginTop: i === 0 ? 0 : 8 }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.accentText, alignItems: "center", justifyContent: "center" }}><Text style={{ color: c.surface, fontSize: 13, fontWeight: "700" }}>{String(i + 1)}</Text></View>
      <Text style={{ flex: 1, color: c.text, fontSize: 16, lineHeight: 22 }}>{line}</Text>
     </View>)
     : <Text style={{ color: c.text, fontSize: 16, lineHeight: 22 }}>{lines[0]}</Text>}
    {hint ? <Text style={{ marginTop: 6, fontSize: 13, lineHeight: 18, fontWeight: "600", color: c.textMuted }}>{hint}</Text> : null}
   </View>
   {props.variant === "tip" ? <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: theme.spacing(3) }}>{bubbleButton({ label: t.tips.done, primary: true, onPress: props.onDone, theme })}</View>
    : mode === "finish" ? <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: theme.spacing(3) }}>{bubbleButton({ label: t.tour.start, primary: true, onPress: props.onNext, theme })}</View>
    : mode === "explain" ? <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: theme.spacing(2) }}>{bubbleButton({ label: t.tour.next, primary: false, onPress: props.onNext, theme })}</View>
    : null}
  </View>
  {props.variant === "tour" && mode !== "finish" ? <Pressable onPress={props.onSkip} accessibilityRole="button" accessibilityLabel={t.tour.skip} style={{ position: "absolute", right: 12, top: layout.skip.top, minHeight: theme.touch, maxWidth: layout.skip.width, paddingHorizontal: theme.spacing(4), borderRadius: theme.radius.large, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceRaised, alignItems: "center", justifyContent: "center" }}>
   <Text style={{ color: c.text, fontSize: 14, fontWeight: "600" }}>{t.tour.skip}</Text>
  </Pressable> : null}
 </View>;
}

