import { createRequire } from "node:module";
import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Gift theme style (S6): HUD cards, monospace section titles and the circuit backdrop. Invented colors only.
createRequire(import.meta.url).extensions[".png"] = (module: { exports: unknown }) => { module.exports = "png-asset"; };
vi.mock("react-native", () => ({
 AccessibilityInfo: { addEventListener: () => ({ remove: () => {} }), isReduceMotionEnabled: async () => false },
 Image: "Image", Pressable: "Pressable", StyleSheet: { hairlineWidth: 1 }, Text: "Text", View: "View", useWindowDimensions: () => ({ width: 200, height: 300 }),
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
const prefs = vi.hoisted(() => ({ theme: {} as Record<string, unknown> }));
vi.mock("../src/ui/preferences", () => ({ usePreferences: () => ({ theme: prefs.theme, t: {} }) }));

const { Card, CIRCUIT_TILE, Screen, SectionTitle } = await import("../src/ui/components");

type Node = { type: unknown; props: Record<string, any> };
/** The rendered tree, with local function components expanded. */
function elements(node: unknown): Node[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 if (typeof node.type === "function") return elements((node.type as (props: unknown) => unknown)(node.props));
 return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
const flat = (style: unknown): Record<string, unknown> => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flat)) : (style as Record<string, unknown>) ?? {};
const styleOf = (node: Node) => flat(typeof node.props.style === "function" ? node.props.style({ pressed: false }) : node.props.style);
const textOf = (node: unknown): string => Array.isArray(node) ? node.map(textOf).join("") : typeof node === "string" ? node : isValidElement<Record<string, any>>(node) ? textOf(node.props.children) : "";

const baseTheme = {
 spacing: (n: number) => n * 4, touch: 48, radius: { small: 6, medium: 10, large: 16 }, font: { mono: "monospace" },
 colors: { background: "#000001", card: "#000002", border: "#000003", surfaceRaised: "#000004", text: "#000005", textMuted: "#000006", accent: "#000007" },
};
const brackets = (nodes: Node[]) => nodes.filter(n => n.type === "View" && styleOf(n).position === "absolute");

beforeEach(() => { prefs.theme = baseTheme; });

describe("HUD cards", () => {
 it("look as before without a hud: medium radius, theme border, no brackets", () => {
  for (const onPress of [undefined, () => {}]) {
   const nodes = elements(Card({ children: "x", onPress }));
   expect(styleOf(nodes[0])).toMatchObject({ borderRadius: 10, borderColor: "#000003" });
   expect(brackets(nodes)).toEqual([]);
  }
 });

 it("get small corners, a faint hud border and two corner brackets that take no touches", () => {
  prefs.theme = { ...baseTheme, style: { hud: { color: "#12AB34" } } };
  for (const onPress of [undefined, () => {}]) {
   const nodes = elements(Card({ children: "x", onPress }));
   expect(styleOf(nodes[0])).toMatchObject({ borderRadius: 6, borderColor: "#12AB344D", padding: 16, marginHorizontal: 16 });
   const [topLeft, bottomRight] = brackets(nodes);
   expect(brackets(nodes)).toHaveLength(2);
   expect(styleOf(topLeft)).toMatchObject({ top: 0, left: 0, width: 12, height: 12, borderTopWidth: 2, borderLeftWidth: 2, borderColor: "#12AB34" });
   expect(styleOf(bottomRight)).toMatchObject({ bottom: 0, right: 0, width: 12, height: 12, borderBottomWidth: 2, borderRightWidth: 2, borderColor: "#12AB34" });
   for (const bracket of [topLeft, bottomRight]) expect(bracket.props).toMatchObject({ pointerEvents: "none", accessible: false });
  }
 });

 it("keep the press callback on the card itself", () => {
  prefs.theme = { ...baseTheme, style: { hud: { color: "#12AB34" } } };
  const onPress = vi.fn();
  const nodes = elements(Card({ children: "x", onPress }));
  nodes[0].props.onPress();
  expect(onPress).toHaveBeenCalledOnce();
 });
});

describe("monospace section titles", () => {
 it("are plain without the style", () => {
  const text = elements(SectionTitle({ children: "Activas" })).find(n => n.type === "Text")!;
  expect(textOf(text.props.children)).toBe("Activas");
  expect(styleOf(text).fontFamily).toBeUndefined();
 });

 it("use the mono font and the «// » prefix with titles mono", () => {
  prefs.theme = { ...baseTheme, style: { titles: "mono" } };
  const text = elements(SectionTitle({ children: "Activas" })).find(n => n.type === "Text")!;
  expect(textOf(text.props.children)).toBe("// Activas");
  expect(styleOf(text)).toMatchObject({ fontFamily: "monospace", textTransform: "uppercase" });
 });

 it("ignore a hud alone", () => {
  prefs.theme = { ...baseTheme, style: { hud: { color: "#12AB34" } } };
  expect(textOf(elements(SectionTitle({ children: "Activas" })).find(n => n.type === "Text")!.props.children)).toBe("Activas");
 });
});

describe("the circuit backdrop", () => {
 const layer = (nodes: Node[]) => nodes.find(n => n.props.testID === "circuit-backdrop");
 const glow = (nodes: Node[]) => nodes.find(n => n.type === "Image")!;

 it("is not drawn without the style, and the glow stays at full strength", () => {
  for (const theme of [baseTheme, { ...baseTheme, style: { titles: "mono", hud: { color: "#12AB34" } } }]) {
   prefs.theme = theme;
   const nodes = elements(Screen({ children: "content" }));
   expect(layer(nodes)).toBeUndefined();
   expect(styleOf(glow(nodes)).opacity).toBeUndefined();
  }
 });

 it("covers the screen with repeated tiles behind the content, dims the glow, and takes no touches", () => {
  prefs.theme = { ...baseTheme, style: { backdrop: "circuit" } };
  const tree = Screen({ children: "content" }) as { props: { children: unknown[] } };
  const nodes = elements(tree);
  const backdrop = layer(nodes)!;
  expect(backdrop.props).toMatchObject({ pointerEvents: "none", accessible: false, importantForAccessibility: "no-hide-descendants" });
  expect(styleOf(backdrop)).toMatchObject({ position: "absolute", top: 0, left: 0, width: 200, height: 300 });
  expect(styleOf(glow(nodes)).opacity).toBe(0.55);
  // Glow first, then the circuit, then the content.
  const order = [tree.props.children].flat().filter(isValidElement) as unknown as Node[];
  expect(order[0].type).toBe("Image");
  expect(elements(order[1])[0].props.testID).toBe("circuit-backdrop");

  // 200 × 300 over 96-point tiles: 3 columns × 4 rows.
  const tiles = [backdrop.props.children].flat() as unknown as Node[];
  expect(tiles).toHaveLength(12);
  expect(styleOf(tiles[11])).toMatchObject({ left: 2 * CIRCUIT_TILE.size, top: 3 * CIRCUIT_TILE.size });
  const inside = elements(tiles[0]).slice(1);
  const lines = inside.filter(n => styleOf(n).backgroundColor === "#000007");
  const dots = inside.filter(n => styleOf(n).backgroundColor === "#000003");
  expect(lines).toHaveLength(CIRCUIT_TILE.lines.length);
  expect(dots).toHaveLength(CIRCUIT_TILE.nodes.length);
  for (const line of lines) expect(styleOf(line).opacity).toBe(0.1);
  for (const dot of dots) expect(styleOf(dot)).toMatchObject({ opacity: 0.18, borderRadius: CIRCUIT_TILE.node / 2 });
  // Thin traces only.
  for (const line of CIRCUIT_TILE.lines) expect(Math.min(line.width, line.height)).toBe(1);
  // Deterministic: the same screen draws the same pattern.
  expect(JSON.stringify(elements(Screen({ children: "content" })).map(n => n.props.style))).toBe(JSON.stringify(nodes.map(n => n.props.style)));
 });
});
