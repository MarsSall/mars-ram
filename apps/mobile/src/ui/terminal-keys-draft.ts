// Ajustes › Personalizar teclas: the editor's local draft (saved only by «Guardar»), its meter, catalog and drag rules.
import { TOOLBAR_BUDGET } from "../core/terminal-controls";
import {
 CUSTOM_LIMITS, TERMINAL_KEY_CATALOG, addToBar, moveInBar, remaining, removeCustom, removeFromBar, restore, saveCustom, serializeTerminalKeys,
 setPadSlot, terminalKeyInfo, type CustomButton, type KeyEdit, type KeyId, type KeyRefusal, type TerminalKeyGroup, type TerminalKeyInfo, type TerminalKeyLayout,
} from "../core/terminal-keys";
import type { Strings } from "./i18n/en";

export type KeysDraft = { saved: TerminalKeyLayout; draft: TerminalKeyLayout; refusal: KeyRefusal | null };
export type DraftAction =
 | { type: "addBar"; id: KeyId; index?: number }
 | { type: "removeBar"; id: KeyId }
 /** `index` is the position after the key is lifted out (as `moveInBar`). */
 | { type: "moveBar"; id: KeyId; index: number }
 | { type: "nudge"; id: KeyId; by: -1 | 1 }
 | { type: "setSlot"; slot: number; id: KeyId | null }
 | { type: "saveCustom"; button: CustomButton }
 | { type: "deleteCustom"; id: string }
 | { type: "restore" }
 | { type: "saved"; layout: TerminalKeyLayout }
 | { type: "dismiss" };

export const startDraft = (layout: TerminalKeyLayout): KeysDraft => ({ saved: layout, draft: layout, refusal: null });
export const draftChanged = (state: KeysDraft) => serializeTerminalKeys(state.draft) !== serializeTerminalKeys(state.saved);

function apply(state: KeysDraft, result: KeyEdit): KeysDraft {
 return result.ok ? { ...state, draft: result.layout, refusal: null } : { ...state, refusal: result.reason };
}
export function draftReducer(state: KeysDraft, action: DraftAction): KeysDraft {
 const draft = state.draft;
 switch (action.type) {
  case "addBar": return apply(state, addToBar(draft, action.id, action.index));
  case "removeBar": return apply(state, removeFromBar(draft, action.id));
  case "moveBar": return apply(state, moveInBar(draft, action.id, action.index));
  case "nudge": {
   const index = draft.bar.indexOf(action.id) + action.by;
   if (index < 0 || index >= draft.bar.length) return { ...state, refusal: null };
   return apply(state, moveInBar(draft, action.id, index));
  }
  case "setSlot": return apply(state, setPadSlot(draft, action.slot, action.id));
  case "saveCustom": return apply(state, saveCustom(draft, action.button));
  case "deleteCustom": return { ...state, draft: removeCustom(draft, action.id), refusal: null };
  case "restore": return { ...state, draft: restore(draft), refusal: null };
  case "saved": return { saved: action.layout, draft: action.layout, refusal: null };
  case "dismiss": return { ...state, refusal: null };
 }
}

export const refusalMessage = (reason: KeyRefusal, k: Strings["terminalKeys"]) => k.refusals[reason];

/** Room the narrowest catalog key (an arrow) needs, gap included. */
const NARROWEST = 20 + TOOLBAR_BUDGET.gap;
const ROOM = TOOLBAR_BUDGET.screen - TOOLBAR_BUDGET.chrome;
export type BarMeter = { remaining: number; used: number; level: "room" | "almost" | "full" };
/** «Sin espacio» when not even an arrow fits; «Casi llena» when only one more narrow key does. */
export function barMeter(layout: TerminalKeyLayout): BarMeter {
 const left = remaining(layout);
 return { remaining: left, used: Math.min(1, Math.max(0, 1 - left / ROOM)), level: left < NARROWEST ? "full" : left < NARROWEST * 2 + 4 ? "almost" : "room" };
}
/** The meter as it would be with `id` added; a key that doesn't fit (or is already there) is never dropped. */
export function meterWith(layout: TerminalKeyLayout, id: KeyId): { fits: boolean; meter: BarMeter | null } {
 const result = addToBar(layout, id);
 return result.ok ? { fits: true, meter: barMeter(result.layout) } : { fits: false, meter: null };
}

