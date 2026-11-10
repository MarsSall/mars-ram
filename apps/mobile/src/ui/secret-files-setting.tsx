import { useState, useSyncExternalStore } from "react";
import { Switch, Text, View } from "react-native";
import { secretFiles } from "../services";
import { Card, SectionTitle } from "./components";
import { usePreferences } from "./preferences";

/** Settings › Project browser: hide .env files, private keys and credential files until «Mostrar» (MarsSall/mars-ram#1). */
export function SecretFilesSetting() {
 const { theme, t: { secretFiles: s } } = usePreferences(); const c = theme.colors;
 const hide = useSyncExternalStore(secretFiles.subscribe, secretFiles.get);
 const [failed, setFailed] = useState(false);
 const change = (value: boolean) => { setFailed(false); void secretFiles.set(value).catch(() => setFailed(true)); };
 return <>
  <SectionTitle>{s.title}</SectionTitle>
  <Card>
   <View style={{ flexDirection: "row", alignItems: "center", minHeight: theme.touch }}>
    <Text style={{ color: c.text, fontSize: 16, flex: 1 }}>{s.label}</Text>
    <Switch accessibilityLabel={s.label} value={hide} onValueChange={change} />
   </View>
   <Text style={{ color: c.textMuted, marginTop: theme.spacing(2) }}>{s.hint}</Text>
   {failed ? <Text accessibilityRole="alert" style={{ color: c.danger }}>{s.failed}</Text> : null}
  </Card>
 </>;
}
