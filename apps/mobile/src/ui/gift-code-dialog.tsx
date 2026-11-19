// Code field opened by the hidden gesture in Settings; a right code shows the gift's greeting.
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { GiftAvatar as Avatar, GiftThemeData } from "../core/gift-themes";
import { PrimaryButton } from "./components";
import { GiftMascot } from "./gift-mascot";
import { usePreferences } from "./preferences";

export function GiftCodeDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
 const { theme, t, locale, unlockGift, setTheme } = usePreferences();
 const [code, setCode] = useState("");
 const [checking, setChecking] = useState(false);
 const [wrong, setWrong] = useState(false);
 const [gift, setGift] = useState<GiftThemeData | null>(null);
 // Ignores an answer that arrives after the dialog was closed.
 const attempt = useRef(0);
 const close = () => { attempt.current++; setCode(""); setChecking(false); setWrong(false); setGift(null); onClose(); };
 const submit = async () => {
  if (checking || !code.trim()) return;
  const current = ++attempt.current;
  setChecking(true); setWrong(false);
  const opened = await unlockGift(code).catch(() => null);
  if (current !== attempt.current) return;
  setChecking(false);
  if (opened) { setGift(opened); setCode(""); } else setWrong(true);
 };
 const greeting = gift?.greeting[locale];
 const ghost = (label: string, onPress: () => void, disabled = false) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ minHeight: theme.touch, alignItems: "center", justifyContent: "center", marginHorizontal: theme.spacing(4), borderRadius: theme.radius.medium, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 })}>
   <Text style={{ color: theme.colors.accentText, fontSize: 16, fontWeight: "600" }}>{label}</Text>
  </Pressable>
 );
 return (
  <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
   <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: "center", backgroundColor: "rgba(0, 0, 0, 0.6)", padding: theme.spacing(6) }}>
    <View accessibilityViewIsModal style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: theme.radius.large, paddingVertical: theme.spacing(5) }}>
     {greeting ? <>
      {gift?.avatar ? <GiftAvatar avatar={gift.avatar} background={gift.colors.surface} marginBottom={theme.spacing(4)} /> : null}
      <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: 20, fontWeight: "700", textAlign: "center", marginHorizontal: theme.spacing(5) }}>{greeting.title}</Text>
      <Text style={{ color: theme.colors.textMuted, fontSize: 16, lineHeight: 22, textAlign: "center", marginHorizontal: theme.spacing(5), marginTop: theme.spacing(2) }}>{greeting.body}</Text>
      <PrimaryButton label={t.gifts.useTheme} onPress={() => { if (gift) setTheme(gift.id); close(); }} />
      {ghost(t.gifts.notNow, close)}
     </> : <>
      <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: 20, fontWeight: "700", marginHorizontal: theme.spacing(5) }}>{t.gifts.title}</Text>
      <Text style={{ color: theme.colors.textMuted, fontSize: 16, lineHeight: 22, marginHorizontal: theme.spacing(5), marginTop: theme.spacing(2) }}>{t.gifts.body}</Text>
      <TextInput
       accessibilityLabel={t.gifts.codeLabel}
       value={code}
       onChangeText={value => { setCode(value); setWrong(false); }}
       onSubmitEditing={() => { void submit(); }}
       editable={!checking}
       autoFocus
       autoCapitalize="characters"
       autoCorrect={false}
       autoComplete="off"
       spellCheck={false}
       importantForAutofill="no"
       maxLength={24}
       returnKeyType="done"
       style={{ minHeight: theme.touch, marginHorizontal: theme.spacing(5), marginTop: theme.spacing(4), paddingHorizontal: theme.spacing(3), borderRadius: theme.radius.medium, borderWidth: 1, borderColor: wrong ? theme.colors.danger : theme.colors.border, backgroundColor: theme.colors.surfaceRaised, color: theme.colors.text, fontFamily: theme.font.mono, fontSize: 18, letterSpacing: 2 }}
      />
      {wrong ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: theme.colors.danger, fontSize: 14, marginHorizontal: theme.spacing(5), marginTop: theme.spacing(2) }}>{t.gifts.wrong}</Text> : null}
      <PrimaryButton label={checking ? t.gifts.checking : t.gifts.unlock} disabled={checking || !code.trim()} onPress={() => { void submit(); }} />
      {ghost(t.gifts.cancel, close)}
     </>}
    </View>
   </KeyboardAvoidingView>
  </Modal>
 );
}

const AVATAR_SIZE = 104;

/** The gift's pixel portrait in a round frame, with its glowing ring; decorative, since the title names the gift. */
export function GiftAvatar({ avatar, background, marginBottom }: { avatar: Avatar; background: string; marginBottom: number }) {
 const { image, ring } = avatar;
 const columns = image.rows[0]?.length ?? 1;
 const aspect = (image.rows.length * image.pixel.height) / (columns * image.pixel.width);
 const inner = AVATAR_SIZE * 0.8;
 const width = aspect > 1 ? inner / aspect : inner;
 const glow = ring ? { borderWidth: 2, borderColor: ring.color, shadowColor: ring.glow, shadowOpacity: 0.8, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 10 } : {};
 return (
  // The ring and glow sit on an outer circle; the inner one clips the art, since clipping would also cut the shadow on iOS.
  <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ alignSelf: "center", width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, backgroundColor: background, marginBottom, ...glow }}>
   <View style={{ flex: 1, borderRadius: AVATAR_SIZE / 2, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
    <GiftMascot mascot={image} width={width} captionColor={background} />
   </View>
  </View>
 );
}
