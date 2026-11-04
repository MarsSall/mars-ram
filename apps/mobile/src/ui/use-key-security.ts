import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import type { KeySecurityStatus } from "../core/key-security";
import { keySecurity } from "../services";
import { acceptSecurityStatus, beginSecurityChange, finishSecurityChange, securityErrorKey, type SecurityTextKey, type SecurityViewState } from "./key-security";

export function useKeySecurity() {
 const [status, setStatus] = useState<KeySecurityStatus | null>(null);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState<SecurityTextKey | null>(null);
 const [stale, setStale] = useState(false);
 const focused = useRef(false);
 const reading = useRef<Promise<void> | null>(null);
 const operating = useRef(false);
 const latest = useRef<SecurityViewState>({ generation: 0, changing: false, status: null });
 const refresh = useCallback(async () => {
  // Reads started during rotation cannot supply post-rotation proof.
  if (operating.current) return;
  if (reading.current) return reading.current;
  const generation = latest.current.generation;
  reading.current = (async () => {
   try {
    const next = await keySecurity.status();
    const accepted = acceptSecurityStatus(latest.current, generation, next);
    if (accepted === latest.current) return;
    latest.current = accepted;
    if (focused.current) { setStatus(accepted.status); setStale(false); }
   } catch (cause) {
    if (focused.current && generation === latest.current.generation && !latest.current.changing) {
     setStale(true); setError(securityErrorKey(cause));
    }
   } finally { reading.current = null; }
  })();
  return reading.current;
 }, []);
 useFocusEffect(useCallback(() => {
  focused.current = true;
  void refresh();
  // Only one read may queue behind the core's serialized rotation operation.
  const timer = setInterval(() => {
   if (latest.current.status?.perComputer.some(c => c.phase !== "done")) void refresh();
  }, 3000);
  return () => { focused.current = false; clearInterval(timer); };
 }, [refresh]));
 const run = async (value?: boolean) => {
  if (operating.current) return;
  operating.current = true;
  latest.current = beginSecurityChange(latest.current);
  setStatus(latest.current.status);
  setBusy(true);
  setError(null);
  try {
   if (value === undefined) await keySecurity.resume();
   else {
    const result = await keySecurity.setRequireUnlock(value);
    if (!result.ok && focused.current) setError(securityErrorKey(result));
   }
  } catch (cause) {
   if (focused.current) setError(securityErrorKey(cause));
  } finally {
   latest.current = finishSecurityChange(latest.current);
   operating.current = false;
   setBusy(false);
   // Drain any pre-change read, then start a fresh read after the operation.
   await reading.current;
   await refresh();
  }
 };
 return { status, busy, error, stale, refresh, change: (value: boolean) => run(value), resume: () => run() };
}
