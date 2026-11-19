// A gift theme's round photo, kept in its original colors; the JPEG only travels inside the sealed theme.
import { Image, Text, View } from "react-native";
import type { GiftPhoto as Photo } from "../core/gift-themes";

/**
 * The photo as a circle of `size`, with its optional glowing ring and, when given, a caption below that names it.
 * Without a caption it is decorative and hidden from accessibility.
 */
export function GiftPhoto({ photo, size, captionColor, background, marginBottom }: { photo: Photo; size: number; captionColor: string; background?: string; marginBottom?: number }) {
 const caption = photo.caption;
 const a11y = caption
  ? { accessible: true, accessibilityRole: "image" as const, accessibilityLabel: caption }
  : { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const };
 const glow = photo.ring ? { borderWidth: 2, borderColor: photo.ring.color, shadowColor: photo.ring.glow, shadowOpacity: 0.8, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 10 } : {};
 return (
  <View {...a11y} style={{ alignItems: "center", ...(marginBottom !== undefined ? { marginBottom } : {}) }}>
   {/* The ring and glow sit on an outer circle; the inner one clips the photo, since clipping would also cut the shadow on iOS. */}
   <View style={{ width: size, height: size, borderRadius: size / 2, ...(background ? { backgroundColor: background } : {}), ...glow }}>
    <View style={{ flex: 1, borderRadius: size / 2, overflow: "hidden" }}>
     <Image source={{ uri: `data:image/jpeg;base64,${photo.jpeg}` }} accessible={false} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
    </View>
   </View>
   {caption ? <Text style={{ color: captionColor, fontSize: 14, fontWeight: "600", letterSpacing: 2, textAlign: "center", marginTop: 8 }}>{caption}</Text> : null}
  </View>
 );
}
