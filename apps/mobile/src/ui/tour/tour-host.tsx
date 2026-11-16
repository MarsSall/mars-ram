// The guided tour over the real screens: shows each step's screen and the coach mark above everything.
import { usePathname, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { BackHandler, View } from "react-native";
import { appTour } from "../../services";
import { TourAnchorRegistry } from "./anchor-registry";
import { CoachMark } from "./coach-mark";
import { terminalParams, tourEndNavigation, tourNavigation, type TourNavigation } from "./tour-navigation";

/** The app's one registry; the root layout provides it to every screen. */
export const tourAnchors = new TourAnchorRegistry();
// Optional steps (Inicio's «Abrir terminal») run only when their control is registered.
appTour.attachAnchors(tourAnchors);
/** A screen that just opened (the terminal's push) may still be sliding in; measure again once it settles. */
const REMEASURE_MS = [350, 800];
const subscribe = (listener: () => void) => appTour.subscribe(listener);
const snapshot = () => appTour.current();
/** Whether this run pushed a terminal; read when it ends. Outlives renders, reset when a run starts. */
const run = { openedTerminal: false };

/** Mount once in the root layout, after the Stack and outside any Modal, so it covers the tabs and the terminal. */
export function TourHost() {
 const router = useRouter();
 const pathname = usePathname();
 const presentation = useSyncExternalStore(subscribe, snapshot);
 // Read at each step change only: a later route change must not navigate again.
 const current = useRef({ router, pathname });
 current.current = { router, pathname };
 useEffect(() => {
  const { router, pathname } = current.current;
  if (presentation?.number === 1) run.openedTerminal = false;
  const move: TourNavigation = presentation ? tourNavigation(presentation, pathname, appTour.session()) : tourEndNavigation(run.openedTerminal, pathname);
  if (!presentation) run.openedTerminal = false;
  if (move.kind === "tab") {
   if (move.leave && router.canDismiss()) router.dismissAll();
   router.navigate(move.route);
  } else if (move.kind === "terminal") {
   run.openedTerminal = true;
   router.push({ pathname: "/session/terminal/[id]", params: terminalParams(move.session) });
  }
  if (!presentation) return;
  const timers = REMEASURE_MS.map(ms => setTimeout(() => tourAnchors.measure(), ms));
  return () => timers.forEach(clearTimeout);
 }, [presentation]);
 // Android back ends the tour like «Saltar recorrido» and goes no further.
 const running = presentation !== null;
 useEffect(() => {
  if (!running) return;
  const sub = BackHandler.addEventListener("hardwareBackPress", () => {
   if (!appTour.isRunning()) return false;
   void appTour.skip();
   return true;
  });
  return () => sub.remove();
 }, [running]);
 const advance = useCallback(() => { void appTour.advance(); }, []);
 const skip = useCallback(() => { void appTour.skip(); }, []);
 if (!presentation) return null;
 return <View pointerEvents="box-none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 1000 }}>
  <CoachMark variant="tour" presentation={presentation} onTarget={advance} onSkip={skip} onNext={advance} />
 </View>;
}
