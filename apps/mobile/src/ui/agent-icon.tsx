import { Image, View } from "react-native";
import type { Program } from "../core/shortcuts";
import { usePreferences } from "./preferences";

/** Official program marks; the Gentle Shell rose is shared with the Herdr drawer. */
export function AgentIcon({ program, size = 24 }: { program: Program; size?: number }) {
 const { theme: { colors: c } } = usePreferences();
 if (program !== "gentle-shell") return <Image accessible={false} resizeMode="contain" source={program === "pi" ? require("../../assets/brand/pi.png") : require("../../assets/brand/opencode.png")} style={{ width: size, height: size }} />;
 const lines = [
  [[12,3.2],[9,3.9],[7,5.7],[6.1,8.4],[7,11.1],[9.2,13],[12,13.7],[14.8,13],[17,11.1],[17.9,8.4],[17,5.7],[15,3.9],[12,3.2]],
  [[9.2,6.4],[10.5,5.1],[12.1,4.7],[13.8,5.3],[14.9,6.5],[14.8,7.9],[13.8,9.1],[12.5,9.5],[11.2,9],[10.6,7.9],[11,7],[11.9,6.7]],
  [[6.4,9.4],[9,11.2],[12,11.7],[15,11.2],[17.6,9.4]], [[12,13.7],[12,21]],
  [[12,17.4],[10.5,15.4],[7.6,14.6],[9,16.7],[12,17.4]], [[12,15.9],[13.6,14],[16.1,13.6],[14.5,15.5],[12,15.9]],
 ];
 const scale = size / 24;
 return <View accessible={false} style={{ width: size, height: size }}>{lines.flatMap((points, p) => points.slice(1).map(([x, y], i) => {
  const [x0, y0] = points[i]; const dx = (x - x0) * scale; const dy = (y - y0) * scale; const width = Math.hypot(dx, dy);
  return <View key={`${p}/${i}`} style={{ position: "absolute", height: Math.max(1, scale), borderRadius: 1, width, left: x0 * scale + dx / 2 - width / 2, top: y0 * scale + dy / 2, backgroundColor: c.danger, transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }] }} />;
 }))}</View>;
}
