import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** The system's reduce-motion setting. True until it is known, so nothing briefly animates against it. */
export function useReducedMotion(): boolean {
 const [reduceMotion, setReduceMotion] = useState(true);
 useEffect(() => {
  let alive = true; let changed = false;
  const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", value => { changed = true; setReduceMotion(value); });
  void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive && !changed) setReduceMotion(value); }).catch(() => {});
  return () => { alive = false; subscription.remove(); };
 }, []);
 return reduceMotion;
}

/** Cycles through the frames while active and motion is allowed; otherwise stays on the first. */
export function useFrameCycle(frames: readonly string[], intervalMs: number, active: boolean): string {
 const reduceMotion = useReducedMotion();
 const [frame, setFrame] = useState(0);
 const count = frames.length;
 useEffect(() => {
  setFrame(0);
  if (reduceMotion || !active || count < 2) return;
  const timer = setInterval(() => setFrame(value => (value + 1) % count), intervalMs);
  return () => clearInterval(timer);
 }, [reduceMotion, active, count, intervalMs]);
 return frames[frame % Math.max(1, count)] ?? "";
}
