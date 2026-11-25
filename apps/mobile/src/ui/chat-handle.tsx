import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo } from "react";
import { PanResponder, Pressable, View } from "react-native";
import { chatGesture, type ChatState } from "../core/chat-gesture";
import { keyBarHandleMetrics } from "../core/key-bar-visibility";
import { usePreferences } from "./preferences";

/** On-screen size of 💬; the touch area adds `CHAT_HANDLE_SLOP_X` each side and reaches 48 dp tall. */
export const CHAT_HANDLE_WIDTH = 56;
export const CHAT_HANDLE_HEIGHT = 20;
export const CHAT_HANDLE_SLOP_X = 8;

/** The 💬 pill alone at a size (the hidden key bar modes and their preview in «Personalizar teclas»). */
export function ChatHandleFace({ size }: { size: number }) {
 const { theme } = usePreferences();
 const m = keyBarHandleMetrics(size);
 const glow = { textShadowColor: theme.colors.accentText, textShadowRadius: 5, textShadowOffset: { width: 0, height: 0 } };
 return <View pointerEvents="none" accessible={false} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2, width: m.pillWidth, height: m.pillHeight, borderRadius: m.pillHeight / 2, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background }}>
  <Ionicons name="chatbubble-outline" size={m.chatIcon} color={theme.colors.accentText} style={glow} />
  <Ionicons name="chevron-up" size={m.chatIcon} color={theme.colors.accentText} style={glow} />
 </View>;
}

/** Only this handle owns drags; the terminal, composer and key bar keep theirs.
 * `fit`: the hidden key bar modes put 💬 in the bottom band or thin row below the terminal (key-bar-autohide
 * S8), where Android answers taps but not swipes, so it is tap only there, as tall as that row and no taller,
 * and ≥ 48 dp wide; the full chat stays one tap away inside the floating chat. */
export function ChatHandle({ state, change, fit }: { state: "closed" | "floating"; change(next: ChatState): void; fit?: { size: number; height: number } }) {
 const { theme, t } = usePreferences();
 const pan = useMemo(() => fit ? null : PanResponder.create({
  onMoveShouldSetPanResponder: (_event, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
  onPanResponderRelease: (_event, g) => {
   const next = chatGesture({ state, dy: g.dy, velocity: g.vy });
   if (next !== state) change(next);
  },
  onPanResponderTerminationRequest: () => false,
 }), [state, change, fit]);
 const label = state === "closed" ? t.terminal.openChat : t.terminal.expandChat;
 const tap = () => change(chatGesture({ state, dy: 0, velocity: 0, tap: true }));
 if (fit || !pan) {
  const size = fit?.size ?? CHAT_HANDLE_HEIGHT, height = fit?.height ?? CHAT_HANDLE_HEIGHT;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={tap}
   style={{ width: keyBarHandleMetrics(size).touchWidth, height, alignItems: "center", justifyContent: "center" }}>
   <ChatHandleFace size={size} />
  </Pressable>;
 }
 const glow = { textShadowColor: theme.colors.accentText, textShadowRadius: 5, textShadowOffset: { width: 0, height: 0 } };
 // Small on screen (56×20) with a 48 dp touch area through hitSlop; it overlaps the edge it sits on.
 const slop = { top: 48 - CHAT_HANDLE_HEIGHT - 14, bottom: 14, left: CHAT_HANDLE_SLOP_X, right: CHAT_HANDLE_SLOP_X };
 return <View {...pan.panHandlers} hitSlop={slop} style={{ alignSelf: "center", width: CHAT_HANDLE_WIDTH, height: CHAT_HANDLE_HEIGHT }}>
  <Pressable hitSlop={slop} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={state === "closed" ? t.terminal.chatGestureHint : t.terminal.fullChatHint} onPress={tap} style={{ width: CHAT_HANDLE_WIDTH, height: CHAT_HANDLE_HEIGHT }}>
   <View pointerEvents="none" accessible={false} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2, height: 20, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background }}>
    <Ionicons name="chatbubble-outline" size={12} color={theme.colors.accentText} style={glow} />
    <Ionicons name="chevron-up" size={12} color={theme.colors.accentText} style={glow} />
   </View>
  </Pressable>
 </View>;
}
