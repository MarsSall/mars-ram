// The user's terminal keys (bar + D-pad + own buttons): one global layout, pure rules only.
import { terminalPadLayout, terminalToolbarKeys, terminalToolbarRowWidth, terminalToolbarWidth, TOOLBAR_BUDGET, type TerminalToolbarKey } from "./terminal-controls";
import { terminalKey } from "./herdr-terminal";
import { herdrKeyBytes, type HerdrKeys } from "./herdr-keys";

type CtrlLetter = "a" | "c" | "d" | "e" | "k" | "l" | "r" | "u" | "w" | "z";
type FunctionNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export type CatalogKeyId = TerminalToolbarKey | "home" | "end" | "pageUp" | "pageDown" | "space"
 | `ctrl+${CtrlLetter}` | "alt+b" | "alt+f" | `f${FunctionNumber}` | "previousAgent" | "nextAgent";
/** A custom button on the bar or pad is `custom:<button id>`. */
export type KeyId = CatalogKeyId | `custom:${string}`;
/** control: the screen handles it (attach, Ctrl, PREFIX, clipboard, mic, ✥, keyboard); key: `terminalKey(send.key)`;
 * herdr: `herdrKeyBytes(send.spec)` or the computer's Herdr binding with its prefix; custom: `customBytes`. */
export type TerminalKeyKind = "control" | "key" | "herdr" | "custom";
export type TerminalKeyGroup = "tools" | "basic" | "navigation" | "combos" | "functions" | "herdr" | "custom";
export type KeySend = { key: string } | { spec: string } | { binding: "previous_agent" | "next_agent" } | null;
/** `i18n` names a `terminal` string (T2 adds the missing ones); `text` is language-neutral. */
export type KeyAccessibleName = { i18n: string } | { text: string };
export type TerminalKeyInfo = {
 id: KeyId; kind: TerminalKeyKind; group: TerminalKeyGroup; label: string; accessible: KeyAccessibleName;
 /** Minimum dp in the bar, same units as terminalToolbarWidth. */
 width: number; send: KeySend; fixed: boolean; bar: boolean; pad: boolean;
};
/** `ignoreCtrl` («Ignorar Ctrl», on for new buttons): the text goes out as written and an active Ctrl stays for the next key. */
export type CustomButton = { id: string; name: string; text: string; enter: boolean; ignoreCtrl: boolean };
export type TerminalKeyLayout = { v: 1; bar: KeyId[]; pad: (KeyId | null)[]; custom: CustomButton[] };
export type KeyRefusal = "fixed" | "full" | "duplicate" | "unknown" | "missing" | "slot" | "id" | "name" | "text" | "limit";
export type KeyEdit = { ok: true; layout: TerminalKeyLayout } | { ok: false; reason: KeyRefusal };

/** S3: never removable; repaired back into their default place when missing. */
export const FIXED_BAR_KEYS = ["ctrl", "prefix", "keyboard"] as const satisfies readonly KeyId[];
export const CUSTOM_LIMITS = { name: 8, text: 512, buttons: 24 } as const;
/** S5: a button with «Enter al final» sends only after this long a press. */
export const CUSTOM_HOLD_MS = 500;
/** `terminal` string shown when a button with Enter is only tapped («Mantené apretado para enviar»). */
export const CUSTOM_HOLD_HINT = "holdToSend";
export const PAD_SLOTS = 9;
const ARROWS = ["up", "down", "left", "right"] as const;
const MAX_STORED = 131_072;

const control = (id: TerminalToolbarKey, label: string, i18n: string): TerminalKeyInfo =>
 ({ id, kind: "control", group: "tools", label, accessible: { i18n }, width: terminalToolbarWidth(id), send: null, fixed: (FIXED_BAR_KEYS as readonly string[]).includes(id), bar: true, pad: false });
const key = (id: CatalogKeyId, group: TerminalKeyGroup, label: string, i18n: string, send: string, width = terminalToolbarWidth(id as TerminalToolbarKey) ?? 24): TerminalKeyInfo =>
 ({ id, kind: "key", group, label, accessible: { i18n }, width, send: { key: send }, fixed: false, bar: true, pad: true });
