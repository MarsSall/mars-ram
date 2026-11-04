import type { HostConnection } from "./ports";

export type HerdrKeys = { prefix: string; previous_agent?: string; next_agent?: string };
/** Deliberately only the quoted string assignments in [keys], not a general TOML parser. */
export function parseHerdrKeys(content: string | null): HerdrKeys {
 const keys: HerdrKeys = { prefix: "ctrl+b" };
 let inKeys = false;
 for (const line of (content ?? "").split(/\r?\n/)) {
  const table = line.match(/^\s*(\[.*?\])\s*(?:#.*)?$/);
  if (table) { inKeys = table[1] === "[keys]"; continue; }
  if (!inKeys) continue;
  const match = line.match(/^\s*(prefix|previous_agent|next_agent)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/);
  if (!match) continue;
  try {
   const value: string = match[2][0] === "'" ? match[2].slice(1, -1) : JSON.parse(match[2]);
   keys[match[1] as keyof HerdrKeys] = value;
  } catch { /* Unsupported or malformed TOML remains absent. */ }
 }
 return keys;
}

/** Unknown specs stay unavailable; never substitute a different configured key. */
export function herdrKeyBytes(spec: string, prefix?: string): Uint8Array | null {
 if (spec.length > 256) return null;
 const key = spec.toLowerCase();
 const encode = (value: string) => new TextEncoder().encode(value);
 if (key.startsWith("prefix+")) {
  if (!prefix || prefix.toLowerCase().startsWith("prefix+")) return null;
  const first = herdrKeyBytes(prefix), next = herdrKeyBytes(spec.slice(7));
  return first && next ? new Uint8Array([...first, ...next]) : null;
 }
 if (/^ctrl\+[a-z]$/.test(key)) return new Uint8Array([key.charCodeAt(5) - 96]);
 if (/^shift\+[a-z]$/.test(key)) return encode(key.slice(6).toUpperCase());
 if (key.startsWith("alt+")) {
  const next = herdrKeyBytes(spec.slice(4));
  return next ? new Uint8Array([27, ...next]) : null;
 }
 if (Array.from(spec).length === 1) return encode(spec);
 const named: Record<string, string> = { esc: "\x1b", tab: "\t", enter: "\r", space: " ", backspace: "\x7f", up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D", f1: "\x1bOP", f2: "\x1bOQ", f3: "\x1bOR", f4: "\x1bOS", f5: "\x1b[15~", f6: "\x1b[17~", f7: "\x1b[18~", f8: "\x1b[19~", f9: "\x1b[20~", f10: "\x1b[21~", f11: "\x1b[23~", f12: "\x1b[24~" };
 return Object.hasOwn(named, key) ? encode(named[key]) : null;
}

type ConfigHost = Pick<HostConnection, "homeDirectory" | "readFile">;
/** Existing SFTP port is the adapter: fixed, bounded paths relative to the host's home. */
export async function readHerdrKeys(host: ConfigHost, connectionId: string): Promise<HerdrKeys> {
 let windows = false;
 try {
  const home = await host.homeDirectory(connectionId);
  windows = home.ok && (/^\/?[A-Za-z]:[\\/]/.test(home.path) || home.path.startsWith("\\\\"));
 } catch { /* Unknown OS tries the Unix path first. */ }
 const unix = ".config/herdr/config.toml", win = "AppData/Roaming/herdr/config.toml";
 for (const path of windows ? [win, unix] : [unix, win]) {
  try { const result = await host.readFile(connectionId, path, 16384); if (result.ok) return parseHerdrKeys(result.content); }
  catch { /* Try the other known location, then defaults. */ }
 }
 return parseHerdrKeys(null);
}
