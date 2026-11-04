import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import type { SavedHost } from "../../core/host-catalog";
import type { LinkHistoryItem } from "../../core/links";
import { Card, EmptyState, PrimaryButton, Screen, SectionTitle } from "../../ui/components";
import { formatDateTime } from "../../ui/format";
import { usePreferences } from "../../ui/preferences";
import { linkDisplayName, linkRow, linkSize } from "../../ui/private-links";
import { usePrivateLinks } from "../../ui/use-private-links";

export default function FilesScreen() {
 const { theme, t } = usePreferences();
 const c = theme.colors;
 const state = usePrivateLinks();
 const [details, setDetails] = useState(false);
 const [sourceMenu, setSourceMenu] = useState(false);
 // Only a pull by hand shows the pull-to-refresh spinner; focus and polling reloads use the inline loading row.
 const [pulling, setPulling] = useState(false);
 useEffect(() => { if (!state.refreshing) setPulling(false); }, [state.refreshing]);
 const actionStyle = { minHeight: 48, justifyContent: "center" as const, paddingHorizontal: 12 };
 const error = state.error;
 useEffect(() => setDetails(false), [error]);
 const errorText = error ? error.key === "noImage" || error.key === "cameraDenied" || error.key === "sourceFailed" ? t.attachments[error.key] : t.files[error.key] : null;
 const remove = (host: SavedHost, item: LinkHistoryItem) => {
  if (linkRow(item, Date.now()).confirmRemoval) Alert.alert(t.files.removeTitle, t.files.removeBody, [
   { text: t.files.cancel, style: "cancel" },
   { text: t.files.remove, style: "destructive", onPress: () => { void state.remove(host, item); } },
  ]);
  else void state.remove(host, item);
 };
 return <Screen title={t.files.title}>
  <ScrollView refreshControl={<RefreshControl refreshing={pulling && state.refreshing} onRefresh={() => { setPulling(true); state.reload(); }} tintColor={c.accentText} colors={[c.accentText]} progressBackgroundColor={c.surfaceRaised} />} contentContainerStyle={{ paddingBottom: theme.spacing(4) }}>
  <View style={{ padding: theme.spacing(4) }}>
  {state.hosts && state.hosts.length > 0 ? <>
   <Text style={{ color: c.textMuted }}>{t.files.computer}</Text>
   {state.hosts.length > 1 ? <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
    {state.hosts.map(host => <Pressable key={host.id} accessibilityRole="button" accessibilityLabel={host.name} accessibilityState={{ selected: state.selected === host.id, disabled: !!state.busy }} disabled={!!state.busy} onPress={() => state.chooseComputer(host.id)} style={{ ...actionStyle, backgroundColor: state.selected === host.id ? c.accent : c.surfaceRaised, borderRadius: 12 }}><Text style={{ color: state.selected === host.id ? c.onAccent : c.text }}>{host.name}</Text></Pressable>)}
   </ScrollView> : <Text style={{ color: c.text }}>{state.hosts[0]?.name}</Text>}
   <PrimaryButton label={t.files.create} disabled={!!state.busy || state.refreshing} onPress={() => setSourceMenu(true)} />
  </> : null}
  {state.busy ? <Text accessibilityLiveRegion="polite" style={{ color: c.text }}>{t.files[state.busy]}</Text> : null}
 </View>
   {errorText ? <Card>
    <Text accessibilityRole="alert" style={{ color: c.danger }}>{errorText}</Text>
    {error?.detail ? <>
     <Pressable accessibilityRole="button" accessibilityLabel={t.files.details} accessibilityState={{ expanded: details }} onPress={() => setDetails(!details)} style={actionStyle}><Text style={{ color: c.accentText }}>{t.files.details}</Text></Pressable>
     {details ? <Text selectable style={{ color: c.textMuted }}>{error.detail}</Text> : null}
    </> : null}
   </Card> : null}
   {state.copied ? <Text accessibilityLiveRegion="polite" style={{ color: c.accentText, padding: 16 }}>{t.files.copied}</Text> : null}
   {state.hosts === null && !error ? <EmptyState message={t.files.loading} /> : state.hosts?.length === 0 ? <EmptyState message={t.sessions.noComputers} hint={t.sessions.noComputersHint} /> : null}
   {state.refreshing ? <View style={{ padding: 16 }}><ActivityIndicator color={c.accentText} /><Text style={{ color: c.textMuted }}>{t.files.loading}</Text></View> : null}
   {state.hosts?.length && !state.refreshing && !error && state.groups.every(group => group.items.length === 0) ? <EmptyState message={t.files.empty} hint={t.files.emptyHint} /> : null}
   {state.groups.filter(group => group.items.length > 0).map(group => <View key={group.host.id}>
    <SectionTitle>{group.host.name}</SectionTitle>
    {group.items.map(item => {
     const row = linkRow(item, state.now);
     const displayName = linkDisplayName(item.fileName);
     return <Card key={item.id}>
      <Text style={{ color: c.text, fontSize: 16, fontWeight: "600" }}>{displayName}</Text>
      <Text style={{ color: c.textMuted }}>{linkSize(item.size)} · {formatDateTime(Date.parse(item.createdAt))}</Text>
      <Text style={{ color: row.status === "valid" ? c.textMuted : c.danger }}>{row.status === "valid" ? row.hours !== null ? t.files.expiresIn(row.hours) : t.files.expiresInMinutes(row.minutes!) : t.files[row.status]}</Text>
      {row.url ? <>
       <Text selectable style={{ color: c.text }}>{row.url}</Text>
       <Pressable accessibilityRole="button" accessibilityLabel={`${t.files.copyLink}: ${displayName}`} disabled={state.refreshing || !!state.busy} onPress={() => { void state.copy(item); }} style={actionStyle}><Text style={{ color: c.accentText }}>{t.files.copyLink}</Text></Pressable>
      </> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={t.files.removeLabel(displayName)} accessibilityState={{ disabled: !row.canRemove || !!state.busy || state.refreshing }} disabled={!row.canRemove || !!state.busy || state.refreshing} onPress={() => remove(group.host, item)} style={{ ...actionStyle, opacity: !row.canRemove || !!state.busy || state.refreshing ? 0.4 : 1 }}><Text style={{ color: c.danger }}>{t.files.remove}</Text></Pressable>
     </Card>;
    })}
   </View>)}
   <Pressable accessibilityRole="button" accessibilityLabel={t.files.refresh} disabled={!!state.busy || state.refreshing} onPress={state.reload} style={actionStyle}><Text style={{ color: c.accentText }}>{t.files.refresh}</Text></Pressable>
  </ScrollView>
  <Modal visible={sourceMenu} transparent animationType="slide" onRequestClose={() => setSourceMenu(false)}>
   <View style={{ flex: 1, justifyContent: "center", padding: theme.spacing(4) }}>
    <View accessibilityViewIsModal style={{ backgroundColor: c.surface, borderRadius: theme.radius.medium, padding: theme.spacing(4), borderWidth: 1, borderColor: c.border }}>
     <Text accessibilityRole="header" style={{ color: c.text, fontSize: 20 }}>{t.files.create}</Text>
     {(["gallery", "camera", "clipboard", "files"] as const).map(source => <Pressable key={source} accessibilityRole="button" onPress={() => { setSourceMenu(false); void state.select(source); }} style={actionStyle}><Text style={{ color: c.accentText }}>{t.attachments[source]}</Text></Pressable>)}
     <Pressable accessibilityRole="button" onPress={() => setSourceMenu(false)} style={actionStyle}><Text style={{ color: c.text }}>{t.files.cancel}</Text></Pressable>
    </View>
   </View>
  </Modal>
  <Modal visible={state.candidates.length > 0} transparent animationType="slide" onRequestClose={state.cancelSelection}>
   <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#0008" }}>
    <View accessibilityViewIsModal style={{ maxHeight: "80%", backgroundColor: c.surface, padding: 16 }}>
     <Text accessibilityRole="header" style={{ color: c.text, fontSize: 20 }}>{t.files.chooseOne}</Text>
     <ScrollView>{state.candidates.map(file => <Pressable key={file.id} accessibilityRole="button" accessibilityLabel={file.displayName} onPress={() => { void state.upload(file); }} style={actionStyle}><Text style={{ color: c.accentText }}>{file.displayName} · {file.size === null ? t.attachments.unknownSize : linkSize(file.size)}</Text></Pressable>)}</ScrollView>
     <Pressable accessibilityRole="button" accessibilityLabel={t.files.cancel} onPress={state.cancelSelection} style={actionStyle}><Text style={{ color: c.accentText }}>{t.files.cancel}</Text></Pressable>
    </View>
   </View>
  </Modal>
 </Screen>;
}
