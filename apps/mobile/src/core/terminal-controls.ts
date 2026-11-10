// Pure screen interaction rules; no platform APIs or text decoding of PTY bytes.
export function consumeTerminalCtrl(armed: boolean, bytes: Uint8Array) {
 if (!bytes.length) return { armed, bytes };
 const value = bytes[0];
 return { armed: false, bytes: armed && bytes.length === 1 && ((value >= 65 && value <= 90) || (value >= 97 && value <= 122)) ? new Uint8Array([value & 31]) : bytes };
}
export type TerminalPadKey = "esc" | "backspace" | "up" | "left" | "enter" | "right" | "down";
export type TerminalCtrlState = { mode: "off" | "armed" | "locked"; tappedAt: number | null };
export function tapTerminalCtrl(state: TerminalCtrlState, now: number): TerminalCtrlState {
 if (state.mode === "locked") return { mode: "off", tappedAt: null };
 if (state.mode === "armed") return state.tappedAt !== null && now - state.tappedAt >= 0 && now - state.tappedAt <= 400
  ? { mode: "locked", tappedAt: null } : { mode: "off", tappedAt: null };
 return { mode: "armed", tappedAt: now };
}
export function applyTerminalCtrl(state: TerminalCtrlState, bytes: Uint8Array): { state: TerminalCtrlState; bytes: Uint8Array } {
 const next = consumeTerminalCtrl(state.mode !== "off", bytes);
 return { state: state.mode === "locked" || !bytes.length ? state : { mode: "off", tappedAt: null }, bytes: next.bytes };
}
export type TerminalToolbarKey = TerminalPadKey | "attach" | "tab" | "ctrl" | "prefix" | "dpad" | "paste" | "mic" | "keyboard";

/** A transparent 216dp cross with Escape and Backspace in the top corners. */
export function terminalPadLayout(): readonly { key: TerminalPadKey; x: number; y: number }[] {
 return [
  { key: "esc", x: 12, y: 8 }, { key: "backspace", x: 156, y: 8 },
  { key: "up", x: 84, y: 8 }, { key: "left", x: 12, y: 80 },
  { key: "enter", x: 84, y: 80 }, { key: "right", x: 156, y: 80 },
  { key: "down", x: 84, y: 152 },
 ];
}

export function terminalToolbarKeys(moment: { keyboard: boolean; prefixPanel: boolean }): readonly TerminalToolbarKey[] {
 const arrows: TerminalToolbarKey[] = moment.prefixPanel ? ["up", "down", "left", "right"] : moment.keyboard ? [] : ["up", "down"];
 // The dictation mic gives its room to the four-arrow PREFIX panel (360dp budget).
 return ["attach", "ctrl", "prefix", "esc", "tab", "paste", ...(moment.prefixPanel ? [] : ["mic" as const]), ...arrows, "dpad", "keyboard"];
}

/** Minimum key widths; the four-arrow pill fits 360dp including 20dp
 * edge margins, 14dp padding/borders and 2dp gaps. Extra room grows keys. */
export function terminalToolbarWidth(key: TerminalToolbarKey): number {
 return { attach: 24, ctrl: 30, prefix: 44, esc: 24, tab: 24, enter: 22, paste: 24, mic: 24, up: 20, down: 20, left: 20, right: 20, dpad: 24, backspace: 24, keyboard: 26 }[key];
}
/** The narrowest phone: 20dp edge margins plus 14dp pill padding/borders, 2dp between keys. */
export const TOOLBAR_BUDGET = { screen: 360, chrome: 20 + 14, gap: 2 } as const;
export function terminalToolbarRowWidth(widths: readonly number[]): number {
 return widths.reduce((sum, width) => sum + width, TOOLBAR_BUDGET.chrome + Math.max(0, widths.length - 1) * TOOLBAR_BUDGET.gap);
}
export function terminalChromeInsets(insets: { top: number; bottom: number }, keyboard: boolean) {
 const stripHeight = Math.max(32, insets.top);
 // Keep both halves clear of a centre punch-hole, even with long/scaled text.
 return { stripHeight, cameraGap: stripHeight * 2, bottom: keyboard ? 0 : insets.bottom };
}

