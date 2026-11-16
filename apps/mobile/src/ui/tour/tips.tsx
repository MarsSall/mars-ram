// First-visit tips (S6): a screen asks for its tip; a layer above the screens shows the one claimed.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { Keyboard, View, type KeyboardEventName } from "react-native";
import type { TipId } from "../../core/tour";
import { appTour } from "../../services";
import { useTourAnchors } from "./anchors";
import { CoachMark } from "./coach-mark";
import { TipGate } from "./tip-gate";

const KEYBOARD_EVENTS: KeyboardEventName[] = ["keyboardWillShow", "keyboardDidShow", "keyboardWillHide", "keyboardDidHide"];
const subscribe = (listener: () => void) => appTour.subscribe(listener);
const shownTip = () => appTour.shownTip();

/** Shows the tip once, when ready and its targets are measured and settled; never during the tour. */
export function useFirstVisitTip(id: TipId, ready: boolean): void {
 const registry = useTourAnchors();
 const gate = useRef<TipGate | null>(null);
 useEffect(() => {
  if (!registry) return;
  const current = new TipGate(id, { tour: appTour, registry });
  gate.current = current;
  const keyboard = KEYBOARD_EVENTS.map(event => Keyboard.addListener(event, () => current.moved()));
  return () => { for (const sub of keyboard) sub.remove(); current.stop(); if (gate.current === current) gate.current = null; };
 }, [registry, id]);
 useEffect(() => { gate.current?.setReady(ready); }, [registry, id, ready]);
}

/** Mount above the screens (the root for ROOT_TIPS; inside a Modal for its own), not inside a Modal of another screen. */
export function TipLayer({ tips }: { tips: readonly TipId[] }) {
 const tip = useSyncExternalStore(subscribe, shownTip);
 const done = useCallback(() => tip ? appTour.dismissTip(tip) : Promise.resolve(), [tip]);
 if (!tip || !tips.includes(tip)) return null;
 return <View pointerEvents="box-none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: 999, elevation: 999 }}>
  <CoachMark variant="tip" tip={tip} onDone={done} />
 </View>;
}
