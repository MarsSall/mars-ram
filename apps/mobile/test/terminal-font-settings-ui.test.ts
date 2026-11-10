import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { TerminalFontSettings } from "../src/ui/terminal-font-settings";
import { es } from "../src/ui/i18n/es";

const f = vi.hoisted(() => ({ size: 14, set: vi.fn(async (_value: number) => {}), writes: [] as unknown[] }));
vi.mock("react", async importOriginal => ({
 ...await importOriginal<typeof import("react")>(),
 useState: (initial: unknown) => [initial, (next: unknown) => f.writes.push(next)],
 useSyncExternalStore: () => f.size,
}));
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View" }));
vi.mock("../src/services", () => ({ terminalFont: { subscribe: vi.fn(), get: () => f.size, set: f.set } }));
vi.mock("../src/ui/preferences", async () => { const { es: t } = await import("../src/ui/i18n/es"); return { usePreferences: () => ({ t, theme: { colors: {}, spacing: (n: number) => n * 4, radius: { medium: 12 }, font: { mono: "monospace" }, touch: 48 } }) }; });
vi.mock("../src/ui/components", () => ({ Card: "Card", SectionTitle: "SectionTitle" }));
function elements(node: unknown): { type: unknown; props: Record<string, any> }[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
const s = es.terminalFont;
const render = (size: number) => { f.size = size; return elements(TerminalFontSettings()); };
const button = (nodes: ReturnType<typeof render>, label: string) => nodes.find(n => n.type === "Pressable" && n.props.accessibilityLabel === label)!;
afterEach(() => { f.size = 14; f.writes.length = 0; vi.clearAllMocks(); });

describe("Settings › Terminal › font size", () => {
 it("shows the live value, a monospace preview, the zoom hint, and 48dp labelled buttons", () => {
  const nodes = render(16);
  const text = nodes.filter(n => n.type === "Text").map(n => [n.props.children].flat().join("")).join("\n");
  expect(nodes.find(n => n.type === "SectionTitle")?.props.children).toBe(s.title); expect(text).toContain(s.size); expect(text).toContain("16"); expect(text).toContain(s.hint);
  expect(nodes.some(n => n.type === "Text" && n.props.style?.fontFamily === "monospace" && n.props.style?.fontSize === 16)).toBe(true);
  expect(nodes.some(n => n.props.accessibilityLiveRegion === "polite" && [n.props.children].flat().join("").includes("16"))).toBe(true);
  for (const label of [s.smaller, s.larger]) {
   const b = button(nodes, label);
   expect(b.props.accessibilityRole).toBe("button");
   expect(b.props.style.minWidth).toBeGreaterThanOrEqual(48); expect(b.props.style.minHeight).toBeGreaterThanOrEqual(48);
  }
 });
 it("+ and − save one step", () => {
  button(render(14), s.larger).props.onPress(); expect(f.set).toHaveBeenLastCalledWith(15);
  button(render(14), s.smaller).props.onPress(); expect(f.set).toHaveBeenLastCalledWith(13);
 });
 it("clamps at 8 and 28", () => {
  const low = button(render(8), s.smaller); expect(low.props.disabled).toBe(true); low.props.onPress(); expect(f.set).not.toHaveBeenCalled();
  const high = button(render(28), s.larger); expect(high.props.disabled).toBe(true); high.props.onPress(); expect(f.set).not.toHaveBeenCalled();
  expect(button(render(8), s.larger).props.disabled).toBe(false);
 });
 it("says so when the size could not be saved", async () => {
  f.set.mockRejectedValueOnce(new Error("disk full"));
  button(render(14), s.larger).props.onPress(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.writes).toContain(true);
 });
});
