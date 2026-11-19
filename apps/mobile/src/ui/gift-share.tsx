// Ajustes › Personalización › «Tema»: one share icon for every unlocked gift (S16).
// One gift shares straight away; several open a sheet to pick which one.
import { useState } from "react";
import { Alert, Modal, Pressable, Share, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatGiftCode, type UnlockedGift } from "../core/gift-themes";
import { usePreferences } from "./preferences";

export function GiftShareButton({ gifts }: { gifts: readonly UnlockedGift[] }) {
 const { theme, t } = usePreferences(); const c = theme.colors;
 const insets = useSafeAreaInsets();
 const [picking, setPicking] = useState(false);
 if (gifts.length === 0) return null;
 const share = (gift: UnlockedGift) => { void Share.share({ message: t.gifts.shareMessage(formatGiftCode(gift.code)) }).catch(() => Alert.alert(t.settings.linkFailed)); };
 const press = () => { if (gifts.length === 1) share(gifts[0]); else setPicking(true); };
 const option = { minHeight: theme.touch, justifyContent: "center" as const, paddingHorizontal: theme.spacing(2), borderRadius: theme.radius.small };
 return <>
  <Pressable accessibilityRole="button" accessibilityLabel={t.gifts.share} onPress={press} style={({ pressed }) => ({ width: theme.touch, height: theme.touch, alignItems: "center", justifyContent: "center", borderRadius: theme.touch / 2, opacity: pressed ? 0.7 : 1 })}>
   <Ionicons name="share-social-outline" size={22} color={c.accentText} />
  </Pressable>
  <Modal visible={picking} transparent animationType="slide" onRequestClose={() => setPicking(false)}>
   <Pressable accessibilityRole="button" accessibilityLabel={t.gifts.cancel} onPress={() => setPicking(false)} style={{ flex: 1, backgroundColor: "#0008" }} />
   <View accessibilityViewIsModal style={{ padding: theme.spacing(4), paddingBottom: theme.spacing(4) + insets.bottom, borderTopLeftRadius: theme.radius.large, borderTopRightRadius: theme.radius.large, borderTopWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
    <Text accessibilityRole="header" style={{ color: c.text, fontSize: 20, fontWeight: "700", marginBottom: theme.spacing(2) }}>{t.gifts.sharePick}</Text>
    {gifts.map(gift => <Pressable key={gift.theme.id} accessibilityRole="button" accessibilityLabel={gift.theme.label} onPress={() => { setPicking(false); share(gift); }} style={({ pressed }) => ({ ...option, backgroundColor: pressed ? c.surfaceRaised : "transparent" })}>
     <Text style={{ color: c.accentText, fontSize: 16 }}>{gift.theme.label}</Text>
    </Pressable>)}
    <Pressable accessibilityRole="button" accessibilityLabel={t.gifts.cancel} onPress={() => setPicking(false)} style={({ pressed }) => ({ ...option, backgroundColor: pressed ? c.surfaceRaised : "transparent" })}>
     <Text style={{ color: c.text, fontSize: 16 }}>{t.gifts.cancel}</Text>
    </Pressable>
   </View>
  </Modal>
 </>;
}
