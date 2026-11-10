// «Nuevo botón propio» / «Editar botón» (S5): name, what it sends, Enter at the end, «Ignorar Ctrl», preview and the fixed warning.
import { useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { CUSTOM_LIMITS, type CustomButton, type KeyRefusal, type TerminalKeyLayout } from "../core/terminal-keys";
import { PrimaryButton, Screen } from "./components";
import { usePreferences } from "./preferences";
import { customFormProblems, formButton, formIgnoresCtrl, refusalMessage, type CustomForm } from "./terminal-keys-draft";

type Props = { visible: boolean; initial: CustomForm; layout: TerminalKeyLayout; submit(button: CustomButton): KeyRefusal | null; remove?(): void; close(): void };

/** Edits go to the editor's draft; nothing is saved until «Guardar cambios». Remount with a `key` per button. */
export function CustomButtonForm({ visible, initial, layout, submit, remove, close }: Props) {
 const { theme, t } = usePreferences(); const k = t.terminalKeys; const c = theme.colors;
 const [form, setForm] = useState<CustomForm>(() => ({ ...initial, ignoreCtrl: formIgnoresCtrl(initial, layout) }));
 const [tried, setTried] = useState(false);
 const [refusal, setRefusal] = useState<KeyRefusal | null>(null);
 const problems = customFormProblems(form);
 const change = (next: Partial<CustomForm>) => { setRefusal(null); setForm({ ...form, ...next }); };
 const send = () => {
  setTried(true);
  if (problems.name || problems.text) return;
  setRefusal(submit(formButton(form, layout)));
 };
 const confirmRemove = () => Alert.alert(k.deleteTitle(initial.name), k.deleteBody, [
  { text: k.cancel, style: "cancel" },
  { text: k.delete, style: "destructive", onPress: () => remove?.() },
 ]);
 const nameProblem = tried && problems.name ? { empty: k.problems.nameEmpty, long: k.problems.nameLong, invalid: k.problems.nameInvalid }[problems.name] : null;
 const textProblem = tried && problems.text ? { empty: k.problems.textEmpty, long: k.problems.textLong, invalid: k.problems.textInvalid }[problems.text] : null;
 const field = { minHeight: theme.touch, paddingHorizontal: theme.spacing(3), borderRadius: theme.radius.medium, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceRaised, color: c.text, fontSize: 16 } as const;
 const help = (text: string, problem: string | null, count?: string) => <View style={{ flexDirection: "row", gap: theme.spacing(2), marginTop: theme.spacing(1) }}>
  <Text accessibilityLiveRegion={problem ? "polite" : "none"} style={{ flex: 1, color: problem ? c.danger : c.textMuted, fontSize: 14 }}>{problem ?? text}</Text>
  {count ? <Text style={{ color: c.textMuted, fontSize: 14, fontVariant: ["tabular-nums"] }}>{count}</Text> : null}
 </View>;
 const preview = form.text.replace(/\s+/g, " ").trim();
 const name = form.name.trim();
 return <Modal visible={visible} animationType="slide" onRequestClose={close}>
  <Screen footer={<View style={{ paddingBottom: theme.spacing(2) }}>
   {refusal ? <Text accessibilityRole="alert" style={{ color: c.danger, marginHorizontal: theme.spacing(4) }}>{refusalMessage(refusal, k)}</Text> : null}
   <PrimaryButton label={initial.id ? k.updateButton : k.createButton} onPress={send} />
   {initial.id ? null : <Text style={{ color: c.textMuted, fontSize: 14, textAlign: "center", marginHorizontal: theme.spacing(4) }}>{k.afterCreate}</Text>}
  </View>}>
   <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing(2), paddingHorizontal: theme.spacing(2), paddingVertical: theme.spacing(2) }}>
    <Pressable accessibilityRole="button" accessibilityLabel={k.formCancel} onPress={close} style={{ width: theme.touch, height: theme.touch, alignItems: "center", justifyContent: "center" }}>
     <Ionicons name="arrow-back" size={24} color={c.text} />
    </Pressable>
    <Text accessibilityRole="header" style={{ flex: 1, color: c.text, fontSize: 22, fontWeight: "700" }}>{initial.id ? k.editTitle : k.newTitle}</Text>
   </View>
   <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: theme.spacing(4), paddingBottom: theme.spacing(6), gap: theme.spacing(3) }}>
    <View>
     <Text style={{ color: c.text, fontSize: 16, marginBottom: theme.spacing(1) }}>{k.name}</Text>
     <TextInput accessibilityLabel={k.name} value={form.name} onChangeText={value => change({ name: value })} maxLength={CUSTOM_LIMITS.name} autoCapitalize="none" autoCorrect={false} style={field} />
     {help(k.nameHelp, nameProblem, k.count(Array.from(form.name).length, CUSTOM_LIMITS.name))}
    </View>
    <View>
     <Text style={{ color: c.text, fontSize: 16, marginBottom: theme.spacing(1) }}>{k.text}</Text>
     {/* A typed command may hold secrets: keep it out of keyboard suggestions and learning. */}
     <TextInput accessibilityLabel={k.text} value={form.text} onChangeText={value => change({ text: value })} maxLength={CUSTOM_LIMITS.text} multiline autoCapitalize="none" autoCorrect={false} autoComplete="off" spellCheck={false} importantForAutofill="no" textAlignVertical="top"
      style={{ ...field, minHeight: theme.touch * 2, paddingVertical: theme.spacing(2), fontFamily: theme.font.mono }} />
     {help(k.textHelp, textProblem)}
    </View>
    <View>
     <View style={{ flexDirection: "row", alignItems: "center", minHeight: theme.touch, gap: theme.spacing(2) }}>
      <View style={{ flex: 1 }}>
       <Text style={{ color: c.text, fontSize: 16 }}>{k.enter}</Text>
       <Text style={{ color: c.textMuted, fontSize: 14 }}>{k.enterHelp}</Text>
      </View>
      <Switch accessibilityLabel={k.enter} value={form.enter} onValueChange={value => change({ enter: value })} />
     </View>
     {form.enter ? <Text accessibilityLiveRegion="polite" style={{ color: c.attention, fontSize: 14, marginTop: theme.spacing(1) }}>{k.holdNote}</Text> : null}
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", minHeight: theme.touch, gap: theme.spacing(2) }}>
     <View style={{ flex: 1 }}>
      <Text style={{ color: c.text, fontSize: 16 }}>{k.ignoreCtrl}</Text>
      <Text style={{ color: c.textMuted, fontSize: 14 }}>{k.ignoreCtrlHelp}</Text>
     </View>
     <Switch accessibilityLabel={k.ignoreCtrl} value={form.ignoreCtrl ?? true} onValueChange={value => change({ ignoreCtrl: value })} />
    </View>
    <View accessible style={{ padding: theme.spacing(3), borderRadius: theme.radius.medium, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
     <Text style={{ color: c.textMuted, fontSize: 14, marginBottom: theme.spacing(2) }}>{k.formPreview}</Text>
     <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing(3) }}>
      <View style={{ minWidth: 64, height: 44, paddingHorizontal: theme.spacing(2), borderRadius: 22, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceRaised, alignItems: "center", justifyContent: "center" }}>
       <Text numberOfLines={1} style={{ color: c.accentText, fontFamily: theme.font.mono, fontWeight: "700", fontSize: 12 }}>{name || "…"}</Text>
      </View>
      <Text style={{ flex: 1, color: c.textMuted, fontSize: 14 }}>{preview ? form.enter ? k.previewHolds(preview) : k.previewSends(preview) : k.problems.textEmpty}</Text>
     </View>
    </View>
    {/* S5: always visible, never dismissable. */}
    <View accessible style={{ flexDirection: "row", gap: theme.spacing(2), padding: theme.spacing(3), borderRadius: theme.radius.medium, borderWidth: 1, borderColor: c.attention, backgroundColor: c.surfaceRaised }}>
     <Ionicons name="warning-outline" size={22} color={c.attention} />
     <Text style={{ flex: 1, color: c.text, fontSize: 14, lineHeight: 20 }}><Text style={{ fontWeight: "700", color: c.attention }}>{k.warningTitle}</Text> {k.warning}</Text>
    </View>
    <View style={{ flexDirection: "row", gap: theme.spacing(2) }}>
     <Ionicons name="information-circle-outline" size={22} color={c.textMuted} />
     <Text style={{ flex: 1, color: c.textMuted, fontSize: 14, lineHeight: 20 }}>{k.global}</Text>
    </View>
    {initial.id && remove ? <Pressable accessibilityRole="button" onPress={confirmRemove} style={{ minHeight: theme.touch, flexDirection: "row", alignItems: "center", gap: theme.spacing(2) }}>
     <Ionicons name="trash-outline" size={20} color={c.danger} />
     <Text style={{ color: c.danger, fontSize: 16 }}>{k.delete}</Text>
    </Pressable> : null}
   </ScrollView>
  </Screen>
 </Modal>;
}
