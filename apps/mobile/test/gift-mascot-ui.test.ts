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
const { GiftMascot, mascotSegments } = await import("../src/ui/gift-mascot");

type Node = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Node[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
// An invented mascot: 3 rows × 4 columns, two made-up colors.
const mascot = { palette: { a: "#123456", b: "#ABCDEF" }, rows: ["aab.", ".bba", "a..b"], pixel: { width: 2, height: 3 }, caption: "Sample" };
const baseTheme = { spacing: (n: number) => n * 4, touch: 48, colors: { text: "white", textMuted: "gray", accentText: "blue", attention: "#E3C47F" } };

describe("the mascot under the logo", () => {
 beforeEach(() => { prefs.theme = baseTheme; });

 it("fades the small logo only while a gift mascot shows", () => {
  const logoOf = (welcome: boolean) => ([elements(HomeHeading({ welcome }))[0].props.children].flat().filter(isValidElement) as unknown as Node[])[0];
  for (const welcome of [true, false]) expect(logoOf(welcome).props.style.opacity).toBeUndefined();
  prefs.theme = { ...baseTheme, mascot };
  for (const welcome of [true, false]) expect(logoOf(welcome).props.style.opacity).toBe(0.35);
 });
 it("puts the small logo against the top edge only while a gift mascot shows", () => {
  for (const welcome of [true, false]) {
   expect(elements(HomeHeading({ welcome }))[0].props.style.paddingTop).toBeUndefined();
  }
  prefs.theme = { ...baseTheme, mascot };
  for (const welcome of [true, false]) {
   expect(elements(HomeHeading({ welcome }))[0].props.style.paddingTop).toBe(0);
  }
 });
 it("is not drawn for themes without one, and the logo keeps its full size", () => {
  for (const [welcome, size] of [[true, { width: 250, height: 198 }], [false, { width: 120, height: 95 }]] as const) {
   expect(elements(HomeHeading({ welcome })).some(node => node.type === GiftMascot)).toBe(false);
   const children = [elements(HomeHeading({ welcome }))[0].props.children].flat().filter(isValidElement) as unknown as Node[];
   expect(children[0].props.style).toEqual(size);
  }
 });

 it("is the hero right below the ram, shrunk to a small top logo, captioned in the attention color", () => {
  prefs.theme = { ...baseTheme, mascot };
  for (const [welcome, width, logo] of [[true, 250, { width: 64, height: 51, opacity: 0.35 }], [false, 160, { width: 44, height: 35, opacity: 0.35 }]] as const) {
   const children = [elements(HomeHeading({ welcome }))[0].props.children].flat().filter(isValidElement) as unknown as Node[];
   expect(children[0].type).toBe("Image");
   expect(children[0].props.style).toEqual(logo);
   expect(children[1].type).toBe(GiftMascot);
   expect(children[1].props).toEqual({ mascot, width, captionColor: "#E3C47F" });
  }
 });
});

describe("the mascot drawing", () => {
 it("merges runs of the same color in a row and leaves transparent cells as spacing", () => {
  expect(mascotSegments(mascot)).toEqual([
   { row: 0, start: 0, length: 2, color: "#123456" }, { row: 0, start: 2, length: 1, color: "#ABCDEF" },
   { row: 1, start: 1, length: 2, color: "#ABCDEF" }, { row: 1, start: 3, length: 1, color: "#123456" },
   { row: 2, start: 0, length: 1, color: "#123456" }, { row: 2, start: 3, length: 1, color: "#ABCDEF" },
  ]);
 });

 it("draws one view per run, scaled to the width with the pixel aspect", () => {
  const nodes = elements(GiftMascot({ mascot, width: 80, captionColor: "#E3C47F" }));
  const cells = nodes.filter(node => node.type === "View" && node.props.style?.backgroundColor);
  expect(cells).toHaveLength(6);
  // 4 columns over 80 units: each cell is 20 wide and 20 × 3/2 = 30 tall.
  expect(cells[0].props.style).toMatchObject({ left: 0, top: 0, width: 40, height: 30, backgroundColor: "#123456" });
  expect(cells[5].props.style).toMatchObject({ left: 60, top: 60, width: 20, height: 30, backgroundColor: "#ABCDEF" });
  expect(nodes[1].props.style).toMatchObject({ width: 80, height: 90 });
 });

 it("is named by its caption, shown in the given color with letter spacing", () => {
  const nodes = elements(GiftMascot({ mascot, width: 80, captionColor: "#E3C47F" }));
  expect(nodes[0].props).toMatchObject({ accessible: true, accessibilityLabel: "Sample" });
  const caption = nodes.find(node => node.type === "Text")!;
  expect(caption.props.children).toBe("Sample");
  expect(caption.props.style).toMatchObject({ color: "#E3C47F" });
  expect(caption.props.style.letterSpacing).toBeGreaterThan(0);
 });

 it("is hidden from accessibility without a caption", () => {
  const { caption: _caption, ...silent } = mascot;
  const nodes = elements(GiftMascot({ mascot: silent, width: 80, captionColor: "#E3C47F" }));
  expect(nodes[0].props).toMatchObject({ accessible: false, importantForAccessibility: "no-hide-descendants" });
  expect(nodes.some(node => node.type === "Text")).toBe(false);
 });
});
