import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Attachment } from "../core/attachment-draft";
import type { AttachmentSource } from "../core/media-source";
import { usePreferences } from "./preferences";

export function AttachmentButton({ disabled, busy, select, label, showLabel = false, compact = false }: { disabled: boolean; busy: boolean; select: (source: AttachmentSource) => Promise<void>; label?: string; showLabel?: boolean; compact?: boolean }) {
 const [open, setOpen] = useState(false);
 const { theme, t } = usePreferences();
 const c = theme.colors;
 const insets = useSafeAreaInsets();
 const buttonStyle = { minWidth: 48, minHeight: 48, padding: 12, justifyContent: "center" as const };
 return <>
  <Pressable accessibilityRole="button" accessibilityLabel={label ?? t.attachments.add} disabled={disabled || busy} onPress={() => setOpen(true)} hitSlop={compact ? { top: 2, bottom: 2 } : undefined} style={{ ...(compact ? { width: "100%" as const, height: 44, borderRadius: 22, backgroundColor: c.surfaceRaised, alignItems: "center" as const, justifyContent: "center" as const } : buttonStyle), opacity: disabled || busy ? 0.4 : 1 }}>
   {busy ? <ActivityIndicator color={c.accentText} /> : compact || showLabel ? <Text style={{ color: c.accentText, fontSize: 18 }}>{compact ? "＋" : label}</Text> : <Ionicons name="attach-outline" size={24} color={c.accentText} />}
  </Pressable>
  <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
   <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#0008" }}>
    <Pressable accessibilityLabel={t.attachments.close} onPress={() => setOpen(false)} style={{ flex: 1 }} />
    <View accessibilityViewIsModal style={{ backgroundColor: c.surface, padding: 16, paddingBottom: 16 + insets.bottom, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 8 }}>
     <Text accessibilityRole="header" style={{ color: c.text, fontSize: 20, fontWeight: "700" }}>{t.attachments.title}</Text>
     {(["gallery", "camera", "clipboard", "files"] as const).map(source => <Pressable key={source} accessibilityRole="button" accessibilityLabel={t.attachments[source]} onPress={() => { setOpen(false); void select(source); }} style={{ ...buttonStyle, minHeight: 56, backgroundColor: c.surfaceRaised, borderRadius: 12 }}><Text style={{ color: c.text, fontSize: 18 }}>{t.attachments[source]}</Text></Pressable>)}
     <Pressable accessibilityRole="button" accessibilityLabel={t.attachments.close} onPress={() => setOpen(false)} style={buttonStyle}><Text style={{ color: c.accentText }}>{t.attachments.close}</Text></Pressable>
    </View>
   </View>
  </Modal>
 </>;
}

export function AttachmentCards({ items, remove, disabled }: { items: readonly Attachment[]; remove: (id: string) => void; disabled: boolean }) {
 const { theme, t } = usePreferences();
 const c = theme.colors;
 if (!items.length) return null;
 return <ScrollView horizontal style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ padding: 8, gap: 8 }} keyboardShouldPersistTaps="always">
  {items.map(item => <View key={item.id} style={{ width: 160, borderRadius: 12, backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.border }}>
   <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
    {item.mimeType.startsWith("image/") ? <Image accessible accessibilityLabel={item.displayName} source={{ uri: item.sourceUri }} style={{ width: 96, height: 64, borderRadius: 8 }} /> : <View style={{ padding: 8 }}><Ionicons name="document-text-outline" size={28} color={c.text} /></View>}
    <Pressable accessibilityRole="button" accessibilityLabel={t.attachments.remove(item.displayName)} disabled={disabled} onPress={() => remove(item.id)} style={{ minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.4 : 1 }}><Text style={{ color: c.danger, fontSize: 24 }}>✕</Text></Pressable>
   </View>
   <Text numberOfLines={2} style={{ color: c.text, paddingHorizontal: 8 }}>{item.displayName}</Text>
   <Text style={{ color: c.textMuted, padding: 8, fontSize: 12 }}>{item.size === null ? t.attachments.unknownSize : item.size >= 1024 * 1024 ? `${(item.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(item.size / 1024)} KB`}</Text>
  </View>)}
 </ScrollView>;
}
