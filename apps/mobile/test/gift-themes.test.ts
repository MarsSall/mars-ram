import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatGiftCode, generateGiftCode, normalizeGiftCode, openGiftTheme, parseGiftThemeData, parseUnlockedGifts, refreshUnlockedGifts, sealGiftTheme, serializeUnlockedGifts, type GiftThemeData } from "../src/core/gift-themes";
import { sealedGifts } from "../src/core/gift-themes-sealed";

const sample: GiftThemeData = {
 id: "sample-gift",
 label: "Sample ◐",
 greeting: { es: { title: "Hola Ana", body: "Este tema es tuyo." }, en: { title: "Hi Ana", body: "This theme is yours." } },
 colors: {
  fileModified: "#E5B567", fileDeleted: "#F27A7A", fileUncommitted: "#93C9A0", fileLastCommit: "#9FC4EE",
  background: "#10141C", surface: "#151A24", surfaceRaised: "#1B2230", border: "#3E6FB0", text: "#EEF1F6", textMuted: "#97A3B5",
  accent: "#6FB3F0", accentText: "#9CCBFF", tabActive: "#9CCBFF", tabActiveIcon: "#7FA8D8", card: "rgba(27, 34, 48, 0.72)", onAccent: "#10141C",
  attention: "#E3C47F", working: "#ADE3C0", done: "#ADE3C0", danger: "#F27A7A", terminalBackground: "#10141C", terminalText: "#EEF1F6",
 },
 primaryFill: { backgroundImage: "linear-gradient(180deg, #9CCBFF 0%, #6FB3F0 55%, #4A86C8 100%)" },
 working: { frames: ["◐", "◓", "◑", "◒"], intervalMs: 350 },
};
const nonce = new Uint8Array(24).fill(7);

describe("gift codes", () => {
 it.each([["cute-7k2p", "CUTE7K2P"], [" CUTE 7K2P ", "CUTE7K2P"], ["Cu-Te_7k.2p", "CUTE7K2P"], ["", ""]])("normalizes %j to %j", (input, expected) => {
  expect(normalizeGiftCode(input)).toBe(expected);
 });
 it("formats an 8-character code as two groups", () => {
  expect(formatGiftCode("cute7k2p")).toBe("CUTE-7K2P");
 });
 it("generates 8 unambiguous characters from the given random bytes", () => {
  const code = generateGiftCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 255]));
  expect(code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
  expect(generateGiftCode(new Uint8Array(8).fill(9))).toBe(generateGiftCode(new Uint8Array(8).fill(9)));
 });
});

describe("sealed gift themes", () => {
 const sealed = sealGiftTheme("CUTE-7K2P", sample, nonce);
 it("opens with the right code, however it is typed", async () => {
  expect(await openGiftTheme("cute 7k2p", [sealed])).toEqual(sample);
 });
 it("stays closed with a wrong code", async () => {
  expect(await openGiftTheme("CUTE-7K2Q", [sealed])).toBeNull();
  expect(await openGiftTheme("", [sealed])).toBeNull();
 });
 it("finds the matching theme among several", async () => {
  const other = sealGiftTheme("ZZZZ-2222", { ...sample, id: "other-gift" }, new Uint8Array(24).fill(3));
  expect((await openGiftTheme("ZZZZ2222", [sealed, other]))?.id).toBe("other-gift");
 });
 it("rejects tampered data", async () => {
  const flipped = sealed.data.slice(0, -2) + (sealed.data.endsWith("00") ? "01" : "00");
  expect(await openGiftTheme("CUTE7K2P", [{ ...sealed, data: flipped }])).toBeNull();
 });
 it("reveals nothing readable", () => {
  expect(sealed.data).toMatch(/^[0-9a-f]+$/);
  expect(sealed.data).not.toContain(Buffer.from("Ana").toString("hex"));
 });
 it("ships only opaque entries in the source", () => {
  const source = readFileSync(new URL("../src/core/gift-themes-sealed.ts", import.meta.url), "utf8");
  expect(sealedGifts.length).toBeGreaterThan(0);
  for (const gift of sealedGifts) { expect(gift.nonce).toMatch(/^[0-9a-f]{48}$/); expect(gift.data).toMatch(/^[0-9a-f]{64,}$/); }
  // Only the import and opaque hex entries: no names, greetings or colors in clear text.
  expect(source.replace(/\{"nonce":"[0-9a-f]+","data":"[0-9a-f]+"\},?/g, "")).not.toMatch(/"[^"]*"\s*[:,}\]]|#[0-9a-f]{3,8}\b/i);
 });
});

