// «Novedades»: what changed in this version, once after an update and from Ajustes.
import { useEffect, useState } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import type { ReleaseNote } from "../core/whats-new";
import { whatsNew } from "../services";
import { EmptyState, PrimaryButton, Screen } from "./components";
import type { Strings } from "./i18n/en";
import { usePreferences } from "./preferences";
import type { Theme } from "./theme";

type ViewProps = { notes: ReleaseNote[]; locale: "es" | "en"; t: Strings; theme: Theme; onClose: () => void };

/** Bundled content only: no loading or error state; an empty list explains itself. */
export function WhatsNewView({ notes, locale, t, theme, onClose }: ViewProps) {
 const c = theme.colors;
 const list = (title: string, items: string[]) => items.length === 0 ? null : (
  <View key={title} style={{ gap: theme.spacing(2), marginTop: theme.spacing(3) }}>
   <Text accessibilityRole="header" style={{ color: c.textMuted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 }}>{title}</Text>
   {items.map(item => <Text key={item} style={{ color: c.text, fontSize: 16, lineHeight: 22 }}>{`•  ${item}`}</Text>)}
  </View>
 );
 return (
  <Screen title={t.whatsNew.title} footer={<PrimaryButton label={t.whatsNew.done} onPress={onClose} />}>
   <ScrollView contentContainerStyle={{ paddingHorizontal: theme.spacing(4), paddingBottom: theme.spacing(6) }}>
    {notes.length === 0 ? <EmptyState message={t.whatsNew.empty} /> : null}
    {notes.map(note => (
     <View key={note.build} style={{ marginBottom: theme.spacing(6) }}>
      <Text style={{ color: c.textMuted, fontSize: 14 }}>{t.whatsNew.version(note.version, note.build)}</Text>
      {list(t.whatsNew.new, note[locale].new)}
      {list(t.whatsNew.fixes, note[locale].fixes)}
     </View>
    ))}
   </ScrollView>
  </Screen>
 );
}

/** Shown over the app the first time it opens after an update; «Entendido» or back closes it for this build. */
export function WhatsNewGate() {
 const { t, theme, locale } = usePreferences();
 const [notes, setNotes] = useState<ReleaseNote[]>([]);
 useEffect(() => {
  let active = true;
  void whatsNew.pending().then(found => { if (active) setNotes(found); });
  return () => { active = false; };
 }, []);
 if (notes.length === 0) return null;
 const close = () => { setNotes([]); void whatsNew.dismiss(); };
 return (
  <Modal visible animationType="slide" onRequestClose={close}>
   <WhatsNewView notes={notes} locale={locale} t={t} theme={theme} onClose={close} />
  </Modal>
 );
}
