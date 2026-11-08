import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { AppState } from "react-native";
import { focusedHerdrPane, terminalChatSession, currentPaneChatBinding, type PaneChatBinding } from "../core/pane-chat";
import { catalog, herdrSwitcher, sessions } from "../services";

/** Same ten-second discovery cadence as the sessions screen; explicit focus also refreshes. */
export function usePaneChat(hostId: string, routeKey: string | undefined) {
 const [binding, setBinding] = useState<PaneChatBinding | null>(null);
 const refresh = useRef<() => void>(() => {});
 useFocusEffect(useCallback(() => {
  let active = true; let running = false; let again = false;
  const load = async () => {
   if (!active || AppState.currentState !== "active") return;
   if (running) { again = true; return; }
   running = true;
   try {
    const hosts = await catalog.list();
    const computer = hosts.find(h => h.id === hostId);
    if (!computer) return;
    const [focus, discovered] = await Promise.all([herdrSwitcher.list(computer), sessions.list()]);
    if (!active) return;
    const live = discovered.computers.flatMap(c => c.sessions);
    const pane = focus.ok ? focusedHerdrPane(focus.value) : undefined;
    const key = terminalChatSession(hostId, routeKey, pane, live);
    setBinding({ hostId, routeKey, key, session: live.find(s => s.hostId === hostId && s.key === key) });
   } catch { /* Keep last confirmed binding on transient discovery failure. */ }
   finally { running = false; if (again) { again = false; void load(); } }
  };
  refresh.current = () => { void load(); };
  void load();
  const timer = setInterval(() => void load(), 10_000);
  const off = AppState.addEventListener("change", value => { if (value === "active") void load(); });
  return () => { active = false; clearInterval(timer); off.remove(); refresh.current = () => {}; };
 }, [hostId, routeKey]));
 const current = currentPaneChatBinding(binding, hostId, routeKey);
 return { sessionKey: current.key, session: current.session, refresh: () => refresh.current() };
}
