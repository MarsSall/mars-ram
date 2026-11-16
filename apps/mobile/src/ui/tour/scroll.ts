// A ScrollView that holds tour targets: remeasures them when it scrolls and brings the current one into view.
import { type ComponentRef, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { LayoutChangeEvent, ScrollView } from "react-native";
import type { TourAnchorId } from "../../core/tour";
import { appTour } from "../../services";
import { useTourRemeasure } from "./anchors";

/** Room left above the target for the bubble's notch and the status bar. */
const ABOVE = 96;
const subscribe = (listener: () => void) => appTour.subscribe(listener);
const currentAnchor = () => appTour.current()?.anchor ?? null;

/** Spread `props` on the ScrollView and pass `place(id)` as the onLayout of each TourAnchor directly inside it. */
export function useTourScroll() {
 const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
 const offsets = useRef(new Map<TourAnchorId, number>());
 const remeasure = useTourRemeasure();
 const anchor = useSyncExternalStore(subscribe, currentAnchor);
 const reveal = useCallback((id: TourAnchorId) => {
  const y = offsets.current.get(id);
  if (y === undefined || !scroll.current) return;
  scroll.current.scrollTo({ y: Math.max(0, y - ABOVE), animated: false });
  // Measure where it landed once the scroll is applied.
  setTimeout(remeasure, 50);
 }, [remeasure]);
 useEffect(() => { if (anchor) reveal(anchor); }, [anchor, reveal]);
 const place = useCallback((id: TourAnchorId) => (event: LayoutChangeEvent) => {
  offsets.current.set(id, event.nativeEvent.layout.y);
  if (currentAnchor() === id) reveal(id);
 }, [reveal]);
 return { props: { ref: scroll, onScroll: remeasure, onMomentumScrollEnd: remeasure, scrollEventThrottle: 100 }, place };
}