describe("gift theme data", () => {
 it("accepts a complete theme", () => {
  expect(parseGiftThemeData(JSON.parse(JSON.stringify(sample)))).toEqual(sample);
 });
 it.each([
  ["missing color", { ...sample, colors: { ...sample.colors, text: undefined } }],
  ["bad color", { ...sample, colors: { ...sample.colors, text: "red; x" } }],
  ["built-in id", { ...sample, id: "verde-profundo" }],
  ["bad id", { ...sample, id: "Hola Ana" }],
  ["empty frames", { ...sample, working: { frames: [], intervalMs: 350 } }],
  ["out-of-range rgba", { ...sample, colors: { ...sample.colors, card: "rgba(999, 999, 999, 0.5)" } }],
  ["nonsense gradient", { ...sample, primaryFill: { backgroundImage: "linear-gradient(nonsense)" } }],
  ["bad interval", { ...sample, working: { frames: ["◐"], intervalMs: 5 } }],
  ["not an object", "x"],
 ])("rejects %s", (_name, value) => {
  expect(parseGiftThemeData(value)).toBeNull();
 });
});

describe("gift mascot", () => {
 const mascot = { palette: { a: "#123456", b: "#ABCDEF" }, rows: ["aab.", ".bba", "a..b"], pixel: { width: 2, height: 3 }, caption: "Sample" };
 const withMascot = (value: unknown) => ({ ...sample, mascot: value });
 it("accepts a small mascot", () => {
  expect(parseGiftThemeData(JSON.parse(JSON.stringify(withMascot(mascot))))?.mascot).toEqual(mascot);
  const { caption: _caption, ...noCaption } = mascot;
  expect(parseGiftThemeData(withMascot(noCaption))?.mascot).toEqual(noCaption);
 });
 it("keeps themes without a mascot as they were", () => {
  expect(parseGiftThemeData(sample)).not.toHaveProperty("mascot");
 });
 it.each([
  ["no rows", { ...mascot, rows: [] }],
  ["too many rows", { ...mascot, rows: Array(65).fill("a") }],
  ["uneven rows", { ...mascot, rows: ["aab.", ".bb"] }],
  ["empty rows", { ...mascot, rows: [""] }],
  ["too wide", { ...mascot, rows: ["a".repeat(129)] }],
  ["non-string row", { ...mascot, rows: [1234] }],
  ["unknown key in a row", { ...mascot, rows: ["aabc"] }],
  ["empty palette", { ...mascot, palette: {}, rows: ["...."] }],
  ["too many colors", { ...mascot, palette: Object.fromEntries("abcdefghijklmnopq".split("").map(key => [key, "#123456"])) }],
  ["multi-character key", { ...mascot, palette: { ...mascot.palette, ab: "#123456" } }],
  ["transparent key", { ...mascot, palette: { ...mascot.palette, ".": "#123456" } }],
  ["non-hex color", { ...mascot, palette: { ...mascot.palette, a: "rgba(1, 2, 3, 0.5)" } }],
  ["pixel too small", { ...mascot, pixel: { width: 0.4, height: 3 } }],
  ["pixel too large", { ...mascot, pixel: { width: 2, height: 17 } }],
  ["pixel not a number", { ...mascot, pixel: { width: "2", height: 3 } }],
  ["missing pixel", { ...mascot, pixel: undefined }],
  ["long caption", { ...mascot, caption: "x".repeat(41) }],
  ["empty caption", { ...mascot, caption: "" }],
  ["not an object", "mascot"],
 ])("rejects the whole theme for %s", (_name, value) => {
  expect(parseGiftThemeData(withMascot(value))).toBeNull();
 });
 it("seals and opens a theme with its mascot", async () => {
  const theme = withMascot(mascot) as GiftThemeData;
  expect(await openGiftTheme("CUTE7K2P", [sealGiftTheme("CUTE7K2P", theme, nonce)])).toEqual(theme);
 });
});

