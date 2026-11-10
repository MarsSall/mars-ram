// The project browser hides well-known secret files by default (MarsSall/mars-ram#1), so a
// tap or a glance over someone's shoulder cannot put a key on the screen by accident.
// A display precaution only: the host still reads any file the phone asks for.

const SAFE_ENV = /\.(example|sample|template|dist)$/;
const KEY_EXTENSIONS = /\.(pem|key|p12|pfx|jks|keystore)$/;
const SSH_KEYS = /^id_(rsa|dsa|ecdsa|ed25519)(_sk)?$/;
const NAMED = new Set([".netrc", ".npmrc", ".pgpass"]);

/** True for a file name (not a path) that usually holds a secret: .env files, private keys, credential files. */
export function isSecretFileName(name: string): boolean {
 const lower = name.toLowerCase();
 if (lower === ".env" || (lower.startsWith(".env.") && !SAFE_ENV.test(lower))) return true;
 return KEY_EXTENSIONS.test(lower) || SSH_KEYS.test(lower) || NAMED.has(lower);
}
export const isSecretPath = (path: string) => isSecretFileName(path.split("/").at(-1) ?? path);

/** Splits a list into what is shown and how many secret files are hidden; `hide` false shows everything. */
export function hideSecrets<T>(items: readonly T[], pathOf: (item: T) => string | null, hide: boolean): { shown: T[]; hidden: number } {
 if (!hide) return { shown: [...items], hidden: 0 };
 const shown = items.filter(item => { const path = pathOf(item); return path === null || !isSecretPath(path); });
 return { shown, hidden: items.length - shown.length };
}

/** Persisted "hide secret files" switch (Settings); read once and synchronously, default on. */
export interface SecretFilesStore {
 read(): string | null;
 write(text: string): Promise<void>;
}
export function parseHideSecrets(raw: string | null): boolean {
 try { return JSON.parse(raw ?? "true") !== false; } catch { return true; }
}
export class SecretFilesPreference {
 private value: boolean;
 private readonly listeners = new Set<(value: boolean) => void>();
 constructor(private readonly store: SecretFilesStore) {
  let raw: string | null = null;
  try { raw = store.read(); } catch { /* Unreadable storage keeps the safe default. */ }
  this.value = parseHideSecrets(raw);
 }
 get = () => this.value;
 subscribe = (listener: (value: boolean) => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
 /** Applies at once; a failed write restores the previous value and rejects. */
 set = async (value: boolean): Promise<void> => {
  if (value === this.value) return;
  const previous = this.value; this.notify(value);
  try { await this.store.write(JSON.stringify(value)); } catch (error) { this.notify(previous); throw error; }
 };
 private notify(value: boolean) { this.value = value; for (const listener of this.listeners) listener(value); }
}
