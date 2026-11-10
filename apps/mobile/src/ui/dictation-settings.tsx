import { useState } from "react";
import { Alert, Text } from "react-native";
import { DICTATION_MODEL } from "../core/dictation";
import { dictation } from "../services";
import { Card, SectionTitle } from "./components";
import { DictationModelSheet, megabytes, modelDownload, useModelDownload } from "./dictation";
import { usePreferences } from "./preferences";

/** Settings › Dictation: whether the voice model is on the phone or downloading; download or remove it. */
export function DictationSettings() {
 const { theme, t: { dictation: s } } = usePreferences(); const c = theme.colors;
 const view = useModelDownload();
 const [sheet, setSheet] = useState(false);
 const mb = megabytes(DICTATION_MODEL.bytes);
 const remove = () => Alert.alert(s.removeModel, s.modelReady(mb), [
  { text: s.cancel, style: "cancel" },
  { text: s.removeModel, style: "destructive", onPress: () => { void dictation.removeModel().then(() => modelDownload.refresh()); } },
 ]);
 const title = view.phase === "checking" ? s.checking : view.phase === "ready" ? s.modelReady(mb) : view.phase === "missing" ? s.modelMissing
  : (view.waiting ? s.waiting : s.downloading)(megabytes(view.written), megabytes(view.total));
 return <>
  <SectionTitle>{s.settingsTitle}</SectionTitle>
  <Card onPress={view.phase === "checking" ? undefined : view.phase === "ready" ? remove : () => setSheet(true)}>
   <Text style={{ color: c.text, fontSize: 16 }}>{title}</Text>
   {view.phase === "ready" || view.phase === "missing" ? <Text style={{ color: view.phase === "ready" ? c.danger : c.accentText, fontSize: 14, marginTop: theme.spacing(1) }}>{view.phase === "ready" ? s.removeModel : s.download(mb)}</Text> : null}
   {view.phase === "missing" && view.failed ? <Text style={{ color: c.danger, fontSize: 14, marginTop: theme.spacing(1) }}>{s.errors.DOWNLOAD_FAILED}</Text> : null}
  </Card>
  <DictationModelSheet visible={sheet} close={() => setSheet(false)} />
 </>;
}
