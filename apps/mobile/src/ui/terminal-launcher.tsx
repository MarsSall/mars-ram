import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { type ComponentRef, useRef, useState } from "react";
import { Image, Modal, Pressable, Text, View } from "react-native";
import { terminalLauncherOptions } from "../core/terminal-launcher";
import { usePreferences } from "./preferences";

const icon = require("../../assets/brand/herdr.png");

export function TerminalLauncher({ host, compact = false }: { host: { id: string; name: string }; compact?: boolean }) {
 const { theme, t } = usePreferences();
 const [open, setOpen] = useState(false);
 const toggle = useRef<ComponentRef<typeof View>>(null);
 const [anchorY, setAnchorY] = useState(0);
 const c = theme.colors;
 const launch = () => {
  setOpen(false);
  router.push({ pathname: "/session/terminal/[id]", params: { id: host.id, standalone: "1", computer: host.name } });
 };
 const target = { minWidth: theme.touch, minHeight: theme.touch, alignItems: "center" as const, justifyContent: "center" as const };
 return <>
  <View style={{ flexDirection: "row", backgroundColor: compact ? c.surfaceRaised : c.accent, borderRadius: theme.radius.medium, overflow: "hidden" }}>
   <Pressable accessibilityRole="button" accessibilityLabel={t.launcher.open(host.name)} onPress={launch} style={{ ...target, flex: compact ? undefined : 1, flexDirection: "row", gap: theme.spacing(2), paddingHorizontal: compact ? 0 : theme.spacing(3) }}>
    {compact ? <Image source={icon} accessible={false} style={{ width: 24, height: 24 }} /> : <><Ionicons name="terminal-outline" size={22} color={c.onAccent} /><Text style={{ color: c.onAccent, fontWeight: "700", flexShrink: 1 }}>{t.computers.openTerminal}</Text></>}
   </Pressable>
   <Pressable ref={toggle} accessibilityRole="button" accessibilityLabel={t.launcher.choose(host.name)} accessibilityState={{ expanded: open }} onPress={() => { toggle.current?.measureInWindow((_x, y) => { setAnchorY(y); setOpen(true); }); }} style={{ ...target, borderLeftWidth: 1, borderColor: c.border }}>
    <Ionicons name="chevron-down" size={20} color={compact ? c.text : c.onAccent} />
   </Pressable>
  </View>
  <Modal visible={open} transparent onRequestClose={() => setOpen(false)}>
   <Pressable accessibilityRole="button" accessibilityLabel={t.launcher.close} onPress={() => setOpen(false)} style={{ flex: 1 }} />
   <View accessibilityViewIsModal style={{ position: "absolute", top: anchorY + theme.touch, right: theme.spacing(4), width: "85%", maxWidth: 320, padding: theme.spacing(2), borderRadius: theme.radius.medium, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
    {terminalLauncherOptions.map(option => <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ disabled: !option.enabled, selected: option.default }} disabled={!option.enabled} onPress={launch} style={{ minHeight: theme.touch, flexDirection: "row", alignItems: "center", gap: theme.spacing(2), padding: theme.spacing(2) }}>
     {option.enabled ? <Image source={icon} accessible={false} style={{ width: 24, height: 24 }} /> : null}
     <Text style={{ color: option.enabled ? c.text : c.textMuted, flex: 1 }}>{option.enabled ? `${option.name} · ${t.launcher.default} ✓` : t.launcher.future}</Text>
    </Pressable>)}
   </View>
  </Modal>
 </>;
}
