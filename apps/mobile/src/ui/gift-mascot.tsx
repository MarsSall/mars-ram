// A gift theme's pixel-art mascot, drawn with plain Views: no image asset, so the art only travels inside the sealed theme.
import { Text, View } from "react-native";
import type { GiftMascot as Mascot } from "../core/gift-themes";

/** One run of same-colored cells in a row; transparent cells are left as spacing. */
export type MascotSegment = { row: number; start: number; length: number; color: string };

/** Merges consecutive same-key cells of each row into one segment, so the view count stays low. */
export function mascotSegments(mascot: Pick<Mascot, "palette" | "rows">): MascotSegment[] {
 const segments: MascotSegment[] = [];
 mascot.rows.forEach((line, row) => {
  let start = 0;
  while (start < line.length) {
   const key = line[start];
   let end = start + 1;
   while (end < line.length && line[end] === key) end++;
   const color = key === "." ? undefined : mascot.palette[key];
   if (color) segments.push({ row, start, length: end - start, color });
   start = end;
  }
 });
 return segments;
}

/** Fits the grid to `width`, keeping each pixel's aspect; the caption, when given, is its accessible name. */
export function GiftMascot({ mascot, width, captionColor }: { mascot: Mascot; width: number; captionColor: string }) {
 const columns = mascot.rows[0]?.length ?? 0;
 if (!columns || width <= 0) return null;
 const cellWidth = width / columns;
 const cellHeight = cellWidth * (mascot.pixel.height / mascot.pixel.width);
 const caption = mascot.caption;
 const a11y = caption
  ? { accessible: true, accessibilityRole: "image" as const, accessibilityLabel: caption }
  : { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const };
 return (
  <View {...a11y} style={{ alignItems: "center" }}>
   <View style={{ width, height: cellHeight * mascot.rows.length }}>
    {mascotSegments(mascot).map(segment => (
     <View key={`${segment.row}:${segment.start}`} style={{ position: "absolute", left: segment.start * cellWidth, top: segment.row * cellHeight, width: segment.length * cellWidth, height: cellHeight, backgroundColor: segment.color }} />
    ))}
   </View>
   {caption ? <Text style={{ color: captionColor, fontSize: 14, fontWeight: "600", letterSpacing: 2, textAlign: "center", marginTop: 8 }}>{caption}</Text> : null}
  </View>
 );
}
