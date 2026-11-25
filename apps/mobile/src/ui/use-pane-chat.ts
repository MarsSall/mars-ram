import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { AppState } from "react-native";
import { focusedHerdrPane, currentPaneChatBinding, nextPaneChatBinding, type PaneChatBinding, type PaneChatReason } from "../core/pane-chat";
import { catalog, herdrSwitcher, sessions } from "../services";

/** Same ten-second discovery cadence as the sessions screen. The target follows Herdr's focused pane
 * only on `refresh()` (the user picked a tab); timer, resume and list updates never retarget it (claude-codex L20).
 * Disabled (the plain shell): no discovery at all and no chat binding. */
export function usePaneChat(hostId: string, routeKey: string | undefined, enabled = true) {
 const [binding, setBinding] = useState<PaneChatBinding | null>(null);
 const latest = useRef<PaneChatBinding | null>(null); latest.current = binding;
 const refresh = useRef<() => void>(() => {});
 useFocusEffect(useCallback(() => {
  if (!enabled) { setBinding(null); return; }
  let active = true; let running = false; let again: PaneChatReason | null = null;
  const load = async (reason: PaneChatReason) => {
   if (!active || AppState.currentState !== "active") return;
   if (running) { if (again !== "explicit") again = reason; return; }
   running = true;
   try {
    const hosts = await catalog.list();
    const computer = hosts.find(h => h.id === hostId);
    if (!computer) return;
    const [focus, discovered] = await Promise.all([herdrSwitcher.list(computer), sessions.list()]);
    if (!active) return;
    const live = discovered.computers.flatMap(c => c.sessions);
    const pane = focus.ok ? focusedHerdrPane(focus.value) : undefined;
    const next = nextPaneChatBinding(latest.current, hostId, routeKey, pane, live, reason);
    latest.current = next; setBinding(next);
   } catch { /* Keep last confirmed binding on transient discovery failure. */ }
   finally { running = false; if (again) { const queued = again; again = null; void load(queued); } }
  };
  refresh.current = () => { void load("explicit"); };
  void load("poll");
  const timer = setInterval(() => void load("poll"), 10_000);
  const off = AppState.addEventListener("change", value => { if (value === "active") void load("poll"); });
  return () => { active = false; clearInterval(timer); off.remove(); refresh.current = () => {}; };
 }, [hostId, routeKey, enabled]));
 const current = currentPaneChatBinding(enabled ? binding : null, hostId, routeKey);
 return { sessionKey: enabled ? current.key : undefined, session: enabled ? current.session : undefined, refresh: () => refresh.current() };
}
