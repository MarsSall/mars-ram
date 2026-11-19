import { isValidElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Hook slots with deps-aware effects, so components can be called as functions across renders.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
 ...(await original<typeof import("react")>()),
 useState: (initial: unknown) => {
  const slot = hooks.index++;
  if (!(slot in hooks.slots)) hooks.slots[slot] = typeof initial === "function" ? (initial as () => unknown)() : initial;
  return [hooks.slots[slot], (next: unknown) => { hooks.slots[slot] = typeof next === "function" ? (next as (value: unknown) => unknown)(hooks.slots[slot]) : next; }];
 },
 useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
  const slot = hooks.index++;
  const previous = hooks.slots[slot] as { deps: unknown[]; cleanup?: () => void } | undefined;
  if (previous && previous.deps.every((value, i) => Object.is(value, deps[i]))) return;
  previous?.cleanup?.();
  hooks.slots[slot] = { deps, cleanup: effect() ?? undefined };
 },
}));
const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock("react-native", () => ({
 AccessibilityInfo: { addEventListener: () => ({ remove: () => {} }), isReduceMotionEnabled: async () => motion.reduce },
 Image: "Image", Pressable: "Pressable", StyleSheet: { hairlineWidth: 1 }, Text: "Text", View: "View", useWindowDimensions: () => ({ width: 1, height: 1 }),
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
const prefs = vi.hoisted(() => ({ theme: {} as Record<string, unknown> }));
vi.mock("../src/ui/preferences", () => ({ usePreferences: () => ({ theme: prefs.theme, t: { status: { working: "Trabajando", done: "Listo", attention: "Atención" } } }) }));

const { StatusPill } = await import("../src/ui/components");
const { TerminalActivity } = await import("../src/ui/terminal-activity");

type Node = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Node[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
function render<P>(component: (props: P) => unknown, props: P): Node[] { hooks.index = 0; return elements(component(props)); }
const firstText = (nodes: Node[]) => [nodes.find(n => n.type === "Text")!.props.children].flat()[0];
const giftFrames = { frames: ["◐", "◓", "◑", "◒"], intervalMs: 350 };
const colors = { working: "#B4E7C7", done: "#B4E7C7", attention: "#E0C27A" };
const working = { kind: "working" as const, text: "Trabajando", announcement: "Trabajando" };
async function settle() { await Promise.resolve(); await Promise.resolve(); }

beforeEach(() => { hooks.slots = []; motion.reduce = false; vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

it("cycles the gift theme frames in place of the working dot, in the status color", async () => {
 prefs.theme = { colors, working: giftFrames };
 expect(firstText(render(StatusPill, { status: "working" }))).toBe("◐");
 await settle();
 render(StatusPill, { status: "working" });
 const seen = [0, 1, 2, 3].map(() => { vi.advanceTimersByTime(350); const view = render(StatusPill, { status: "working" }); return view.find(n => n.type === "Text")!; });
 expect(seen.map(node => node.props.children)).toEqual(["◓", "◑", "◒", "◐"]);
 expect(seen[0].props.style.color).toBe("#B4E7C7");
});

it("keeps the gift frames on the first one with reduced motion", async () => {
 motion.reduce = true;
 prefs.theme = { colors, working: giftFrames };
 render(StatusPill, { status: "working" });
 await settle();
 vi.advanceTimersByTime(2000);
 expect(firstText(render(StatusPill, { status: "working" }))).toBe("◐");
});

it("keeps the dot for other statuses and for themes without frames", () => {
 prefs.theme = { colors, working: giftFrames };
 expect(render(StatusPill, { status: "done" }).filter(n => n.type === "Text")).toHaveLength(1);
 hooks.slots = [];
 prefs.theme = { colors };
 expect(render(StatusPill, { status: "working" }).filter(n => n.type === "Text")).toHaveLength(1);
});

it("uses the theme's frames in the terminal activity line, else the braille spinner", async () => {
 prefs.theme = { colors, working: giftFrames };
 expect(firstText(render(TerminalActivity, { status: working, color: "#B4E7C7" }))).toBe("◐");
 hooks.slots = [];
 prefs.theme = { colors };
 render(TerminalActivity, { status: working, color: "#B4E7C7" });
 await settle();
 render(TerminalActivity, { status: working, color: "#B4E7C7" });
 vi.advanceTimersByTime(80);
 expect(firstText(render(TerminalActivity, { status: working, color: "#B4E7C7" }))).toBe("⠙");
});