const herdr = (id: CatalogKeyId, group: TerminalKeyGroup, label: string, accessible: KeyAccessibleName, send: KeySend, width = 24): TerminalKeyInfo =>
 ({ id, kind: "herdr", group, label, accessible, width, send, fixed: false, bar: true, pad: true });
const ctrlLetters: CtrlLetter[] = ["c", "d", "z", "l", "r", "a", "e", "u", "w", "k"];

/** S4: only keys the app can already send, plus today's bar controls. */
export const TERMINAL_KEY_CATALOG: readonly TerminalKeyInfo[] = [
 control("attach", "+", "attach"), control("ctrl", "Ctrl", "ctrl"), control("prefix", "PREFIX", "prefix"),
 control("paste", "⎘", "paste"), control("mic", "🎙", "dictate"), control("dpad", "✥", "openDpad"), control("keyboard", "⌨", "showKeyboard"),
 key("esc", "basic", "Esc", "escape", "esc"), key("tab", "basic", "Tab", "tab", "tab"),
 key("enter", "basic", "↵", "enter", "enter"), key("backspace", "basic", "⌫", "backspace", "backspace"),
 herdr("space", "basic", "␣", { i18n: "space" }, { spec: "space" }),
 key("up", "navigation", "↑", "up", "up"), key("down", "navigation", "↓", "down", "down"),
 key("left", "navigation", "←", "left", "left"), key("right", "navigation", "→", "right", "right"),
 key("home", "navigation", "⇱", "home", "home", 24), key("end", "navigation", "⇲", "end", "end", 24),
 key("pageUp", "navigation", "⇞", "pageUp", "pageup", 24), key("pageDown", "navigation", "⇟", "pageDown", "pagedown", 24),
 ...ctrlLetters.map(letter => herdr(`ctrl+${letter}`, "combos", `^${letter.toUpperCase()}`, { text: `Ctrl+${letter.toUpperCase()}` }, { spec: `ctrl+${letter}` })),
 herdr("alt+b", "combos", "Alt+B", { text: "Alt+B" }, { spec: "alt+b" }, 36), herdr("alt+f", "combos", "Alt+F", { text: "Alt+F" }, { spec: "alt+f" }, 36),
 ...Array.from({ length: 12 }, (_, i) => herdr(`f${i + 1}` as CatalogKeyId, "functions", `F${i + 1}`, { text: `F${i + 1}` }, { spec: `f${i + 1}` })),
 herdr("previousAgent", "herdr", "‹Ag", { i18n: "previousAgent" }, { binding: "previous_agent" }, 30),
 herdr("nextAgent", "herdr", "Ag›", { i18n: "nextAgent" }, { binding: "next_agent" }, 30),
];
const catalog = new Map<string, TerminalKeyInfo>(TERMINAL_KEY_CATALOG.map(info => [info.id, info]));

/** Custom keys grow with their name: 1 letter 24dp, «Estado» 44dp (like PREFIX), 8 letters 56dp. */
const customWidth = (name: string) => Math.min(56, Math.max(24, 8 + 6 * Array.from(name).length));
export function terminalKeyInfo(layout: TerminalKeyLayout, id: KeyId): TerminalKeyInfo | null {
 if (!id.startsWith("custom:")) return catalog.get(id) ?? null;
 const button = layout.custom.find(b => `custom:${b.id}` === id);
 return button ? { id, kind: "custom", group: "custom", label: button.name, accessible: { text: button.name }, width: customWidth(button.name), send: null, fixed: false, bar: true, pad: true } : null;
}

const padSlotOf = (x: number, y: number) => (y - 8) / 72 * 3 + (x - 12) / 72;
/** Today's bar (keyboard closed, PREFIX panel closed) and today's 7-key cross. */
export function defaultTerminalKeys(): TerminalKeyLayout {
 const pad: (KeyId | null)[] = Array(PAD_SLOTS).fill(null);
 for (const item of terminalPadLayout()) pad[padSlotOf(item.x, item.y)] = item.key;
 return { v: 1, bar: [...terminalToolbarKeys({ keyboard: false, prefixPanel: false })], pad, custom: [] };
}
/** Slot 0–8 left to right, top to bottom, on the 216dp pad (72dp steps). */
export function padSlots(layout: TerminalKeyLayout): { slot: number; key: KeyId; x: number; y: number }[] {
 return layout.pad.flatMap((key, slot) => key === null ? [] : [{ slot, key, x: 12 + slot % 3 * 72, y: 8 + Math.floor(slot / 3) * 72 }]);
}

