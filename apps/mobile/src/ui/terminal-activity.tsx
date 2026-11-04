import { useEffect, useState } from "react";
import { AccessibilityInfo, Text } from "react-native";
import type { TerminalActivityStatus } from "./terminal-status";

const frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
export function TerminalActivity({ status, color }: { status: TerminalActivityStatus; color: string }) {
 // Static until the system preference is known; never briefly animate against it.
 const [reduceMotion, setReduceMotion] = useState(true);
 const [frame, setFrame] = useState(0);
 useEffect(() => {
  let alive = true; let changed = false;
  const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", value => { changed = true; setReduceMotion(value); });
  void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive && !changed) setReduceMotion(value); }).catch(() => {});
  return () => { alive = false; subscription.remove(); };
 }, []);
 useEffect(() => {
  setFrame(0);
  if (reduceMotion || status.kind !== "working") return;
  const timer = setInterval(() => setFrame(value => (value + 1) % frames.length), 80);
  return () => clearInterval(timer);
 }, [reduceMotion, status.kind]);
 return <Text accessible accessibilityLiveRegion="polite" accessibilityLabel={status.announcement} numberOfLines={1} ellipsizeMode="tail" style={{ color, fontSize: 11, maxWidth: "100%" }}>
  {status.kind === "working" ? frames[reduceMotion ? 0 : frame] : status.kind === "attention" ? "✗" : "✓"}{" "}{status.text}
 </Text>;
}
