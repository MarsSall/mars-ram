// How layout keys read and look on screen: spoken names, catalog chips, D-pad faces, and the custom-button press rule.
import { applyTerminalCtrl, type TerminalCtrlState } from "../core/terminal-controls";
import { customBytes, customGesture, terminalKeyInfo, visibleBar, type CustomButton, type KeyId, type TerminalKeyInfo, type TerminalKeyLayout } from "../core/terminal-keys";
import type { Strings } from "./i18n/en";

type TerminalStrings = Strings["terminal"];

/** The screen-reader name: a `terminal` string, or the key's own text (Ctrl+C, F5). */
export function keyName(info: TerminalKeyInfo, s: TerminalStrings): string {
 if ("text" in info.accessible) return info.accessible.text;
 const value = (s as Record<string, unknown>)[info.accessible.i18n];
 return typeof value === "string" ? value : info.label;
}

/** Catalog chip text, as in artboard 01: words stay as they are, symbols get their name («↵ Enter»), controls their name. */
export function keyChip(info: TerminalKeyInfo, s: TerminalStrings): string {
 if (/^[A-Za-z]+$/.test(info.label)) return info.label;
 const symbol = info.kind === "key" || info.id === "space";
 return symbol ? `${info.label} ${keyName(info, s)}` : keyName(info, s);
}

/** Today's pad faces: Escape and word keys small, Enter large on the accent. */
export function padKeyFace(info: TerminalKeyInfo): { glyph: string; size: number; accent: boolean } {
 if (info.id === "enter") return { glyph: info.label, size: 26, accent: true };
 return { glyph: info.label, size: Array.from(info.label).length > 2 ? 12 : 18, accent: false };
}

/** The bar the terminal shows right now (keyboard and PREFIX panel), from the saved layout. */
export function terminalBarItems(layout: TerminalKeyLayout, moment: { keyboard: boolean; prefixPanel: boolean }): { id: KeyId; info: TerminalKeyInfo }[] {
 return visibleBar(layout, moment).flatMap(id => { const info = terminalKeyInfo(layout, id); return info ? [{ id, info }] : []; });
}

export function customButtonOf(layout: TerminalKeyLayout, id: KeyId): CustomButton | null {
 return id.startsWith("custom:") ? layout.custom.find(b => `custom:${b.id}` === id) ?? null : null;
}

/** S5: what a press does. With «Enter al final» a tap only shows «Mantené apretado para enviar». */
export function customPress(button: CustomButton, gesture: "tap" | "hold"): { bytes: Uint8Array | null; hint: boolean } {
 return customGesture(button, gesture) === "send" ? { bytes: customBytes(button), hint: false } : { bytes: null, hint: true };
}

/** A press with the terminal's Ctrl state: with «Ignorar Ctrl» the text goes as written and Ctrl stays as it was
 * (armed waits for the next key); without it, the text goes through Ctrl like typed input. */
export function customInput(button: CustomButton, gesture: "tap" | "hold", ctrl: TerminalCtrlState): { bytes: Uint8Array | null; hint: boolean; ctrl: TerminalCtrlState } {
 const press = customPress(button, gesture);
 if (!press.bytes || button.ignoreCtrl) return { ...press, ctrl };
 const next = applyTerminalCtrl(ctrl, press.bytes);
 return { bytes: next.bytes, hint: false, ctrl: next.state };
}

/** Says what the button sends (shortened, one line) so a screen reader user knows before holding it. */
export function customAccessibleName(button: CustomButton, k: Strings["terminalKeys"]): string {
 const line = button.text.replace(/\s+/g, " ").trim();
 const text = Array.from(line).length > 60 ? `${Array.from(line).slice(0, 60).join("")}…` : line;
 return k.customKey(button.name, text, button.enter);
}