export function remaining(layout: TerminalKeyLayout): number {
 return TOOLBAR_BUDGET.screen - terminalToolbarRowWidth(layout.bar.map(id => terminalKeyInfo(layout, id)?.width ?? 0));
}
/** S2 hard limit: the stored bar fits 360dp with keyboard and PREFIX panel closed (its widest moment). */
export const fits = (layout: TerminalKeyLayout) => remaining(layout) >= 0;

/** Dynamic visibility for any layout, as today: up/down hide while the keyboard is open (←/→ stay
 * if the user added them); the PREFIX panel hides the mic, adds the missing arrows after the
 * last arrow present (else before ✥/Teclado), and if that overflows drops optional keys from the right. */
export function visibleBar(layout: TerminalKeyLayout, moment: { keyboard: boolean; prefixPanel: boolean }): KeyId[] {
 let bar = layout.bar.filter(id => moment.prefixPanel ? id !== "mic" : !(moment.keyboard && (id === "up" || id === "down")));
 if (!moment.prefixPanel) return bar;
 const last = Math.max(...ARROWS.map(arrow => bar.indexOf(arrow)));
 const tail = [bar.indexOf("dpad"), bar.indexOf("keyboard")].find(index => index >= 0) ?? bar.length;
 const at = last >= 0 ? last + 1 : tail;
 bar = [...bar.slice(0, at), ...ARROWS.filter(arrow => !bar.includes(arrow)), ...bar.slice(at)];
 while (!fits({ ...layout, bar })) {
  const drop = bar.findLastIndex(id => !(FIXED_BAR_KEYS as readonly string[]).includes(id) && !(ARROWS as readonly string[]).includes(id));
  if (drop < 0) break;
  bar = bar.filter((_, index) => index !== drop);
 }
 return bar;
}

const copy = (layout: TerminalKeyLayout): TerminalKeyLayout => ({ v: 1, bar: [...layout.bar], pad: [...layout.pad], custom: layout.custom.map(b => ({ ...b })) });
const edit = (layout: TerminalKeyLayout): KeyEdit => fits(layout) ? { ok: true, layout } : { ok: false, reason: "full" };
const clampIndex = (index: number, length: number) => Math.max(0, Math.min(Number.isInteger(index) ? index : length, length));

/** Defaults to just before Teclado when it ends the bar. A key that doesn't fit is refused, never cut. */
export function addToBar(layout: TerminalKeyLayout, id: KeyId, index?: number): KeyEdit {
 if (!terminalKeyInfo(layout, id)?.bar) return { ok: false, reason: "unknown" };
 if (layout.bar.includes(id)) return { ok: false, reason: "duplicate" };
 const keyboard = layout.bar.indexOf("keyboard");
 const at = clampIndex(index ?? (keyboard >= 0 && keyboard === layout.bar.length - 1 ? keyboard : layout.bar.length), layout.bar.length);
 const next = copy(layout); next.bar.splice(at, 0, id);
 return edit(next);
}
export function removeFromBar(layout: TerminalKeyLayout, id: KeyId): KeyEdit {
 if ((FIXED_BAR_KEYS as readonly string[]).includes(id)) return { ok: false, reason: "fixed" };
 if (!layout.bar.includes(id)) return { ok: false, reason: "missing" };
 const next = copy(layout); next.bar = next.bar.filter(key => key !== id);
 return { ok: true, layout: next };
}
/** `index` is the position after the key is lifted out. */
export function moveInBar(layout: TerminalKeyLayout, id: KeyId, index: number): KeyEdit {
 if (!layout.bar.includes(id)) return { ok: false, reason: "missing" };
 const next = copy(layout); next.bar = next.bar.filter(key => key !== id);
 next.bar.splice(clampIndex(index, next.bar.length), 0, id);
 return { ok: true, layout: next };
}
/** Replaces the slot's key; a key already elsewhere on the pad moves (no pad duplicates). Controls stay off the pad. */
export function setPadSlot(layout: TerminalKeyLayout, slot: number, id: KeyId | null): KeyEdit {
 if (!Number.isInteger(slot) || slot < 0 || slot >= PAD_SLOTS) return { ok: false, reason: "slot" };
 if (id !== null && !terminalKeyInfo(layout, id)?.pad) return { ok: false, reason: "unknown" };
 const next = copy(layout); next.pad = next.pad.map(key => key === id ? null : key); next.pad[slot] = id;
 return { ok: true, layout: next };
}

