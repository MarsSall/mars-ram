import { Text } from "react-native";
import { usePreferences } from "./preferences";
import type { TerminalActivityStatus } from "./terminal-status";
import { useFrameCycle } from "./use-reduced-motion";

const spinner = { frames: [..."⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"], intervalMs: 80 };
export function TerminalActivity({ status, color }: { status: TerminalActivityStatus; color: string }) {
 const { theme } = usePreferences();
 const working = theme.working ?? spinner;
 // Static on the first frame until the reduce-motion preference is known.
 const frame = useFrameCycle(working.frames, working.intervalMs, status.kind === "working");
 return <Text accessible accessibilityLiveRegion="polite" accessibilityLabel={status.announcement} numberOfLines={1} ellipsizeMode="tail" style={{ color, fontSize: 11, maxWidth: "100%" }}>
  {status.kind === "working" ? frame : status.kind === "attention" ? "✗" : "✓"}{" "}{status.text}
 </Text>;
}
