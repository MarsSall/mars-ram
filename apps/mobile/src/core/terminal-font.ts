// One font size for every terminal: Settings and pinch zoom change the same value.
export const TERMINAL_FONT = { min: 8, max: 28, default: 14 } as const;

/** Persisted size text (architecture: TerminalFontStore); read once and synchronously so a terminal never starts at 14 then jumps. */
export interface TerminalFontStore {
 read(): string | null;
 write(text: string): Promise<void>;
}

const valid = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= TERMINAL_FONT.min && (value as number) <= TERMINAL_FONT.max;
export function parseTerminalFontSize(raw: string | null): number {
 try { const value: unknown = JSON.parse(raw ?? "null"); return valid(value) ? value : TERMINAL_FONT.default; }
 catch { return TERMINAL_FONT.default; }
}
export function stepTerminalFontSize(current: number, delta: number): number {
 return Math.max(TERMINAL_FONT.min, Math.min(TERMINAL_FONT.max, current + delta));
}

export class TerminalFontPreference {
 private value: number;
 private readonly listeners = new Set<(value: number) => void>();
 private saving: Promise<void> | null = null;
 private dirty = false;
 constructor(private readonly store: TerminalFontStore) {
  let raw: string | null = null;
  try { raw = store.read(); } catch { /* Unreadable storage keeps the default usable. */ }
  this.value = parseTerminalFontSize(raw);
 }
 get = () => this.value;
 subscribe = (listener: (value: number) => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
 /** Applies at once; a fast pinch writes at most one in-flight and one latest size. */
 set = (value: number): Promise<void> => {
  if (!valid(value) || value === this.value) return this.saving ?? Promise.resolve();
  this.value = value; this.dirty = true;
  for (const listener of this.listeners) listener(value);
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
