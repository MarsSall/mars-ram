/** How Home shows subagents (Personalización): on each session card, one summary on top, or not at all. */
export type SubagentsMode = "session" | "top" | "hidden";

export const SUBAGENTS_MODES: readonly SubagentsMode[] = ["session", "top", "hidden"];
export const DEFAULT_SUBAGENTS_MODE: SubagentsMode = "session";

/** A missing, damaged, or unknown saved value falls back to today's per-session view. */
export function parseSubagentsMode(raw: string | null): SubagentsMode {
 try {
  const value: unknown = JSON.parse(raw ?? "null");
  return SUBAGENTS_MODES.includes(value as SubagentsMode) ? (value as SubagentsMode) : DEFAULT_SUBAGENTS_MODE;
 } catch { return DEFAULT_SUBAGENTS_MODE; }
}
