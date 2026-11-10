// Ajustes › Terminal › «Personalizar teclas» (artboard 01): the bar or the D-pad as they will look on top, the
// catalog below. Hold and drag a key onto the preview, or tap it; edits stay in a draft until «Guardar cambios».
import { useEffect, useReducer, useRef, useState, type ComponentProps, type ComponentRef } from "react";
import { Alert, Animated, BackHandler, Modal, PanResponder, Pressable, ScrollView, Text, View, type GestureResponderEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { FIXED_BAR_KEYS, addToBar, saveCustom, terminalKeyInfo, type KeyId, type TerminalKeyInfo } from "../core/terminal-keys";
import { terminalKeys } from "../services";
import { PrimaryButton, Screen, Segmented } from "./components";
import { CustomButtonForm } from "./custom-button-form";
import { usePreferences } from "./preferences";
import { KeyFace } from "./terminal-key-face";
import { customButtonOf, keyChip, keyName, padKeyFace } from "./terminal-key-view";
import {
 barInsertIndex, barMeter, catalogGroups, draftChanged, draftReducer, dropAction, inside, meterWith, padSlotAt, refusalMessage, startDraft,
 type CustomForm, type DraftAction, type DragSource, type DropTarget, type Rect,
} from "./terminal-keys-draft";

type Tab = "bar" | "pad";
type Selection = { where: "bar"; id: KeyId } | { where: "pad"; slot: number } | null;
type IconName = ComponentProps<typeof Ionicons>["name"];
type ViewRef = ComponentRef<typeof View>;
const isFixed = (id: KeyId) => (FIXED_BAR_KEYS as readonly string[]).includes(id);
const DRAG_DELAY = 300;
const SLOT = 64;

export function TerminalKeysEditor({ close }: { close: () => void }) {
 const { theme, t } = usePreferences(); const k = t.terminalKeys; const s = t.terminal; const c = theme.colors;
 const insets = useSafeAreaInsets();
 const [state, dispatch] = useReducer(draftReducer, undefined, () => startDraft(terminalKeys.get()));
 const draft = state.draft; const changed = draftChanged(state);
 const [tab, setTab] = useState<Tab>("bar");
 const [selected, setSelected] = useState<Selection>(null);
 const [sheet, setSheet] = useState<KeyId | null>(null);
 const [placing, setPlacing] = useState<KeyId | null>(null);
 const [form, setForm] = useState<CustomForm | null>(null);
 const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "failed">("idle");
 const [drag, setDrag] = useState<{ source: DragSource; target: DropTarget } | null>(null);
 const latest = useRef(state); latest.current = state;

 const edit = (action: DraftAction) => { setSaving("idle"); dispatch(action); };
 const leave = () => {
  if (!changed) { close(); return; }
  Alert.alert(k.discardTitle, k.discardBody, [{ text: k.keepEditing, style: "cancel" }, { text: k.discard, style: "destructive", onPress: close }]);
 };
 const leaveRef = useRef(leave); leaveRef.current = leave;
 useEffect(() => { const back = BackHandler.addEventListener("hardwareBackPress", () => { leaveRef.current(); return true; }); return () => back.remove(); }, []);
 const save = () => {
  if (saving === "saving") return;
  setSaving("saving");
  terminalKeys.set(draft).then(() => { dispatch({ type: "saved", layout: terminalKeys.get() }); setSaving("saved"); }, () => setSaving("failed"));
 };
 const askRestore = () => Alert.alert(k.restoreTitle, k.restoreBody, [
  { text: k.cancel, style: "cancel" },
  { text: k.restoreConfirm, onPress: () => { setSelected(null); setPlacing(null); edit({ type: "restore" }); } },
 ]);
 const changeTab = (next: Tab) => { setTab(next); setSelected(null); setPlacing(null); };

 // Tap alternative: catalog key → sheet → bar (then «Mover») or a D-pad place.
 const tapCatalog = (id: KeyId) => {
  if (tab === "pad" && selected?.where === "pad" && terminalKeyInfo(draft, id)?.pad) { edit({ type: "setSlot", slot: selected.slot, id }); setSelected(null); return; }
  setSheet(id);
 };
 const addBar = (id: KeyId) => {
  const fits = addToBar(draft, id).ok;
  edit({ type: "addBar", id }); setSheet(null);
  if (fits) { setTab("bar"); setPlacing(null); setSelected({ where: "bar", id }); }
 };
 const putOnPad = (id: KeyId) => { setSheet(null); setTab("pad"); setSelected(null); setPlacing(id); };
 const tapSlot = (slot: number) => {
  if (placing) { edit({ type: "setSlot", slot, id: placing }); setPlacing(null); return; }
  setSelected(current => current?.where === "pad" && current.slot === slot ? null : { where: "pad", slot });
 };
 const tapBarKey = (id: KeyId) => setSelected(current => current?.where === "bar" && current.id === id ? null : { where: "bar", id });
 const nudge = (id: KeyId, by: -1 | 1) => edit({ type: "nudge", id, by });

 // Drag: a long press arms it, then the root takes the touch over (the catalog stops scrolling meanwhile).
 const root = useRef<ViewRef>(null), barRef = useRef<ViewRef>(null);
 const keyRefs = useRef(new Map<KeyId, ViewRef>()), slotRefs = useRef<(ViewRef | null)[]>([]);
 const zones = useRef<{ root: Rect; bar: Rect | null; keys: Rect[]; slots: Rect[] } | null>(null);
 const dragging = useRef<{ source: DragSource; target: DropTarget; active: boolean } | null>(null);
 const ghost = useRef(new Animated.ValueXY()).current;
 const measure = (view: ViewRef | null | undefined) => new Promise<Rect | null>(resolve => {
  if (!view) { resolve(null); return; }
  view.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
 });
 async function startDrag(source: DragSource, event: GestureResponderEvent) {
  const { pageX, pageY } = event.nativeEvent;
  dragging.current = { source, target: null, active: false };
  setSelected(null); setPlacing(null); setDrag({ source, target: null });
  const bar = latest.current.draft.bar;
  const [rootRect, barRect, ...rest] = await Promise.all([measure(root.current), measure(barRef.current), ...bar.map(id => measure(keyRefs.current.get(id))), ...Array.from({ length: 9 }, (_, slot) => measure(slotRefs.current[slot]))]);
  if (!rootRect || dragging.current?.source !== source) return;
  const keys = rest.slice(0, bar.length), slots = rest.slice(bar.length);
  zones.current = { root: rootRect, bar: barRect && keys.every(Boolean) ? barRect : null, keys: keys.filter((r): r is Rect => r !== null), slots: slots.map(r => r ?? { x: -1, y: -1, width: 0, height: 0 }) };
  ghost.setValue({ x: pageX - rootRect.x - 32, y: pageY - rootRect.y - 64 });
 }
 const move = (x: number, y: number) => {
  const z = zones.current, d = dragging.current;
  if (!z || !d) return;
  ghost.setValue({ x: x - z.root.x - 32, y: y - z.root.y - 64 });
  const point = { x, y };
  const target: DropTarget = z.bar && inside({ x: z.bar.x, y: z.bar.y - 24, width: z.bar.width, height: z.bar.height + 48 }, point) ? { bar: barInsertIndex(z.keys, x) }
   : padSlotAt(z.slots, point) !== null ? { slot: padSlotAt(z.slots, point)! } : null;
  if (JSON.stringify(target) !== JSON.stringify(d.target)) { d.target = target; setDrag({ source: d.source, target }); }
 };
 const finish = (drop: boolean) => {
  const d = dragging.current;
  dragging.current = null; zones.current = null; setDrag(null);
  if (!d || !drop) return;
  const action = dropAction(latest.current.draft, d.source, d.target);
  if (action) edit(action);
 };
 const handlers = useRef({ move, finish }); handlers.current = { move, finish };
 const responder = useRef(PanResponder.create({
  onMoveShouldSetPanResponderCapture: () => dragging.current !== null,
  onMoveShouldSetPanResponder: () => dragging.current !== null,
  onPanResponderGrant: () => { if (dragging.current) dragging.current.active = true; },
  onPanResponderMove: (_event, gesture) => handlers.current.move(gesture.moveX, gesture.moveY),
  onPanResponderRelease: () => handlers.current.finish(true),
  onPanResponderTerminate: () => handlers.current.finish(false),
  onPanResponderTerminationRequest: () => false,
 })).current;
 // A long press released without moving is not a drag.
 const pressOut = () => { setTimeout(() => { if (dragging.current && !dragging.current.active) handlers.current.finish(false); }, 0); };

 const meter = barMeter(draft);
 const dragged = drag ? terminalKeyInfo(draft, drag.source.id) : null;
 const predicted = drag?.source.from === "catalog" && tab === "bar" ? meterWith(draft, drag.source.id) : null;
 const shown = predicted?.meter ?? meter;
 const levelText = { room: k.room, almost: k.almost, full: k.full }[shown.level];
 const levelColor = predicted && !predicted.fits ? c.danger : shown.level === "room" ? c.accentText : shown.level === "almost" ? c.attention : c.danger;
 const meterText = predicted ? predicted.fits ? k.fits(shown.remaining) : k.noFit : `${levelText} · ${k.free(Math.max(0, meter.remaining))}`;

 const barPreview = <View ref={barRef} collapsable={false} accessibilityLabel={k.previewBar}
  style={{ flexDirection: "row", alignItems: "center", gap: 2, padding: 6, marginHorizontal: 10, borderWidth: 1, borderRadius: 30, borderColor: predicted && !predicted.fits ? c.danger : c.border, backgroundColor: c.surface }}>
  {draft.bar.map((id, index) => {
   const info = terminalKeyInfo(draft, id); if (!info) return null;
   const name = keyName(info, s), fixed = isFixed(id), chosen = selected?.where === "bar" && selected.id === id;
   const target = drag?.target && "bar" in drag.target ? drag.target.bar : null;
   const lifted = drag?.source.from === "bar" && drag.source.id === id;
   return <View key={id} ref={view => { if (view) keyRefs.current.set(id, view); else keyRefs.current.delete(id); }} collapsable={false} style={{ width: info.width, flexGrow: 1, flexShrink: 1, height: 44 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={fixed ? k.fixedKey(name) : name} accessibilityState={{ selected: chosen }}
     accessibilityActions={[{ name: "moveLeft", label: k.moveLeft }, { name: "moveRight", label: k.moveRight }, ...(fixed ? [] : [{ name: "remove", label: k.remove }])]}
     onAccessibilityAction={event => { const action = event.nativeEvent.actionName; if (action === "moveLeft") nudge(id, -1); else if (action === "moveRight") nudge(id, 1); else if (action === "remove") edit({ type: "removeBar", id }); }}
     onPress={() => tapBarKey(id)} onLongPress={event => { void startDrag({ from: "bar", id }, event); }} delayLongPress={DRAG_DELAY} onPressOut={pressOut} hitSlop={{ top: 4, bottom: 4 }}
     style={{ flex: 1, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: chosen ? c.accent : c.surfaceRaised, opacity: lifted ? 0.35 : 1,
      borderLeftWidth: target === index ? 3 : 0, borderRightWidth: target === draft.bar.length && index === draft.bar.length - 1 ? 3 : 0, borderColor: c.accentText }}>
     <KeyFace info={info} />
     {fixed ? <View pointerEvents="none" style={{ position: "absolute", top: 1, right: 2 }}><Ionicons name="lock-closed" size={10} color={c.textMuted} /></View> : null}
    </Pressable>
   </View>;
  })}
 </View>;

 const padPreview = <View accessibilityLabel={k.previewPad} style={{ alignSelf: "center", width: SLOT * 3 + 16, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
  {draft.pad.map((id, slot) => {
   const info = id ? terminalKeyInfo(draft, id) : null, face = info ? padKeyFace(info) : null;
   const chosen = selected?.where === "pad" && selected.slot === slot;
   const target = placing !== null || (drag?.target && "slot" in drag.target && drag.target.slot === slot);
   return <Pressable key={slot} ref={view => { slotRefs.current[slot] = view; }} collapsable={false} accessibilityRole="button"
    accessibilityLabel={k.slot(k.slots[slot], info ? keyName(info, s) : null)} accessibilityState={{ selected: chosen }}
    onPress={() => tapSlot(slot)} onLongPress={id ? event => { void startDrag({ from: "pad", id, slot }, event); } : undefined} delayLongPress={DRAG_DELAY} onPressOut={pressOut}
    style={{ width: SLOT, height: SLOT, borderRadius: SLOT / 2, alignItems: "center", justifyContent: "center", borderWidth: target || chosen ? 2 : 1, borderStyle: info ? "solid" : "dashed",
     borderColor: target || chosen ? c.accentText : c.border, backgroundColor: face?.accent ? c.accent : info ? c.surfaceRaised : "transparent", opacity: drag?.source.from === "pad" && drag.source.slot === slot ? 0.35 : 1 }}>
    {info && face ? <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ color: face.accent ? c.onAccent : info.kind === "custom" ? c.accentText : c.text, fontSize: face.size, fontWeight: "700", paddingHorizontal: 4 }}>{face.glyph}</Text>
     : <Text style={{ color: c.textMuted, fontSize: 12 }}>{target ? k.dropHere : k.emptySlot}</Text>}
   </Pressable>;
  })}
 </View>;

 const action = (label: string, icon: IconName, onPress: (() => void) | null, tone = c.accentText) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !onPress }} disabled={!onPress} onPress={onPress ?? undefined}
  style={{ minHeight: theme.touch, flexGrow: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: theme.spacing(3), borderRadius: theme.radius.medium, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceRaised }}>
  <Ionicons name={icon} size={18} color={onPress ? tone : c.textMuted} />
  <Text style={{ color: onPress ? c.text : c.textMuted, fontSize: 14 }}>{label}</Text>
 </Pressable>;
 let actions = null;
 if (selected?.where === "bar" && draft.bar.includes(selected.id)) {
  const id = selected.id, index = draft.bar.indexOf(id);
  actions = <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
   {action(k.moveLeft, "arrow-back", index > 0 ? () => nudge(id, -1) : null)}
   {action(k.moveRight, "arrow-forward", index < draft.bar.length - 1 ? () => nudge(id, 1) : null)}
   {isFixed(id) ? action(k.fixed, "lock-closed", null) : action(k.remove, "remove-circle-outline", () => { setSelected(null); edit({ type: "removeBar", id }); }, c.danger)}
  </View>;
 } else if (selected?.where === "pad") {
  const slot = selected.slot;
  actions = draft.pad[slot] ? <View style={{ flexDirection: "row", gap: 8 }}>{action(k.clearSlot, "remove-circle-outline", () => { setSelected(null); edit({ type: "setSlot", slot, id: null }); }, c.danger)}</View>
   : <Text style={{ color: c.textMuted, fontSize: 14 }}>{k.pickForSlot}</Text>;
 } else if (placing) {
  const info = terminalKeyInfo(draft, placing);
  actions = <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
   <Text accessibilityLiveRegion="polite" style={{ flex: 1, color: c.text, fontSize: 14 }}>{k.chooseSlot(info ? keyChip(info, s) : "")}</Text>
   {action(k.cancel, "close", () => setPlacing(null), c.text)}
  </View>;
 }

 const chip = (info: TerminalKeyInfo) => {
  const placed = tab === "bar" ? draft.bar.includes(info.id) : draft.pad.includes(info.id);
  const usable = tab === "bar" ? info.bar : info.pad, name = keyChip(info, s);
  const moving = drag?.source.from === "catalog" && drag.source.id === info.id;
  return <Pressable key={info.id} accessibilityRole="button" accessibilityLabel={placed ? `${name}, ${tab === "bar" ? k.inBar : k.inPad}` : name} accessibilityState={{ selected: placed }}
   onPress={() => tapCatalog(info.id)} onLongPress={usable && !placed ? event => { void startDrag({ from: "catalog", id: info.id }, event); } : undefined} delayLongPress={DRAG_DELAY} onPressOut={pressOut}
   style={{ minHeight: theme.touch, minWidth: theme.touch, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: theme.touch / 2, borderWidth: 1, borderColor: placed ? c.accentText : c.border, backgroundColor: c.surfaceRaised, opacity: moving ? 0.35 : 1 }}>
   {placed ? <Ionicons name="checkmark" size={16} color={c.accentText} /> : null}
   <Text style={{ color: !usable ? c.textMuted : info.kind === "custom" ? c.accentText : c.text, fontSize: 15, fontFamily: info.kind === "custom" ? theme.font.mono : undefined }}>{name}</Text>
  </Pressable>;
 };

 const sheetInfo = sheet ? terminalKeyInfo(draft, sheet) : null;
 const option = (label: string, icon: IconName, onPress: (() => void) | null, detail?: string, detailColor = c.textMuted) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={detail ? `${label}. ${detail}` : label} accessibilityState={{ disabled: !onPress }} disabled={!onPress} onPress={onPress ?? undefined}
  style={{ minHeight: theme.touch, flexDirection: "row", alignItems: "center", gap: theme.spacing(3), paddingVertical: theme.spacing(2) }}>
  <Ionicons name={icon} size={22} color={onPress ? c.accentText : c.textMuted} />
  <View style={{ flex: 1 }}>
   <Text style={{ color: onPress ? c.text : c.textMuted, fontSize: 16 }}>{label}</Text>
   {detail ? <Text style={{ color: detailColor, fontSize: 14 }}>{detail}</Text> : null}
  </View>
 </Pressable>;
 let sheetOptions = null;
 if (sheetInfo) {
  const id = sheetInfo.id, inBar = draft.bar.includes(id), prediction = meterWith(draft, id);
  sheetOptions = <>
   {!sheetInfo.bar ? null : isFixed(id) ? option(k.alreadyInBar, "lock-closed", null, k.fixed)
    : inBar ? option(k.removeFromBar, "remove-circle-outline", () => { setSheet(null); edit({ type: "removeBar", id }); }, k.inBar)
    : option(k.addToBar, "add-circle-outline", () => addBar(id), prediction.fits ? k.fits(prediction.meter!.remaining) : k.noFit, prediction.fits ? c.textMuted : c.danger)}
   {sheetInfo.pad ? option(k.putOnPad, "grid-outline", () => putOnPad(id), draft.pad.includes(id) ? k.inPad : k.padReplace) : <Text style={{ color: c.textMuted, fontSize: 14, paddingVertical: theme.spacing(2) }}>{k.barOnly}</Text>}
   {sheetInfo.kind === "custom" ? option(k.edit, "create-outline", () => { const b = customButtonOf(draft, id); setSheet(null); if (b) setForm({ id: b.id, name: b.name, text: b.text, enter: b.enter }); }) : null}
   {option(k.cancel, "close", () => setSheet(null))}
  </>;
 }

 const removing = drag && drag.source.from !== "catalog" && dragged ? drag.target === null : false;
 const footer = <View style={{ paddingBottom: Math.max(insets.bottom, theme.spacing(1)), borderTopWidth: 1, borderColor: c.border, backgroundColor: c.background }}>
  {saving === "saved" ? <Text accessibilityLiveRegion="polite" style={{ color: c.accentText, marginHorizontal: theme.spacing(4), marginTop: theme.spacing(2) }}>{k.saved}</Text> : null}
  {saving === "failed" ? <Text accessibilityRole="alert" style={{ color: c.danger, marginHorizontal: theme.spacing(4), marginTop: theme.spacing(2) }}>{k.saveFailed}</Text> : null}
  <PrimaryButton label={k.save} onPress={save} disabled={!changed || saving === "saving"} />
 </View>;

 return <Screen footer={footer}>
  <View ref={root} collapsable={false} style={{ flex: 1 }} {...responder.panHandlers}>
   <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing(1), paddingHorizontal: theme.spacing(2), paddingVertical: theme.spacing(2) }}>
    <Pressable accessibilityRole="button" accessibilityLabel={k.back} onPress={leave} style={{ width: theme.touch, height: theme.touch, alignItems: "center", justifyContent: "center" }}>
     <Ionicons name="arrow-back" size={24} color={c.text} />
    </Pressable>
    <Text accessibilityRole="header" style={{ flex: 1, color: c.text, fontSize: 22, fontWeight: "700" }}>{k.title}</Text>
   </View>
   <View style={{ paddingHorizontal: theme.spacing(4), paddingBottom: theme.spacing(3) }}>
    <Segmented<Tab> value={tab} onChange={changeTab} options={[{ value: "bar", label: k.tabs.bar }, { value: "pad", label: k.tabs.pad }]} />
   </View>
   <View style={{ paddingVertical: theme.spacing(3), gap: theme.spacing(2), borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: theme.spacing(4) }}>
     <Text style={{ color: c.text, fontSize: 14, fontWeight: "700" }}>{k.preview}</Text>
     <Text style={{ color: c.textMuted, fontSize: 14 }}>{tab === "bar" ? k.previewHint : k.padHint}</Text>
    </View>
    {tab === "bar" ? <>
     {barPreview}
     <View accessible accessibilityRole="progressbar" accessibilityLabel={predicted && dragged ? k.with(keyChip(dragged, s)) : k.meter} accessibilityValue={{ min: 0, max: 100, now: Math.round(shown.used * 100), text: meterText }} style={{ paddingHorizontal: theme.spacing(4), gap: theme.spacing(1) }}>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: c.surfaceRaised, overflow: "hidden" }}>
       <View style={{ width: `${Math.round(shown.used * 100)}%`, height: 6, borderRadius: 3, backgroundColor: levelColor }} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: theme.spacing(2) }}>
       <Text style={{ color: c.textMuted, fontSize: 14 }}>{predicted && dragged ? k.with(keyChip(dragged, s)) : k.meter}</Text>
       <Text accessibilityLiveRegion="polite" style={{ flexShrink: 1, textAlign: "right", color: levelColor, fontSize: 14 }}>{meterText}</Text>
      </View>
     </View>
    </> : <>
     {padPreview}
     <Text style={{ color: c.textMuted, fontSize: 14, textAlign: "center", paddingHorizontal: theme.spacing(4) }}>{k.padReplace}</Text>
    </>}
    {state.refusal ? <Text accessibilityRole="alert" style={{ color: c.danger, fontSize: 14, paddingHorizontal: theme.spacing(4) }}>{refusalMessage(state.refusal, k)}</Text> : null}
    {actions ? <View style={{ paddingHorizontal: theme.spacing(4) }}>{actions}</View> : null}
   </View>
   <ScrollView scrollEnabled={!drag} keyboardShouldPersistTaps="handled" accessibilityLabel={k.catalog} contentContainerStyle={{ paddingHorizontal: theme.spacing(4), paddingTop: theme.spacing(3), paddingBottom: theme.spacing(6), gap: theme.spacing(2) }}>
    {drag && drag.source.from !== "catalog" && dragged ? <View style={{ minHeight: 72, alignItems: "center", justifyContent: "center", gap: 4, borderRadius: theme.radius.medium, borderWidth: 2, borderStyle: "dashed", borderColor: removing ? c.danger : c.border }}>
     <Ionicons name="trash-outline" size={22} color={removing ? c.danger : c.textMuted} />
     <Text style={{ color: c.text, fontSize: 14 }}>{k.dropRemove(keyChip(dragged, s))}</Text>
    </View> : null}
    <Text style={{ color: c.textMuted, fontSize: 14 }}>{tab === "bar" ? `${k.dragHint} ${k.fixedInfo}` : k.dragHint}</Text>
    {catalogGroups(draft).map(({ group, keys }) => <View key={group} style={{ gap: theme.spacing(2), marginTop: theme.spacing(2) }}>
     <Text accessibilityRole="header" style={{ color: c.textMuted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 }}>{k.groups[group]}{group === "herdr" ? <Text style={{ textTransform: "none", fontWeight: "400" }}>{` · ${k.herdrNote}`}</Text> : null}</Text>
     <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {keys.map(chip)}
      {group === "custom" ? <Pressable accessibilityRole="button" accessibilityLabel={k.create} onPress={() => setForm({ id: null, name: "", text: "", enter: false })}
       style={{ minHeight: theme.touch, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: theme.touch / 2, borderWidth: 1, borderStyle: "dashed", borderColor: c.accentText }}>
       <Ionicons name="add" size={18} color={c.accentText} />
       <Text style={{ color: c.accentText, fontSize: 15 }}>{k.create}</Text>
      </Pressable> : null}
     </View>
     {group === "custom" && keys.length === 0 ? <Text style={{ color: c.textMuted, fontSize: 14 }}>{k.noCustom}</Text> : null}
    </View>)}
    <Pressable accessibilityRole="button" onPress={askRestore} style={{ minHeight: theme.touch, flexDirection: "row", alignItems: "center", gap: theme.spacing(2), marginTop: theme.spacing(4) }}>
     <Ionicons name="arrow-undo-outline" size={20} color={c.accentText} />
     <Text style={{ color: c.accentText, fontSize: 16 }}>{k.restore}</Text>
    </Pressable>
   </ScrollView>
   {drag && dragged ? <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, transform: ghost.getTranslateTransform(), minWidth: 64, height: 48, paddingHorizontal: 12, borderRadius: 24, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.accentText, backgroundColor: c.surfaceRaised, elevation: 6 }}>
    <KeyFace info={dragged} />
   </Animated.View> : null}
  </View>
  <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
   <Pressable accessibilityRole="button" accessibilityLabel={k.cancel} onPress={() => setSheet(null)} style={{ flex: 1, backgroundColor: "#0008" }} />
   {sheetInfo ? <View accessibilityViewIsModal style={{ padding: theme.spacing(4), paddingBottom: theme.spacing(4) + insets.bottom, borderTopLeftRadius: theme.radius.large, borderTopRightRadius: theme.radius.large, borderTopWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
    <Text accessibilityRole="header" style={{ color: c.text, fontSize: 20, fontWeight: "700", marginBottom: theme.spacing(2) }}>{keyChip(sheetInfo, s)}</Text>
    {sheetOptions}
   </View> : null}
  </Modal>
  {form ? <CustomButtonForm visible initial={form} layout={draft} close={() => setForm(null)}
   submit={button => { const result = saveCustom(draft, button); if (!result.ok) return result.reason; edit({ type: "saveCustom", button }); setForm(null); return null; }}
   remove={form.id ? () => { edit({ type: "deleteCustom", id: form.id! }); setForm(null); } : undefined} /> : null}
 </Screen>;
}