const controlChars = /[\u0000-\u001f\u007f]/;
const validId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const validName = (name: unknown): name is string => typeof name === "string" && name.trim().length > 0 && Array.from(name.trim()).length <= CUSTOM_LIMITS.name && !controlChars.test(name);
const validText = (text: unknown): text is string => typeof text === "string" && text.length > 0 && Array.from(text).length <= CUSTOM_LIMITS.text && !text.includes("\u0000");
function customRefusal(button: CustomButton): KeyRefusal | null {
 return !validId(button.id) ? "id" : !validName(button.name) ? "name" : !validText(button.text) ? "text" : typeof button.enter !== "boolean" || typeof button.ignoreCtrl !== "boolean" ? "text" : null;
}
/** Creates or updates by id (the caller supplies a fresh id). Renaming a bar button must still fit. */
export function saveCustom(layout: TerminalKeyLayout, button: CustomButton): KeyEdit {
 const reason = customRefusal(button);
 if (reason) return { ok: false, reason };
 const clean = { id: button.id, name: button.name.trim(), text: button.text, enter: button.enter, ignoreCtrl: button.ignoreCtrl };
 const next = copy(layout), index = next.custom.findIndex(b => b.id === clean.id);
 if (index < 0 && next.custom.length >= CUSTOM_LIMITS.buttons) return { ok: false, reason: "limit" };
 if (index < 0) next.custom.push(clean); else next.custom[index] = clean;
 return edit(next);
}
export function removeCustom(layout: TerminalKeyLayout, id: string): TerminalKeyLayout {
 const next = copy(layout), ref = `custom:${id}`;
 return { ...next, bar: next.bar.filter(key => key !== ref), pad: next.pad.map(key => key === ref ? null : key), custom: next.custom.filter(b => b.id !== id) };
}
/** S3 «Restaurar teclas originales»: default bar and pad; custom buttons are kept. */
export function restore(layout: TerminalKeyLayout): TerminalKeyLayout {
 return { ...defaultTerminalKeys(), custom: layout.custom.map(b => ({ ...b })) };
}

/** S5: the text exactly as written, then a carriage return when «Enter al final» is on. */
export function customBytes(button: CustomButton): Uint8Array {
 return new TextEncoder().encode(button.enter ? `${button.text}\r` : button.text);
}
/** With Enter only a hold (CUSTOM_HOLD_MS) sends and a tap shows CUSTOM_HOLD_HINT; without Enter any press types. */
export function customGesture(button: CustomButton, gesture: "tap" | "hold"): "send" | "hint" {
 return button.enter && gesture === "tap" ? "hint" : "send";
}
export const customFires = (button: CustomButton, gesture: "tap" | "hold") => customGesture(button, gesture) === "send";
/** What a catalog key sends on this computer: terminal keys follow the page's cursor mode, agent keys use
 * the computer's Herdr binding and prefix. Null for app controls, custom buttons and unconfigured bindings. */
export function catalogKeyBytes(info: TerminalKeyInfo, context: { cursorMode: boolean; herdr: HerdrKeys }): Uint8Array | null {
 if (!info.send) return null;
 if ("key" in info.send) return terminalKey(info.send.key, context.cursorMode);
 if ("spec" in info.send) return herdrKeyBytes(info.send.spec);
 const spec = context.herdr[info.send.binding];
 return spec ? herdrKeyBytes(spec, context.herdr.prefix) : null;
}

