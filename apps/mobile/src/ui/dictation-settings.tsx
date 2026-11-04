import { useCallback, useEffect, useState } from "react";
import { Alert, Text } from "react-native";
import { DICTATION_MODEL } from "../core/dictation";
import { dictation } from "../services";
import { Card, SectionTitle } from "./components";
import { DictationModelSheet } from "./dictation";
import { usePreferences } from "./preferences";

/** Settings › Dictation: whether the voice model is on the phone, download or remove it. */
export function DictationSettings() {
 const { theme, t: { dictation: s } } = usePreferences(); const c = theme.colors;
 const [ready, setReady] = useState<boolean | null>(null);
 const [sheet, setSheet] = useState(false);
 const refresh = useCallback(() => { setReady(null); void dictation.modelReady().then(setReady); }, []);
 useEffect(refresh, [refresh]);
 const mb = Math.round(DICTATION_MODEL.bytes / 1e6);
 const remove = () => Alert.alert(s.removeModel, s.modelReady(mb), [
  { text: s.cancel, style: "cancel" },
  { text: s.removeModel, style: "destructive", onPress: () => { void dictation.removeModel().then(refresh); } },
 ]);
 return <>
  <SectionTitle>{s.settingsTitle}</SectionTitle>
  <Card onPress={ready === null ? undefined : ready ? remove : () => setSheet(true)}>
   <Text style={{ color: c.text, fontSize: 16 }}>{ready === null ? s.checking : ready ? s.modelReady(mb) : s.modelMissing}</Text>
   {ready !== null ? <Text style={{ color: ready ? c.danger : c.accentText, fontSize: 14, marginTop: theme.spacing(1) }}>{ready ? s.removeModel : s.download(mb)}</Text> : null}
  </Card>
  <DictationModelSheet visible={sheet} close={() => { setSheet(false); refresh(); }} />
 </>;
}
