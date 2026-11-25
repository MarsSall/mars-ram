// The terminal key bar can hide (odd/tasks/key-bar-autohide.md): «Siempre visible» (default, today),
// «Autodesplegable» (a tap on the handle tab or a mouse at the bottom edge shows it; a terminal tap or a few
// idle seconds hide it) and «Con un toque» (the same handle tab toggles it). No swipe reveal (L4). Pure rules only.

export type KeyBarMode = "always" | "auto" | "tap";
export const KEY_BAR_MODES: readonly KeyBarMode[] = ["always", "auto", "tap"];
export const DEFAULT_KEY_BAR_MODE: KeyBarMode = "always";
export const KEY_BAR_TIMING = { idleMs: 4000, pointerLeaveMs: 700, animationMs: 150 } as const;

/** tab: the handle tab tapped; pointer: a mouse at the bottom edge; assistive: the tab activated by a screen reader. */
export type KeyBarReveal = "tab" | "pointer" | "assistive";
export type KeyBarHolds = { key: boolean; pad: boolean; mic: boolean };
/** `epoch` changes whenever the hide wait must start over; a timeout from an older epoch is ignored. */
export type KeyBarState = { mode: KeyBarMode; shown: boolean; via: KeyBarReveal | null; pointer: boolean; holds: KeyBarHolds; epoch: number };
export type KeyBarEvent =
 | { type: "terminal-tap" }
 /** A finger (or a click) on any bar key: `held` while it stays down. */
 | { type: "key-press"; held: boolean }
 | { type: "idle-timeout"; epoch: number }
 | { type: "pointer-enter" }
 | { type: "pointer-leave" }
 /** The handle tab; `assistive` when a screen reader activated it (TalkBack moves through the keys slowly). */
 | { type: "handle-tap"; assistive?: boolean }
 | { type: "mode-change"; mode: KeyBarMode }
 /** The D-pad shown or the bar's mic recording keep the bar up. */
 | { type: "hold"; source: "pad" | "mic"; on: boolean };

const NO_HOLDS: KeyBarHolds = { key: false, pad: false, mic: false };
/** `tapShown`: «Con un toque» keeps the user's last choice for the app's lifetime. */
export function initialKeyBarState(mode: KeyBarMode, tapShown = false, holds: KeyBarHolds = NO_HOLDS): KeyBarState {
 return { mode, shown: mode === "always" || (mode === "tap" && tapShown), via: null, pointer: false, holds: { ...holds }, epoch: 0 };
}

const held = (state: KeyBarState) => state.holds.key || state.holds.pad || state.holds.mic;
const show = (state: KeyBarState, via: KeyBarReveal, pointer = state.pointer): KeyBarState => ({ ...state, shown: true, via, pointer, epoch: state.epoch + 1 });
const hide = (state: KeyBarState): KeyBarState => ({ ...state, shown: false, via: null, pointer: false, epoch: state.epoch + 1 });

export function keyBarReducer(state: KeyBarState, event: KeyBarEvent): KeyBarState {
 if (event.type === "mode-change") return event.mode === state.mode ? state : { ...initialKeyBarState(event.mode, false, state.holds), epoch: state.epoch + 1 };
 if (event.type === "hold") return state.holds[event.source] === event.on ? state : { ...state, holds: { ...state.holds, [event.source]: event.on }, epoch: state.epoch + 1 };
 // Only «Autodesplegable» waits on keys; elsewhere a press must not re-render the terminal screen.
 if (event.type === "key-press") return state.mode !== "auto" ? state : { ...state, holds: { ...state.holds, key: event.held }, epoch: state.epoch + 1 };
 if (state.mode === "always") return state;
 if (state.mode === "tap") return event.type === "handle-tap" ? (state.shown ? hide(state) : show(state, "tab")) : state;
 switch (event.type) {
  case "handle-tap": return state.shown ? hide(state) : show(state, event.assistive ? "assistive" : "tab");
  case "pointer-enter": return show(state, state.shown && state.via === "assistive" ? "assistive" : "pointer", true);
  case "pointer-leave": return state.pointer ? { ...state, pointer: false, epoch: state.epoch + 1 } : state;
  case "terminal-tap": return state.shown && !held(state) ? hide(state) : state;
  case "idle-timeout": return event.epoch === state.epoch && keyBarTimer(state) ? hide(state) : state;
  default: return state;
 }
}

