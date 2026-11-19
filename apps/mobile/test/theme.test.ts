import { describe, expect, it } from "vitest";
import { giftTheme, resolveThemeName, themes } from "../src/ui/theme";
import { parseGiftThemeData } from "../src/core/gift-themes";

function contrast(a: string, b: string): number {
 const luminance = (hex: string) => {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
 };
 const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
 return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("theme preferences", () => {
 it.each(["dark", "light", "unknown", null, undefined])("defaults for legacy or unknown value %s", value => {
  expect(resolveThemeName(value)).toBe("verde-profundo");
 });
 it.each(["verde-profundo", "oro-y-verde"])("round-trips %s", value => {
  expect(resolveThemeName(JSON.parse(JSON.stringify(value)))).toBe(value);
  expect(resolveThemeName(value, ["sample-gift"])).toBe(value);
 });
 it("keeps a gift theme only while it is unlocked on this phone", () => {
  expect(resolveThemeName("sample-gift", ["sample-gift"])).toBe("sample-gift");
  expect(resolveThemeName("sample-gift", [])).toBe("verde-profundo");
  expect(resolveThemeName("sample-gift")).toBe("verde-profundo");
 });
});

describe("gift themes", () => {
 it("builds a full theme from gift data, with the shared spacing and radius", () => {
  const data = parseGiftThemeData({
   id: "sample-gift", label: "Sample", greeting: { es: { title: "Hola", body: "Tuyo" }, en: { title: "Hi", body: "Yours" } },
   colors: { ...themes["verde-profundo"].colors }, primaryFill: { shadowColor: "#126E46" }, working: { frames: ["◐", "◓"], intervalMs: 350 },
  })!;
  const theme = giftTheme(data);
  expect(theme.name).toBe("sample-gift");
  expect(theme.colors).toEqual(data.colors);
  expect(theme.primaryFill).toEqual({ shadowColor: "#126E46" });
  expect(theme.working).toEqual({ frames: ["◐", "◓"], intervalMs: 350 });
  expect(theme.radius).toEqual(themes["verde-profundo"].radius);
  expect(theme.spacing(3)).toBe(themes["verde-profundo"].spacing(3));
 });
 it("carries the gift's mascot, and only gifts have one", () => {
  const mascot = { palette: { a: "#123456" }, rows: ["a.a"], pixel: { width: 2, height: 3 }, caption: "Sample" };
  const data = parseGiftThemeData({
   id: "sample-gift", label: "Sample", greeting: { es: { title: "Hola", body: "Tuyo" }, en: { title: "Hi", body: "Yours" } },
   colors: { ...themes["verde-profundo"].colors }, primaryFill: {}, mascot,
  })!;
  expect(giftTheme(data).mascot).toEqual(mascot);
  expect(giftTheme({ ...data, mascot: undefined })).not.toHaveProperty("mascot");
  expect(themes["verde-profundo"].mascot).toBeUndefined();
  expect(themes["oro-y-verde"].mascot).toBeUndefined();
 });
 it("keeps the built-in themes on their usual working indicator", () => {
  expect(themes["verde-profundo"].working).toBeUndefined();
  expect(themes["oro-y-verde"].working).toBeUndefined();
 });
});

describe("theme contrast", () => {
 it.each(["verde-profundo", "oro-y-verde"] as const)("file state names meet AA on the sheet for %s", name => {
  const { colors } = themes[name];
  for (const token of ["fileModified", "fileDeleted", "fileUncommitted", "fileLastCommit"] as const) {
   expect(colors[token]).toBeDefined();
   expect(contrast(colors[token], colors.surface)).toBeGreaterThanOrEqual(4.5);
   expect(contrast(colors[token], colors.surfaceRaised)).toBeGreaterThanOrEqual(4.5);
  }
 });
 it.each(["verde-profundo", "oro-y-verde"] as const)("meets AA for %s", name => {
  const { colors } = themes[name];
  expect(contrast(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(colors.textMuted, colors.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(colors.onAccent, colors.accent)).toBeGreaterThanOrEqual(4.5);
 });
 it.each(["verde-profundo", "oro-y-verde"] as const)("active tab icon and label stay readable on the tab bar for %s", name => {
  const { colors } = themes[name];
  expect(contrast(colors.tabActive, colors.surface)).toBeGreaterThanOrEqual(4.5);
 });
 it.each(["verde-profundo", "oro-y-verde"] as const)("active tab icon is darker than its label but still visible for %s", name => {
  const { colors } = themes[name];
  expect(contrast(colors.tabActiveIcon, colors.surface)).toBeGreaterThanOrEqual(3);
  expect(contrast(colors.tabActiveIcon, colors.surface)).toBeLessThan(contrast(colors.tabActive, colors.surface));
 });
 it.each(["verde-profundo", "oro-y-verde"] as const)("cards are translucent and keep their text readable for %s", name => {
  const { colors } = themes[name];
  const card = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(colors.card);
  expect(card).not.toBeNull();
  const alpha = Number(card![4]);
  expect(alpha).toBeLessThan(1);
  // Worst case: the card over the brightest part of the glow image (#3A2E10 at most).
  const under = [0x3a, 0x2e, 0x10];
  const mixed = "#" + [1, 2, 3].map(i => Math.round(Number(card![i]) * alpha + under[i - 1] * (1 - alpha)).toString(16).padStart(2, "0")).join("");
  expect(contrast(colors.text, mixed)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(colors.textMuted, mixed)).toBeGreaterThanOrEqual(4.5);
 });
 it.each(["verde-profundo", "oro-y-verde"] as const)("accent text and icons stay readable on dark surfaces for %s", name => {
  const { colors } = themes[name];
  for (const surface of [colors.background, colors.surface, colors.surfaceRaised, colors.terminalBackground]) {
   expect(contrast(colors.accentText, surface)).toBeGreaterThanOrEqual(4.5);
  }
 });
});