export const KEY_GROUPS: readonly TerminalKeyGroup[] = ["tools", "basic", "navigation", "combos", "functions", "herdr", "custom"];
export function catalogGroups(layout: TerminalKeyLayout): { group: TerminalKeyGroup; keys: TerminalKeyInfo[] }[] {
 const custom = layout.custom.flatMap(b => terminalKeyInfo(layout, `custom:${b.id}`) ?? []);
 return KEY_GROUPS.map(group => ({ group, keys: group === "custom" ? custom : TERMINAL_KEY_CATALOG.filter(key => key.group === group) }));
}

export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };
export const inside = (rect: Rect, point: Point) => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
/** Insert before the first key whose centre is right of the finger. */
export function barInsertIndex(keys: readonly Rect[], x: number): number {
 const index = keys.findIndex(rect => x < rect.x + rect.width / 2);
 return index < 0 ? keys.length : index;
}
export function padSlotAt(slots: readonly Rect[], point: Point): number | null {
 const index = slots.findIndex(rect => inside(rect, point));
 return index < 0 ? null : index;
}
export type DragSource = { from: "catalog"; id: KeyId } | { from: "bar"; id: KeyId } | { from: "pad"; id: KeyId; slot: number };
export type DropTarget = { bar: number } | { slot: number } | null;
/** A drop does exactly what the tap alternative does. Dropping a placed key outside its preview takes it out. */
export function dropAction(layout: TerminalKeyLayout, source: DragSource, target: DropTarget): DraftAction | null {
 if (target && "bar" in target) {
  if (source.from !== "bar") return { type: "addBar", id: source.id, index: target.bar };
  const from = layout.bar.indexOf(source.id);
  return { type: "moveBar", id: source.id, index: from >= 0 && target.bar > from ? target.bar - 1 : target.bar };
 }
 if (target && "slot" in target) return source.from === "bar" ? null : { type: "setSlot", slot: target.slot, id: source.id };
 if (source.from === "bar") return { type: "removeBar", id: source.id };
 if (source.from === "pad") return { type: "setSlot", slot: source.slot, id: null };
 return null;
}

/** Without `ignoreCtrl` the form reads it from the edited button, or starts it on for a new one. */
export type CustomForm = { id: string | null; name: string; text: string; enter: boolean; ignoreCtrl?: boolean };
export type FormProblems = { name: "empty" | "long" | "invalid" | null; text: "empty" | "long" | "invalid" | null };
/** The same limits `saveCustom` enforces, named per field for the form. */
export function customFormProblems(form: CustomForm): FormProblems {
 const name = form.name.trim();
 return {
  name: !name ? "empty" : Array.from(name).length > CUSTOM_LIMITS.name ? "long" : /[\u0000-\u001f\u007f]/.test(form.name) ? "invalid" : null,
  text: !form.text ? "empty" : Array.from(form.text).length > CUSTOM_LIMITS.text ? "long" : form.text.includes("\u0000") ? "invalid" : null,
 };
}
/** A short id never used by another button of this layout. */
export function newCustomId(layout: TerminalKeyLayout, random: () => number = Math.random, now: () => number = Date.now): string {
 for (;;) {
  const id = `k${Math.floor(now()).toString(36)}${Math.floor(random() * 1_679_616).toString(36)}`;
  if (!layout.custom.some(b => b.id === id)) return id;
 }
}
export function formIgnoresCtrl(form: CustomForm, layout: TerminalKeyLayout): boolean {
 return form.ignoreCtrl ?? layout.custom.find(b => b.id === form.id)?.ignoreCtrl ?? true;
}
export function formButton(form: CustomForm, layout: TerminalKeyLayout, random?: () => number, now?: () => number): CustomButton {
 return { id: form.id ?? newCustomId(layout, random, now), name: form.name.trim(), text: form.text, enter: form.enter, ignoreCtrl: formIgnoresCtrl(form, layout) };
}