export const DPAD_SIZE = 216;
export const DPAD_TAB_HEIGHT = 64;
export function clampDpadTab(y: number, height: number) {
 return Math.max(0, Math.min(y, height - DPAD_TAB_HEIGHT - 48));
}
// distance is the largest excursion during the gesture: returning a drag to
// its origin must not turn it into a tap. Velocity is in dp/ms (PanResponder).
export function resolveDpadGesture(open: boolean, gesture: { dx: number; dy: number; vx: number; distance: number }) {
 const { dx, dy, vx, distance } = gesture;
 if (distance <= 8) return !open;
 if (Math.abs(dx) <= Math.abs(dy)) return open;
 if (dx <= -40 || (dx <= -8 && vx <= -0.5)) return true;
 if (dx >= 40 || (dx >= 8 && vx >= 0.5)) return false;
 return open;
}
export function clampDpad(position: { x: number; y: number }, bounds: { width: number; height: number }) {
 return { x: Math.max(0, Math.min(position.x, bounds.width - DPAD_SIZE)), y: Math.max(0, Math.min(position.y, bounds.height - DPAD_SIZE - 48)) };
}
export function sessionDestination(terminal: boolean | null) { return terminal === null ? "unavailable" : terminal ? "terminal" : "chat"; }

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(bytes: Uint8Array): string {
 let result = "";
 for (let i = 0; i < bytes.length; i += 3) {
  const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
  result += alphabet[a >> 2] + alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)] + (b === undefined ? "=" : alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)]) + (c === undefined ? "=" : alphabet[c & 63]);
 }
 return result;
}
function unbase64(data: string): Uint8Array | null {
 if (data.length > 87384 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return null;
 const length = data.length / 4 * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
 const bytes = new Uint8Array(length);
 for (let i = 0, j = 0; i < data.length; i += 4) {
  const n = (alphabet.indexOf(data[i]) << 18) | (alphabet.indexOf(data[i + 1]) << 12) | (Math.max(0, alphabet.indexOf(data[i + 2])) << 6) | Math.max(0, alphabet.indexOf(data[i + 3]));
  if (j < length) bytes[j++] = (n >> 16) & 255;
  if (j < length) bytes[j++] = (n >> 8) & 255;
  if (j < length) bytes[j++] = n & 255;
 }
 return bytes;
}
export type TerminalMessage = { type: "output"; bytes: Uint8Array } | { type: "fit" | "resize" | "focus" | "blur" | "reset" } | { type: "fontSize"; value: number };
export function encodeTerminalMessage(message: TerminalMessage): string {
 return JSON.stringify(message.type === "output" ? { type: "output", data: base64(message.bytes) } : message);
}
export type WebTerminalMessage = { type: "ready" } | { type: "input"; bytes: Uint8Array } | { type: "size"; cols: number; rows: number } | { type: "cursorMode"; enabled: boolean } | { type: "selection"; text: string } | { type: "fontSize"; value: number };
export function decodeWebMessage(raw: string): WebTerminalMessage | null {
 if (raw.length > 90000) return null;
 try {
  const m = JSON.parse(raw);
  if (!m || typeof m !== "object") return null;
  if (m.type === "ready") return { type: "ready" };
  if (m.type === "input" && typeof m.data === "string") { const bytes = unbase64(m.data); return bytes ? { type: "input", bytes } : null; }
  if (m.type === "size" && [m.cols, m.rows].every(n => Number.isInteger(n) && n >= 1 && n <= 1000)) return { type: "size", cols: m.cols, rows: m.rows };
  if (m.type === "cursorMode" && typeof m.enabled === "boolean") return { type: "cursorMode", enabled: m.enabled };
  if (m.type === "selection" && typeof m.text === "string" && m.text.length <= 65536) return { type: "selection", text: m.text };
  if (m.type === "fontSize" && Number.isInteger(m.value) && m.value >= 8 && m.value <= 28) return { type: "fontSize", value: m.value };
 } catch { /* Ignore malformed messages, never execute page content as code. */ }
 return null;
}
