// Lets any existing control register itself as a tour target and be measured in window coordinates.
import { type ComponentRef, createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { Dimensions, View, type ViewProps } from "react-native";
import type { TourAnchorId } from "../../core/tour";
import { TourAnchorRegistry, type Rect } from "./anchor-registry";

type ViewRef = ComponentRef<typeof View>;
const AnchorsContext = createContext<TourAnchorRegistry | null>(null);

/** Mount once at the root, around the screens and the coach-mark overlay. */
export function TourAnchorsProvider({ registry, children }: { registry: TourAnchorRegistry; children: ReactNode }) {
 // Rotation and window changes move every control.
 useEffect(() => { const sub = Dimensions.addEventListener("change", () => registry.measure()); return () => sub.remove(); }, [registry]);
 return <AnchorsContext.Provider value={registry}>{children}</AnchorsContext.Provider>;
}

export function useTourAnchors(): TourAnchorRegistry | null { return useContext(AnchorsContext); }

/** Props to spread on the control's outer View: `<View {...useTourAnchor("computers.add")}>`. */
export function useTourAnchor(id: TourAnchorId): Pick<ViewProps, "onLayout" | "onTouchEnd" | "collapsable"> & { ref: (view: ViewRef | null) => void } {
 const registry = useTourAnchors();
 const view = useRef<ViewRef | null>(null);
 useEffect(() => {
  if (!registry) return;
  return registry.register(id, done => {
   const node = view.current;
   if (!node) done({ x: 0, y: 0, width: 0, height: 0 });
   else node.measureInWindow((x, y, width, height) => done({ x, y, width, height }));
  });
 }, [registry, id]);
 // A control that stays mounted but hides its view (a closed sheet) forgets its rect.
 const ref = useCallback((node: ViewRef | null) => { view.current = node; registry?.measure(id); }, [registry, id]);
 return {
  ref,
  collapsable: false,
  onLayout: () => registry?.measure(id),
  // Bubbles up from the real control without taking the touch from it.
  onTouchEnd: () => registry?.tapped(id),
 };
}

/**
 * Wraps a control that cannot take the props itself. inset: the control's own margins (a Card's, a
 * PrimaryButton's), so the ring hugs it without moving it.
 */
export function TourAnchor({ id, children, style, inset, onLayout }: { id: TourAnchorId; children: ReactNode; style?: ViewProps["style"]; inset?: { horizontal?: number; vertical?: number }; onLayout?: ViewProps["onLayout"] }) {
 const anchor = useTourAnchor(id);
 const h = inset?.horizontal ?? 0, v = inset?.vertical ?? 0;
 return <View {...anchor} onLayout={event => { anchor.onLayout?.(event); onLayout?.(event); }} style={[{ marginHorizontal: h, marginVertical: v }, style]}>
  {h || v ? <View style={{ marginHorizontal: -h, marginVertical: -v }}>{children}</View> : children}
 </View>;
}

/** For a ScrollView's onScroll and onMomentumScrollEnd: targets inside it moved. */
export function useTourRemeasure(): () => void {
 const registry = useTourAnchors();
 return useCallback(() => registry?.measure(), [registry]);
}

const noRect = () => () => {};
/** The target's current window rect, or null while it is not on screen. */
export function useAnchorRect(id: TourAnchorId | null): Rect | null {
 const registry = useTourAnchors();
 return useSyncExternalStore(registry ? listener => registry.subscribe(listener) : noRect, () => (registry && id ? registry.rect(id) : null));
}