describe("gift greeting avatar", () => {
 // Invented: a 2 × 3 grid and made-up ring colors.
 const image = { palette: { a: "#102030", b: "#405060" }, rows: ["ab.", ".ba"], pixel: { width: 1, height: 1 } };
 const avatar = { image, ring: { color: "#AA11BB", glow: "#CC22DD" } };
 const withAvatar = (value: unknown) => ({ ...sample, avatar: value });
 it("accepts a small avatar with a ring, and one without a ring", () => {
  expect(parseGiftThemeData(JSON.parse(JSON.stringify(withAvatar(avatar))))?.avatar).toEqual(avatar);
  expect(parseGiftThemeData(withAvatar({ image }))?.avatar).toEqual({ image });
 });
 it("ignores a caption on the avatar image", () => {
  expect(parseGiftThemeData(withAvatar({ ...avatar, image: { ...image, caption: "x".repeat(99) } }))?.avatar).toEqual(avatar);
 });
 it("keeps themes without an avatar as they were", () => {
  expect(parseGiftThemeData(sample)).not.toHaveProperty("avatar");
 });
 it.each([
  ["a bad ring color", { ...avatar, ring: { color: "red", glow: "#CC22DD" } }],
  ["a short ring glow", { ...avatar, ring: { color: "#AA11BB", glow: "#CC2" } }],
  ["an rgba ring", { ...avatar, ring: { color: "rgba(1, 2, 3, 0.5)", glow: "#CC22DD" } }],
  ["a missing glow", { ...avatar, ring: { color: "#AA11BB" } }],
  ["a ring that is not an object", { ...avatar, ring: "#AA11BB" }],
  ["uneven rows", { ...avatar, image: { ...image, rows: ["ab.", "b"] } }],
  ["an unknown key", { ...avatar, image: { ...image, rows: ["abz", ".ba"] } }],
  ["a missing image", { ring: avatar.ring }],
  ["not an object", "avatar"],
 ])("rejects the whole theme for %s", (_name, value) => {
  expect(parseGiftThemeData(withAvatar(value))).toBeNull();
 });
 it("seals and opens a theme with its avatar", async () => {
  const theme = withAvatar(avatar) as GiftThemeData;
  expect(await openGiftTheme("TEST2345", [sealGiftTheme("TEST2345", theme, nonce)])).toEqual(theme);
 });
});

describe("gift style", () => {
 // Invented values only.
 const withStyle = (value: unknown) => ({ ...sample, style: value });
 const parse = (value: unknown) => parseGiftThemeData(JSON.parse(JSON.stringify(withStyle(value))));
 it("accepts a full style and each part on its own", () => {
  const full = { hud: { color: "#12AB34" }, backdrop: "circuit", titles: "mono" };
  expect(parse(full)?.style).toEqual(full);
  expect(parse({ hud: { color: "#abcdef" } })?.style).toEqual({ hud: { color: "#abcdef" } });
  expect(parse({ backdrop: "circuit" })?.style).toEqual({ backdrop: "circuit" });
  expect(parse({ titles: "mono" })?.style).toEqual({ titles: "mono" });
 });
 it("is absent when the theme has none, and an empty style adds nothing", () => {
  expect(parseGiftThemeData(sample)).not.toHaveProperty("style");
  expect(parse({})).not.toHaveProperty("style");
 });
 it("ignores unknown keys, like the rest of the theme", () => {
  expect(parse({ titles: "mono", sparkle: true })?.style).toEqual({ titles: "mono" });
  expect(parse({ hud: { color: "#12AB34", glow: "#000000" } })?.style).toEqual({ hud: { color: "#12AB34" } });
 });
 it.each([
  ["a non-object style", "hud"],
  ["a list", [{ titles: "mono" }]],
  ["a hud without color", { hud: {} }],
  ["a hud color that is not #RRGGBB", { hud: { color: "#ABC" } }],
  ["an rgba hud color", { hud: { color: "rgba(1, 2, 3, 0.5)" } }],
  ["a hud that is a string", { hud: "#12AB34" }],
  ["an unknown backdrop", { backdrop: "stars" }],
  ["unknown titles", { titles: "serif" }],
  ["a null backdrop", { backdrop: null }],
 ])("rejects the theme with %s", (_name, value) => {
  expect(parse(value)).toBeNull();
 });
 it("survives sealing and opening", async () => {
  const styled = { ...sample, style: { hud: { color: "#12AB34" }, backdrop: "circuit" as const, titles: "mono" as const } };
  expect(await openGiftTheme("ZZZZ-3333", [sealGiftTheme("ZZZZ-3333", styled, nonce)])).toEqual(styled);
 });
});

