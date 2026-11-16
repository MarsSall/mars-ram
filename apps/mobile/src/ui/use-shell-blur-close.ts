import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import type { HerdrTerminal } from "../core/herdr-terminal";

/** Blur (not a dependency change) ends a plain shell's SSH channel; restart prepares a fresh shell for the return. */
export function useShellBlurClose(closeOnBlur: boolean, terminal: { current: Pick<HerdrTerminal, "close"> | null }, restart: () => void): void {
 useFocusEffect(useCallback(() => {
  if (!closeOnBlur) return;
  return () => { void terminal.current?.close(); restart(); };
 }, [closeOnBlur, terminal, restart]));
}