/** Puts missing fixed keys back after their nearest default predecessor (Teclado at the end). */
function withFixed(bar: KeyId[]): KeyId[] {
 const defaults = defaultTerminalKeys().bar, result = [...bar];
 for (const fixed of FIXED_BAR_KEYS) {
  if (result.includes(fixed)) continue;
  const index = defaults.indexOf(fixed);
  if (index === defaults.length - 1) { result.push(fixed); continue; }
  const before = defaults.slice(0, index).reverse().find(id => result.includes(id));
  result.splice(before ? result.indexOf(before) + 1 : 0, 0, fixed);
 }
 return result;
}
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function storedCustom(value: unknown): CustomButton | null {
 if (!isRecord(value)) return null;
 // Buttons saved before «Ignorar Ctrl» existed read as ignoring Ctrl, the new default (same version 1).
 const button = { id: value.id, name: value.name, text: value.text, enter: value.enter, ignoreCtrl: value.ignoreCtrl ?? true } as CustomButton;
 return customRefusal(button) ? null : { ...button, name: button.name.trim() };
}
/** S6: structural damage or another version → the default layout; unknown ids, invalid custom buttons and
 * their references are dropped; missing fixed keys are repaired; a bar over budget becomes the default bar. */
function normalize(value: unknown): TerminalKeyLayout | null {
 if (!isRecord(value) || value.v !== 1 || !Array.isArray(value.bar) || !Array.isArray(value.pad) || value.pad.length !== PAD_SLOTS || !Array.isArray(value.custom)) return null;
 const custom: CustomButton[] = [];
 for (const item of value.custom) {
  const button = storedCustom(item);
  if (button && custom.length < CUSTOM_LIMITS.buttons && !custom.some(b => b.id === button.id)) custom.push(button);
 }
 const base: TerminalKeyLayout = { v: 1, bar: [], pad: [], custom };
 const usable = (id: unknown, where: "bar" | "pad"): id is KeyId => typeof id === "string" && terminalKeyInfo(base, id as KeyId)?.[where] === true;
 const bar: KeyId[] = [], pad: (KeyId | null)[] = [];
 for (const id of value.bar) if (usable(id, "bar") && !bar.includes(id)) bar.push(id);
 for (const id of value.pad) pad.push(usable(id, "pad") && !pad.includes(id) ? id : null);
 const layout: TerminalKeyLayout = { v: 1, bar: withFixed(bar), pad, custom };
 return fits(layout) ? layout : { ...layout, bar: defaultTerminalKeys().bar };
}
export function parseTerminalKeys(raw: string | null): TerminalKeyLayout {
 if (raw === null || raw.length > MAX_STORED) return defaultTerminalKeys();
 try { return normalize(JSON.parse(raw)) ?? defaultTerminalKeys(); }
 catch { return defaultTerminalKeys(); }
}
export function serializeTerminalKeys(layout: TerminalKeyLayout): string {
 return JSON.stringify({ v: 1, bar: layout.bar, pad: layout.pad, custom: layout.custom });
}

/** Persisted layout text (architecture: TerminalKeysStore); read once and synchronously before any terminal opens. */
export interface TerminalKeysStore {
 read(): string | null;
 write(text: string): Promise<void>;
}

export class TerminalKeysPreference {
 private value: TerminalKeyLayout;
 private readonly listeners = new Set<(value: TerminalKeyLayout) => void>();
 private saving: Promise<void> | null = null;
 private dirty = false;
 constructor(private readonly store: TerminalKeysStore) {
  let raw: string | null = null;
  try { raw = store.read(); } catch { /* Unreadable storage keeps the original keys usable. */ }
  this.value = parseTerminalKeys(raw);
 }
 get = () => copy(this.value);
 subscribe = (listener: (value: TerminalKeyLayout) => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
 /** Applies at once (repaired like stored data); fast saves write at most one in-flight and one latest layout.
  * A failed write rejects but the new layout stays in use until the app closes; setting it again retries. */
 set = (layout: TerminalKeyLayout): Promise<void> => {
  const next = normalize(layout);
  const same = next !== null && serializeTerminalKeys(next) === serializeTerminalKeys(this.value);
  if (!next || (same && !this.dirty)) return this.saving ?? Promise.resolve();
  this.value = next; this.dirty = true;
  if (!same) for (const listener of this.listeners) listener(copy(next));
  this.saving ??= this.save();
  return this.saving;
 };
 private async save() {
  try {
   while (this.dirty) { this.dirty = false; await this.store.write(serializeTerminalKeys(this.value)); }
  } catch (error) { this.dirty = true; throw error; }
  finally { this.saving = null; }
 }
}