/** The hide wait to arm now, or null: only «Autodesplegable» while shown, nothing held, the pointer away,
 * and not opened by a screen reader (its user moves through the keys slowly). */
export function keyBarTimer(state: KeyBarState): { ms: number; epoch: number } | null {
 if (state.mode !== "auto" || !state.shown || held(state) || state.pointer || state.via === "assistive") return null;
 return { ms: state.via === "pointer" ? KEY_BAR_TIMING.pointerLeaveMs : KEY_BAR_TIMING.idleMs, epoch: state.epoch };
}

/** Hover only counts for a mouse or trackpad; a finger also sends pointer events and must not show the bar. */
export const isMousePointer = (event: { nativeEvent: { pointerType?: string } }) => event.nativeEvent.pointerType === "mouse";

/** Target of the show/hide animation: a short slide and fade, none with reduce motion. */
export function keyBarMotion(shown: boolean, reduceMotion: boolean): { opacity: number; translateY: number; duration: number } {
 return { opacity: shown ? 1 : 0, translateY: shown || reduceMotion ? 0 : 16, duration: reduceMotion ? 0 : KEY_BAR_TIMING.animationMs };
}

/** Android's bottom system gesture zone in dp (WindowInsetsCompat mandatorySystemGestures and navigationBars). */
export type SystemGestureInsets = { mandatoryBottom: number; navigationBottom: number };
/** Used when the native reading is unavailable (older Android, error): Android's gesture zone is about 30 dp. */
export const KEY_BAR_GESTURE_FALLBACK = 32;
/** The bottom band a swipe-up belongs to Android (go home), S5. Apps cannot claim it, and it can be taller
 * than the safe-area bottom (S24 Ultra: 32 dp gesture zone over a 15 dp navigation bar). */
export function keyBarGestureInset(native: SystemGestureInsets | null, safeBottom: number): number {
 if (!native) return Math.max(safeBottom, KEY_BAR_GESTURE_FALLBACK);
 return Math.max(native.mandatoryBottom, native.navigationBottom, safeBottom);
}
/** Size of the hidden modes' tab and 💬 (S9): the pills' height in dp, chosen with a free slider. 20 is the
 * size they always had. */
export const KEY_BAR_HANDLE_SIZE = { min: 12, max: 40, default: 14 } as const;
/** Below this the bottom band is too thin to tap (3-button navigation, DeX or desktop windows report little
 * or no inset), and the handles get their own thin row instead. */
export const KEY_BAR_BAND_MIN = 12;
export const clampKeyBarHandleSize = (value: number) => Math.round(Math.max(KEY_BAR_HANDLE_SIZE.min, Math.min(KEY_BAR_HANDLE_SIZE.max, value)));
/** The pills and their touch areas at a size: the touch area is the handles' whole row tall (never more), and
 * at least 48 dp wide, widened sideways rather than up into the terminal. */
export function keyBarHandleMetrics(size: number) {
 const pillHeight = clampKeyBarHandleSize(size);
 const pillWidth = Math.round(pillHeight * 1.4 + 28);
 return { pillHeight, pillWidth, touchWidth: Math.max(48, pillWidth + 16), tabIcon: Math.round(pillHeight * 0.7), chatIcon: Math.round(pillHeight * 0.6) };
}
/** Where the hidden modes' tab and 💬 go, never over the terminal (S8): in the bottom band that is already
 * empty below it (the safe-area/navigation band, `chromeBottom`, where Android draws its home pill) when the
 * pills fit there, else in a thin row of exactly their size below the terminal. Taps in the band reach the app,
 * swipes do not, so both handles are tap only. The keyboard leaves no band (`chromeBottom` is 0), so they get
 * the row above it. None in «Siempre visible», where 💬 stays on the bar. */
