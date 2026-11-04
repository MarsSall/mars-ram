import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo } from "react";
import { PanResponder, Pressable, View } from "react-native";
import { chatGesture, type ChatState } from "../core/chat-gesture";
import { usePreferences } from "./preferences";

/** Only this handle owns drags; the terminal, composer and key bar keep theirs. */
export function ChatHandle({ state, change }: { state: "closed" | "floating"; change(next: ChatState): void }) {
 const { theme, t } = usePreferences();
 const pan = useMemo(() => PanResponder.create({
  onMoveShouldSetPanResponder: (_event, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
  onPanResponderRelease: (_event, g) => {
   const next = chatGesture({ state, dy: g.dy, velocity: g.vy });
   if (next !== state) change(next);
  },
  onPanResponderTerminationRequest: () => false,
 }), [state, change]);
 const glow = { textShadowColor: theme.colors.accentText, textShadowRadius: 5, textShadowOffset: { width: 0, height: 0 } };
 // Small on screen (56×20) with a 48 dp touch area through hitSlop; it overlaps the edge it sits on.
 return <View {...pan.panHandlers} hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }} style={{ alignSelf: "center", width: 56, height: 20 }}>
  <Pressable hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel={state === "closed" ? t.terminal.openChat : t.terminal.expandChat} accessibilityHint={state === "closed" ? t.terminal.chatGestureHint : t.terminal.fullChatHint} onPress={() => change(chatGesture({ state, dy: 0, velocity: 0, tap: true }))} style={{ width: 56, height: 20 }}>
   <View pointerEvents="none" accessible={false} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2, height: 20, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background }}>
    <Ionicons name="chatbubble-outline" size={12} color={theme.colors.accentText} style={glow} />
    <Ionicons name="chevron-up" size={12} color={theme.colors.accentText} style={glow} />
   </View>
  </Pressable>
 </View>;
}
