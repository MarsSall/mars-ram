// Hidden gift themes: each theme is sealed with its own code, so the source shows neither who it is for nor how it looks.
// Key: PBKDF2-SHA256 of the normalized code; cipher: XChaCha20-Poly1305, whose tag tells a wrong code apart.
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { pbkdf2, pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

export type SealedGift = { nonce: string; data: string };

export const GIFT_COLOR_TOKENS = [
 "fileModified", "fileDeleted", "fileUncommitted", "fileLastCommit", "background", "surface", "surfaceRaised", "border", "text", "textMuted",
 "accent", "accentText", "tabActive", "tabActiveIcon", "card", "onAccent", "attention", "working", "done", "danger", "terminalBackground", "terminalText",
] as const;
export type GiftColors = Record<(typeof GIFT_COLOR_TOKENS)[number], string>;

type Greeting = { title: string; body: string };
export type GiftThemeData = {
 id: string;
 label: string;
 greeting: { es: Greeting; en: Greeting };
 colors: GiftColors;
 primaryFill: { backgroundImage?: string; shadowColor?: string };
 working?: { frames: string[]; intervalMs: number };
 mascot?: GiftMascot;
 avatar?: GiftAvatar;
};
/**
 * Pixel art drawn under the logo. Each row is a string of palette keys; "." is transparent.
 * Each pixel is `pixel.width` × `pixel.height` units, so non-square terminal cells keep their aspect.
 */
export type GiftMascot = { palette: Record<string, string>; rows: string[]; pixel: { width: number; height: number }; caption?: string };
/** Pixel art shown in the unlock greeting, inside a round frame with an optional glowing ring. */
export type GiftAvatar = { image: Omit<GiftMascot, "caption">; ring?: { color: string; glow: string } };
export type UnlockedGift = { code: string; theme: GiftThemeData };

/** Names a gift can never take, so it cannot shadow a built-in theme. */
export const RESERVED_THEME_IDS = ["verde-profundo", "oro-y-verde"] as const;

// Fixed, public salt: it only stops precomputed tables across apps. 20k rounds take about a second without a JIT.
const SALT = hexToBytes("6d6172732d72616d2d6769667473a7c3");
const ROUNDS = 20_000;
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function normalizeGiftCode(input: string): string {
 return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
export function formatGiftCode(code: string): string {
 const clean = normalizeGiftCode(code);
 return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}
/** Eight characters without look-alikes (0/O, 1/I/L), one per random byte. */
export function generateGiftCode(random: Uint8Array): string {
 return Array.from(random.slice(0, 8), byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

// UTF-8 through percent-encoding: works on every JS engine, including ones without TextDecoder.
function utf8Encode(text: string): Uint8Array {
 const encoded = encodeURIComponent(text);
 const bytes: number[] = [];
 for (let i = 0; i < encoded.length; i++) {
  if (encoded[i] === "%") { bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16)); i += 2; }
  else bytes.push(encoded.charCodeAt(i));
 }
 return Uint8Array.from(bytes);
}
function utf8Decode(bytes: Uint8Array): string {
 return decodeURIComponent(Array.from(bytes, byte => `%${byte.toString(16).padStart(2, "0")}`).join(""));
}

const keyOptions = { c: ROUNDS, dkLen: 32 } as const;

export function sealGiftTheme(code: string, theme: GiftThemeData, nonce: Uint8Array): SealedGift {
 const key = pbkdf2(sha256, utf8Encode(normalizeGiftCode(code)), SALT, keyOptions);
 const data = xchacha20poly1305(key, nonce).encrypt(utf8Encode(JSON.stringify(theme)));
 return { nonce: bytesToHex(nonce), data: bytesToHex(data) };
}

/** The theme this code opens, or null. Yields while deriving the key so the screen stays responsive. */
export async function openGiftTheme(code: string, sealed: readonly SealedGift[]): Promise<GiftThemeData | null> {
 const clean = normalizeGiftCode(code);
 if (!clean) return null;
 const key = await pbkdf2Async(sha256, utf8Encode(clean), SALT, keyOptions);
 for (const gift of sealed) {
  try {
   const plain = xchacha20poly1305(key, hexToBytes(gift.nonce)).decrypt(hexToBytes(gift.data));
   const theme = parseGiftThemeData(JSON.parse(utf8Decode(plain)));
   if (theme) return theme;
  } catch { /* Not this one: wrong key or damaged entry. */ }
 }
 return null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const RGBA = /^rgba\((\d{1,3}), (\d{1,3}), (\d{1,3}), (0|1|0?\.\d+)\)$/;
const isColor = (value: string) => HEX.test(value) || ((match) => !!match && [1, 2, 3].every(i => Number(match[i]) <= 255))(RGBA.exec(value));
// A vertical gradient of 2 to 6 hex stops, as the built-in themes use.
const GRADIENT = /^linear-gradient\(\d{1,3}deg(, #[0-9A-Fa-f]{6} \d{1,3}%){2,6}\)$/;

const isPixelSize = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0.5 && value <= 16;

function parseMascot(value: unknown): GiftMascot | null {
 if (!isRecord(value) || !isRecord(value.palette) || !Array.isArray(value.rows) || !isRecord(value.pixel)) return null;
 const entries = Object.entries(value.palette);
 if (entries.length < 1 || entries.length > 16) return null;
 const palette: Record<string, string> = {};
 for (const [key, color] of entries) {
  if (key.length !== 1 || key === "." || typeof color !== "string" || !HEX.test(color)) return null;
  palette[key] = color;
 }
 const { rows, pixel, caption } = value;
 if (rows.length < 1 || rows.length > 64) return null;
 const width = typeof rows[0] === "string" ? rows[0].length : 0;
 if (width < 1 || width > 128) return null;
 for (const row of rows) {
  if (typeof row !== "string" || row.length !== width) return null;
  for (const cell of row) if (cell !== "." && !Object.prototype.hasOwnProperty.call(palette, cell)) return null;
 }
 if (!isPixelSize(pixel.width) || !isPixelSize(pixel.height)) return null;
 const mascot: GiftMascot = { palette, rows: [...rows] as string[], pixel: { width: pixel.width, height: pixel.height } };
 if (caption !== undefined) { if (!isText(caption, 40)) return null; mascot.caption = caption; }
 return mascot;
}

function parseAvatar(value: unknown): GiftAvatar | null {
 if (!isRecord(value) || !isRecord(value.image)) return null;
 const { caption: _caption, ...grid } = value.image;
 const image = parseMascot(grid);
 if (!image) return null;
 const avatar: GiftAvatar = { image };
 if (value.ring !== undefined) {
  const { ring } = value;
  if (!isRecord(ring) || typeof ring.color !== "string" || !HEX.test(ring.color) || typeof ring.glow !== "string" || !HEX.test(ring.glow)) return null;
  avatar.ring = { color: ring.color, glow: ring.glow };
 }
 return avatar;
}

function parseGreeting(value: unknown): Greeting | null {
 return isRecord(value) && isText(value.title, 80) && isText(value.body, 300) ? { title: value.title, body: value.body } : null;
}

/** Validates a decrypted or stored theme; anything unexpected is rejected as a whole. */
export function parseGiftThemeData(value: unknown): GiftThemeData | null {
 if (!isRecord(value) || !isRecord(value.greeting) || !isRecord(value.colors) || !isRecord(value.primaryFill)) return null;
 const { id, label, greeting, colors, primaryFill, working, mascot, avatar } = value;
 if (typeof id !== "string" || !/^[a-z0-9-]{1,40}$/.test(id) || (RESERVED_THEME_IDS as readonly string[]).includes(id) || !isText(label, 40)) return null;
 const es = parseGreeting(greeting.es), en = parseGreeting(greeting.en);
 if (!es || !en) return null;
 const parsedColors = {} as GiftColors;
 for (const token of GIFT_COLOR_TOKENS) {
  const color = colors[token];
  if (typeof color !== "string" || !isColor(color)) return null;
  parsedColors[token] = color;
 }
 const fill: GiftThemeData["primaryFill"] = {};
 if (primaryFill.backgroundImage !== undefined) { if (typeof primaryFill.backgroundImage !== "string" || !GRADIENT.test(primaryFill.backgroundImage)) return null; fill.backgroundImage = primaryFill.backgroundImage; }
 if (primaryFill.shadowColor !== undefined) { if (typeof primaryFill.shadowColor !== "string" || !HEX.test(primaryFill.shadowColor)) return null; fill.shadowColor = primaryFill.shadowColor; }
 const theme: GiftThemeData = { id, label, greeting: { es, en }, colors: parsedColors, primaryFill: fill };
 if (working !== undefined) {
  if (!isRecord(working) || !Array.isArray(working.frames) || working.frames.length < 1 || working.frames.length > 12) return null;
  if (!working.frames.every(frame => isText(frame, 4))) return null;
  if (typeof working.intervalMs !== "number" || !Number.isInteger(working.intervalMs) || working.intervalMs < 50 || working.intervalMs > 2000) return null;
  theme.working = { frames: [...working.frames], intervalMs: working.intervalMs };
 }
 if (mascot !== undefined) {
  const parsed = parseMascot(mascot);
  if (!parsed) return null;
  theme.mascot = parsed;
 }
 if (avatar !== undefined) {
  const parsed = parseAvatar(avatar);
  if (!parsed) return null;
  theme.avatar = parsed;
 }
 return theme;
}

/** The gifts unlocked on this phone; damaged storage reads as nothing unlocked. */
export function parseUnlockedGifts(raw: string | null): UnlockedGift[] {
 let value: unknown;
 try { value = raw ? JSON.parse(raw) : []; } catch { return []; }
 if (!Array.isArray(value)) return [];
 const list: UnlockedGift[] = [];
 for (const entry of value) {
  if (!isRecord(entry) || typeof entry.code !== "string") continue;
  const code = normalizeGiftCode(entry.code), theme = parseGiftThemeData(entry.theme);
  if (code && theme && !list.some(gift => gift.theme.id === theme.id)) list.push({ code, theme });
 }
 return list;
}
/** Reopens each stored gift with its own code against the app's sealed themes, so an app update refreshes
 * gifts unlocked before it. A code that opens nothing, or opens another theme, keeps the stored copy. */
export async function refreshUnlockedGifts(list: readonly UnlockedGift[], sealed: readonly SealedGift[]): Promise<{ changed: boolean; gifts: UnlockedGift[] }> {
 let changed = false;
 const gifts: UnlockedGift[] = [];
 for (const gift of list) {
  const fresh = await openGiftTheme(gift.code, sealed);
  if (fresh && fresh.id === gift.theme.id && JSON.stringify(fresh) !== JSON.stringify(gift.theme)) { changed = true; gifts.push({ code: gift.code, theme: fresh }); }
  else gifts.push(gift);
 }
 return { changed, gifts };
}
export function serializeUnlockedGifts(list: readonly UnlockedGift[]): string {
 return JSON.stringify(list);
}