describe("refreshing unlocked gifts from the app's sealed themes", () => {
 const updated: GiftThemeData = { ...sample, label: "Sample v2" };
 it("replaces a stored copy with the newer sealed one opened by its own code", async () => {
  const sealed = [sealGiftTheme("CUTE7K2P", updated, nonce)];
  const result = await refreshUnlockedGifts([{ code: "CUTE7K2P", theme: sample }], sealed);
  expect(result).toEqual({ changed: true, gifts: [{ code: "CUTE7K2P", theme: updated }] });
 });
 it("reports no change when the stored copy is already current", async () => {
  const sealed = [sealGiftTheme("CUTE7K2P", sample, nonce)];
  expect(await refreshUnlockedGifts([{ code: "CUTE7K2P", theme: sample }], sealed)).toEqual({ changed: false, gifts: [{ code: "CUTE7K2P", theme: sample }] });
 });
 it("keeps a gift whose code no longer opens anything, and ignores a code that opens a different theme", async () => {
  const other = sealGiftTheme("ZZZZ2222", { ...sample, id: "other-gift" }, new Uint8Array(24).fill(3));
  const list = [{ code: "AAAA2222", theme: sample }, { code: "ZZZZ2222", theme: sample }];
  expect(await refreshUnlockedGifts(list, [other])).toEqual({ changed: false, gifts: list });
 });
});

describe("unlocked gifts on the phone", () => {
 it("round-trips the unlocked list", () => {
  const list = [{ code: "CUTE7K2P", theme: sample }];
  expect(parseUnlockedGifts(serializeUnlockedGifts(list))).toEqual(list);
 });
 it.each([null, "", "not json", "{}", '[{"code":"x"}]'])("reads %j as nothing unlocked", raw => {
  expect(parseUnlockedGifts(raw)).toEqual([]);
 });
 it("keeps one entry per theme", () => {
  const raw = JSON.stringify([{ code: "AAAA2222", theme: sample }, { code: "BBBB3333", theme: sample }]);
  expect(parseUnlockedGifts(raw)).toEqual([{ code: "AAAA2222", theme: sample }]);
 });
});

describe("gift photo", () => {
 // Invented: a 14-byte stand-in that only has the JPEG start and end markers (FF D8 FF … FF D9).
 const jpeg = "/9j/4AAQSkZJRgAB/9k=";
 const photo = { jpeg, caption: "Sample", ring: { color: "#AA11BB", glow: "#CC22DD" } };
 const withPhoto = (value: unknown) => ({ ...sample, photo: value });
 const jpegOf = (size: number) => { const bytes = new Uint8Array(size); bytes.set([0xff, 0xd8, 0xff]); return Buffer.from(bytes).toString("base64"); };
 it("accepts a small JPEG with a caption and ring, and a bare one", () => {
  expect(parseGiftThemeData(JSON.parse(JSON.stringify(withPhoto(photo))))?.photo).toEqual(photo);
  expect(parseGiftThemeData(withPhoto({ jpeg }))?.photo).toEqual({ jpeg });
 });
 it("accepts exactly 60000 decoded bytes, in each padding shape", () => {
  for (const size of [60_000, 59_999, 59_998]) expect(parseGiftThemeData(withPhoto({ jpeg: jpegOf(size) }))?.photo?.jpeg).toBe(jpegOf(size));
 });
 it("keeps themes without a photo as they were", () => {
  expect(parseGiftThemeData(sample)).not.toHaveProperty("photo");
 });
 it("survives sealing", async () => {
  const theme = withPhoto(photo) as GiftThemeData;
  expect(await openGiftTheme("CUTE7K2P", [sealGiftTheme("CUTE7K2P", theme, nonce)])).toEqual(theme);
 });
 it.each([
  ["a photo that is not an object", jpeg],
  ["a missing jpeg", { caption: "Sample" }],
  ["an empty jpeg", { jpeg: "" }],
  ["URL-safe base64", { jpeg: "_9j_4AAQSkZJRgAB_9k=" }],
  ["base64 with whitespace", { jpeg: "/9j/4AAQ SkZJRgAB/9k=" }],
  ["base64 without padding", { jpeg: "/9j/4AAQSkZJRgAB/9k" }],
  ["padding in the middle", { jpeg: "/9j=4AAQSkZJRgAB/9k=" }],
  ["a data URL", { jpeg: `data:image/jpeg;base64,${jpeg}` }],
  ["a PNG", { jpeg: "iVBORw0KGgo=" }],
  ["a too-short image", { jpeg: "/9g=" }],
  ["more than 60000 bytes", { jpeg: jpegOf(60_001) }],
  ["a long caption", { ...photo, caption: "x".repeat(41) }],
  ["an empty caption", { ...photo, caption: "" }],
  ["a bad ring color", { ...photo, ring: { color: "red", glow: "#CC22DD" } }],
  ["a short ring glow", { ...photo, ring: { color: "#AA11BB", glow: "#CC2" } }],
  ["a missing glow", { ...photo, ring: { color: "#AA11BB" } }],
 ])("rejects the whole theme for %s", (_name, value) => {
  expect(parseGiftThemeData(withPhoto(value))).toBeNull();
 });
});