export type KeyBarHandleSlot = { place: "band" | "row"; height: number };
export function keyBarHandleSlot(mode: KeyBarMode, size: number, chromeBottom: number): KeyBarHandleSlot | null {
 if (mode === "always") return null;
 const pill = clampKeyBarHandleSize(size);
 return chromeBottom >= Math.max(KEY_BAR_BAND_MIN, pill) ? { place: "band", height: chromeBottom } : { place: "row", height: pill };
}

/** Persisted settings text (architecture: KeyBarModeStore); read once and synchronously before any terminal opens. */
export interface KeyBarModeStore {
 read(): string | null;
 write(text: string): Promise<void>;
}
/** How the bar shows and the size of its hidden-mode handles, saved together in one file. */
export type KeyBarSettings = { mode: KeyBarMode; handleSize: number };
export const DEFAULT_KEY_BAR_SETTINGS: KeyBarSettings = { mode: DEFAULT_KEY_BAR_MODE, handleSize: KEY_BAR_HANDLE_SIZE.default };
const isMode = (value: unknown): value is KeyBarMode => KEY_BAR_MODES.includes(value as KeyBarMode);
const isSize = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= KEY_BAR_HANDLE_SIZE.min && (value as number) <= KEY_BAR_HANDLE_SIZE.max;
/** Reads `{"mode":…,"handleSize":…}` and also the older file that held only the mode (`"auto"`); anything
 * missing or damaged falls back to today's always-visible bar and the default size, field by field. */
export function parseKeyBarSettings(raw: string | null): KeyBarSettings {
 let value: unknown = null;
 try { value = JSON.parse(raw ?? "null"); } catch { return { ...DEFAULT_KEY_BAR_SETTINGS }; }
 if (isMode(value)) return { mode: value, handleSize: KEY_BAR_HANDLE_SIZE.default };
 if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_KEY_BAR_SETTINGS };
 const { mode, handleSize } = value as Record<string, unknown>;
 return { mode: isMode(mode) ? mode : DEFAULT_KEY_BAR_MODE, handleSize: isSize(handleSize) ? handleSize : KEY_BAR_HANDLE_SIZE.default };
}
const sameSettings = (a: KeyBarSettings, b: KeyBarSettings) => a.mode === b.mode && a.handleSize === b.handleSize;
export class KeyBarModePreference {
 private value: KeyBarSettings;
 private readonly listeners = new Set<(value: KeyBarSettings) => void>();
 private saving: Promise<void> | null = null;
 private dirty = false;
 constructor(private readonly store: KeyBarModeStore) {
  let raw: string | null = null;
  try { raw = store.read(); } catch { /* Unreadable storage keeps today's always-visible bar. */ }
  this.value = parseKeyBarSettings(raw);
 }
 get = () => this.value;
 subscribe = (listener: (value: KeyBarSettings) => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
 /** Applies at once; fast changes write at most one in-flight and one latest value. A failed write rejects
  * but the new settings stay in use until the app closes; setting them again retries. */
 set = (next: KeyBarSettings): Promise<void> => {
  if (!isMode(next.mode) || !isSize(next.handleSize) || (sameSettings(next, this.value) && !this.dirty)) return this.saving ?? Promise.resolve();
  const changed = !sameSettings(next, this.value);
  if (changed) this.value = { mode: next.mode, handleSize: next.handleSize };
  this.dirty = true;
  if (changed) for (const listener of this.listeners) listener(this.value);
  this.saving ??= this.save();
  return this.saving;
 };
 private async save() {
  try {
   while (this.dirty) { this.dirty = false; await this.store.write(JSON.stringify(this.value)); }
  } catch (error) { this.dirty = true; throw error; }
  finally { this.saving = null; }
 }
}
