// Android's bottom gesture zone for the hidden key bar (odd/tasks/key-bar-autohide.md S5). Read natively and
// again on rotation, on a safe-area change and when the app comes back (the navigation mode is changed in
// Android's Settings); the fallback applies until the first answer and whenever the reading is unavailable.
import { useEffect, useRef, useState } from "react";
import { AppState, useWindowDimensions } from "react-native";
import { keyBarGestureInset, type SystemGestureInsets } from "../core/key-bar-visibility";
import type { SystemGestureInsetsSource } from "../adapters/native-system-gesture-insets";
import { systemGestureInsets } from "../services";

/** The bottom band (dp) where a swipe up belongs to Android; never below `safeBottom`. */
export function useSystemGestureInset(safeBottom: number, source: SystemGestureInsetsSource = systemGestureInsets): number {
 const window = useWindowDimensions();
 const [native, setNative] = useState<SystemGestureInsets | null>(null);
 const latest = useRef(0);
 useEffect(() => {
  let alive = true;
  const read = () => {
   const request = ++latest.current;
   void source.read().then(value => { if (alive && request === latest.current) setNative(value); });
  };
  read();
  const subscription = AppState.addEventListener("change", state => { if (state === "active") read(); });
  return () => { alive = false; subscription.remove(); };
 }, [window.width, window.height, safeBottom, source]);
 return keyBarGestureInset(native, safeBottom);
}
