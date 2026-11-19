import { createRequire } from "node:module";
import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// HomeHeading requires the logo PNG as Metro would; under Node it reads as an opaque asset id.
createRequire(import.meta.url).extensions[".png"] = (module: { exports: unknown }) => { module.exports = "png-asset"; };

vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("react-native", () => ({ Image: "Image", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" }));
vi.mock("../src/ui/components", () => ({ PrimaryButton: "PrimaryButton", Screen: "Screen" }));
vi.mock("../src/ui/install-help", () => ({ InstallSteps: "InstallSteps" }));
const prefs = vi.hoisted(() => ({ theme: {} as Record<string, unknown> }));
vi.mock("../src/ui/preferences", async () => {
 const { es } = await import("../src/ui/i18n/es");
 return { usePreferences: () => ({ t: es, theme: prefs.theme }) };
});

const { HomeHeading } = await import("../src/ui/home-welcome");
const { GiftMascot } = await import("../src/ui/gift-mascot");
const { GiftPhoto } = await import("../src/ui/gift-photo");

type Node = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Node[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
// Invented: a 14-byte stand-in with only the JPEG markers, a made-up caption and ring colors.
const jpeg = "/9j/4AAQSkZJRgAB/9k=";
const photo = { jpeg, caption: "Sample", ring: { color: "#AA11BB", glow: "#CC22DD" } };
const mascot = { palette: { a: "#123456" }, rows: ["a."], pixel: { width: 1, height: 1 } };
const baseTheme = { spacing: (n: number) => n * 4, touch: 48, colors: { text: "white", textMuted: "gray", accentText: "blue", attention: "#E3C47F" } };
const heading = (welcome: boolean) => elements(HomeHeading({ welcome }))[0];
const children = (welcome: boolean) => [heading(welcome).props.children].flat().filter(isValidElement) as unknown as Node[];

describe("the photo hero on Home", () => {
 beforeEach(() => { prefs.theme = baseTheme; });

 it("is the hero below a small, faded logo against the top edge, sized 200 welcome and 128 compact", () => {
  prefs.theme = { ...baseTheme, photo };
  for (const [welcome, size, logo] of [[true, 200, { width: 64, height: 51, opacity: 0.35 }], [false, 128, { width: 44, height: 35, opacity: 0.35 }]] as const) {
   const [ram, hero] = children(welcome);
   expect(ram.type).toBe("Image");
   expect(ram.props.style).toEqual(logo);
   expect(heading(welcome).props.style.paddingTop).toBe(0);
   expect(hero.type).toBe(GiftPhoto);
   expect(hero.props).toEqual({ photo, size, captionColor: "#E3C47F" });
  }
 });

 it("fades only the ram logo: the photo, its ring and caption stay fully opaque", () => {
  prefs.theme = { ...baseTheme, photo };
  for (const welcome of [true, false]) {
   const [ram, hero] = children(welcome);
   expect(ram.props.style.opacity).toBe(0.35);
   expect(hero.props).not.toHaveProperty("opacity");
   expect(hero.props).not.toHaveProperty("style");
   const drawn = elements(GiftPhoto(hero.props as Parameters<typeof GiftPhoto>[0]));
   const photoImage = drawn.find(node => node.type === "Image")!;
   expect(photoImage.props.source.uri).toContain(jpeg);
   for (const node of drawn) {
    const opacity = node.props.style?.opacity ?? node.props.opacity;
    if (opacity !== undefined) expect(opacity).toBeGreaterThanOrEqual(1);
   }
   expect(photoImage.props.style.opacity ?? 1).toBe(1);
  }
 });

 it("keeps the full-size logo and no hero without a photo or mascot", () => {
  for (const [welcome, size] of [[true, { width: 250, height: 198 }], [false, { width: 120, height: 95 }]] as const) {
   expect(children(welcome)[0].props.style).toEqual(size);
   expect(heading(welcome).props.style.paddingTop).toBeUndefined();
   expect(elements(HomeHeading({ welcome })).some(node => node.type === GiftPhoto || node.type === GiftMascot)).toBe(false);
  }
 });

 it("shows the photo, not the mascot, when the theme has both", () => {
  prefs.theme = { ...baseTheme, photo, mascot };
  for (const welcome of [true, false]) {
   const nodes = elements(HomeHeading({ welcome }));
   expect(nodes.some(node => node.type === GiftPhoto)).toBe(true);
   expect(nodes.some(node => node.type === GiftMascot)).toBe(false);
   expect(children(welcome)[0].props.style.opacity).toBe(0.35);
  }
 });
});

describe("the gift photo", () => {
 it("draws the JPEG as a clipped circle inside a glowing ring", () => {
  const nodes = elements(GiftPhoto({ photo, size: 200, captionColor: "#E3C47F" }));
  const [ring, clip] = nodes.filter(node => node.type === "View").slice(1);
  expect(ring.props.style).toMatchObject({ width: 200, height: 200, borderRadius: 100, borderWidth: 2, borderColor: "#AA11BB", shadowColor: "#CC22DD", shadowRadius: 14 });
  expect(ring.props.style.shadowOpacity).toBeGreaterThan(0);
  expect(ring.props.style.elevation).toBeGreaterThan(0);
  expect(clip.props.style).toMatchObject({ borderRadius: 100, overflow: "hidden" });
  const image = nodes.find(node => node.type === "Image")!;
  expect(image.props.source).toEqual({ uri: `data:image/jpeg;base64,${jpeg}` });
  expect(image.props.resizeMode).toBe("cover");
 });

 it("has no ring without one", () => {
  const nodes = elements(GiftPhoto({ photo: { jpeg }, size: 128, captionColor: "#E3C47F" }));
  const ring = nodes.filter(node => node.type === "View")[1];
  expect(ring.props.style).toMatchObject({ width: 128, borderRadius: 64 });
  expect(ring.props.style).not.toHaveProperty("borderWidth");
  expect(ring.props.style).not.toHaveProperty("shadowColor");
 });

 it("is named by its caption, shown in the given color with letter spacing", () => {
  const nodes = elements(GiftPhoto({ photo, size: 200, captionColor: "#E3C47F" }));
  expect(nodes[0].props).toMatchObject({ accessible: true, accessibilityRole: "image", accessibilityLabel: "Sample" });
  const caption = nodes.find(node => node.type === "Text")!;
  expect(caption.props.children).toBe("Sample");
  expect(caption.props.style).toMatchObject({ color: "#E3C47F" });
  expect(caption.props.style.letterSpacing).toBeGreaterThan(0);
 });

 it("is hidden from accessibility without a caption", () => {
  const nodes = elements(GiftPhoto({ photo: { jpeg }, size: 200, captionColor: "#E3C47F" }));
  expect(nodes[0].props).toMatchObject({ accessible: false, importantForAccessibility: "no-hide-descendants" });
  expect(nodes.some(node => node.type === "Text")).toBe(false);
 });
});
