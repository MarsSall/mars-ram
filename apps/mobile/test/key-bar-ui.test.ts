import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement } from "react";
import { readFileSync } from "node:fs";
import { KeyBarDock, KeyBarHandles, KeyBarHoverEdge, KeyBarTabFace } from "../src/ui/key-bar-dock";
import { KEY_BAR_HANDLE_SIZE, keyBarHandleMetrics, keyBarHandleSlot, type KeyBarHandleSlot } from "../src/core/key-bar-visibility";
import { KeyBarModePicker } from "../src/ui/key-bar-mode-picker";
import { KeyBarHandleSizeSlider } from "../src/ui/key-bar-handle-size";
import { ChatHandle, ChatHandleFace } from "../src/ui/chat-handle";
import { es } from "../src/ui/i18n/es";
import { en } from "../src/ui/i18n/en";

const f = vi.hoisted(() => ({ pans: [] as Record<string, (...args: any[]) => unknown>[], lang: "es" as "es" | "en" }));
vi.mock("react", async importOriginal => ({
 ...await importOriginal<typeof import("react")>(),
 useState: (initial: unknown) => [typeof initial === "function" ? (initial as () => unknown)() : initial, vi.fn()],
 useRef: (initial: unknown) => ({ current: initial }),
 useMemo: (factory: () => unknown) => factory(),
 useCallback: (callback: unknown) => callback,
 useEffect: () => {},
}));
vi.mock("react-native", () => ({
 Pressable: "Pressable", Text: "Text", View: "View",
 Animated: { View: "Animated.View", Value: class { constructor(public value: number) {} setValue(value: number) { this.value = value; } }, timing: () => ({ start: (done?: (r: { finished: boolean }) => void) => done?.({ finished: true }), stop: () => {} }) },
 PanResponder: { create: (config: Record<string, (...args: any[]) => unknown>) => { f.pans.push(config); return { panHandlers: { onResponderMove: "pan" } }; } },
 AccessibilityInfo: { addEventListener: () => ({ remove: () => {} }), isReduceMotionEnabled: () => Promise.resolve(false) },
}));
vi.mock("../src/ui/preferences", async () => {
 const { es } = await import("../src/ui/i18n/es"); const { en } = await import("../src/ui/i18n/en");
 return { usePreferences: () => ({ t: f.lang === "es" ? es : en, theme: { colors: { accent: "#0A4F31", accentText: "#7f7", surface: "#111", surfaceRaised: "#101A14", text: "#fff", textMuted: "#ccc", border: "#1F3328" }, spacing: (n: number) => n * 4, radius: { small: 6, medium: 10 }, font: { mono: "monospace" }, touch: 48 } }) };
});
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));

type Node = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Node[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
const texts = (nodes: Node[]) => nodes.filter(n => n.type === "Text").map(n => [n.props.children].flat().join(""));
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const bar = createElement("View", { accessibilityLabel: "BAR" });
const chat = createElement("ChatHandle", { state: "closed" });
const dock = (mode: "always" | "auto" | "tap", shown: boolean, dispatch = vi.fn()) => ({ dispatch, nodes: elements(KeyBarDock({ mode, shown, dispatch, chat, children: bar })) });
const hasBar = (nodes: Node[]) => nodes.some(n => n.props.accessibilityLabel === "BAR");
afterEach(() => { f.pans.length = 0; f.lang = "es"; vi.clearAllMocks(); });

describe("«Siempre visible» keeps today's bar", () => {
 it("renders the bar and the chat handle exactly as before, with no handle tab", () => {
  const { nodes } = dock("always", true);
  expect(hasBar(nodes)).toBe(true);
  expect(nodes[0].props.style).toEqual({ paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8 });
  expect(nodes.find(n => n.type === "ChatHandle")).toBeDefined();
  expect(nodes.find(n => n.props.accessibilityLabel === es.terminal.showBar || n.props.accessibilityLabel === es.terminal.hideBar)).toBeUndefined();
  expect(nodes.some(n => n.type === "Animated.View")).toBe(false);
  expect(f.pans).toHaveLength(0);
 });
});

// The hidden modes' handles (S6, S8): the tab and 💬 in the band or thin row below the terminal.
const BAND: KeyBarHandleSlot = { place: "band", height: 24 };
const handles = (mode: "always" | "auto" | "tap", shown: boolean, dispatch = vi.fn(), slot: KeyBarHandleSlot | null = BAND, withChat = true, size = 20) =>
 ({ dispatch, nodes: elements(KeyBarHandles({ mode, shown, dispatch, slot, size, chat: withChat ? chat : null })) });
const tabOf = (nodes: Node[]) => nodes.find(n => n.type === "Pressable" && [es.terminal.showBar, es.terminal.hideBar].includes(n.props.accessibilityLabel))!;
const childrenOf = (node: Node): Node[] => ([node.props.children].flat() as unknown[]).filter(child => isValidElement(child)).map(child => ({ type: (child as Node).type, props: (child as Node).props }));
const faceOf = (nodes: Node[]) => elements(tabOf(nodes).props.children).find(n => n.type === KeyBarTabFace)!;

describe("«Con un toque» handle (S3)", () => {
 it("a labelled handle tab at the bottom edge toggles the bar", () => {
  const hidden = handles("tap", false);
  expect(hasBar(dock("tap", false).nodes)).toBe(false);
  const tab = tabOf(hidden.nodes);
  expect(tab.props).toMatchObject({ accessibilityRole: "button", accessibilityLabel: "Mostrar barra", accessibilityState: { expanded: false } });
  tab.props.onPress(); expect(hidden.dispatch).toHaveBeenCalledWith({ type: "handle-tap" });
  expect(hasBar(dock("tap", true).nodes)).toBe(true);
  expect(tabOf(handles("tap", true).nodes).props).toMatchObject({ accessibilityLabel: "Ocultar barra", accessibilityState: { expanded: true } });
 });
 it("is a small raised pill like the D-pad side tab; only the pill is drawn", () => {
  const face = faceOf(handles("tap", false).nodes);
  expect(face.props).toEqual({ size: 20, shown: false });
  const drawn = elements(KeyBarTabFace({ size: 20, shown: false }))[0];
  expect(drawn.props.style).toMatchObject({ width: 56, height: 20, borderRadius: 10, backgroundColor: "#101A14", borderWidth: 1, borderColor: "#1F3328", opacity: 0.72 });
  expect(drawn.props.pointerEvents).toBe("none");
 });
 it("keeps the floating chat handle reachable while the bar is hidden", () => {
  expect(handles("tap", false).nodes.find(n => n.type === "ChatHandle")).toBeDefined();
  expect(handles("auto", false).nodes.find(n => n.type === "ChatHandle")).toBeDefined();
 });
 it("has English labels too", () => {
  f.lang = "en";
  expect(handles("tap", false).nodes.some(n => n.props.accessibilityLabel === "Show bar")).toBe(true);
  expect(handles("tap", true).nodes.some(n => n.props.accessibilityLabel === "Hide bar")).toBe(true);
 });
});

describe("«Autodesplegable» handle tab (S2, S5)", () => {
 it("shows the same handle tab as «Con un toque»; a tap shows the bar like the D-pad button", () => {
  const { nodes, dispatch } = handles("auto", false);
  const handle = tabOf(nodes);
  expect(handle.props).toMatchObject({ accessibilityRole: "button", accessibilityLabel: "Mostrar barra", accessibilityState: { expanded: false } });
  expect(faceOf(nodes).props).toEqual(faceOf(handles("tap", false).nodes).props);
  handle.props.onPress(); expect(dispatch).toHaveBeenLastCalledWith({ type: "handle-tap" });
  expect(tabOf(handles("auto", true).nodes).props).toMatchObject({ accessibilityLabel: "Ocultar barra", accessibilityState: { expanded: true } });
 });
 it("has no swipe: no pan responder, and the full-width overlay takes no touches itself", () => {
  const { nodes } = handles("auto", false);
  expect(f.pans).toHaveLength(0);
  expect(nodes.filter(n => n.props.panHandlers || n.props.onResponderMove)).toEqual([]);
  for (const n of nodes.filter(n => n.props.style?.position === "absolute" && n.props.style?.left === 0 && n.props.style?.right === 0)) {
   expect(n.props.pointerEvents).toBe("box-none");
   expect(Object.keys(n.props).filter(name => /Responder|Touch|onPress/.test(name))).toEqual([]);
  }
  expect(read("../src/ui/key-bar-dock.tsx")).not.toMatch(/PanResponder|isRevealSwipe|reveal-swipe/);
  expect(es.terminal).not.toHaveProperty("revealHint"); expect(en.terminal).not.toHaveProperty("revealHint");
 });
 it("TalkBack opens it through the tab's accessibility action, which keeps it up (no idle hide)", () => {
  const { nodes, dispatch } = handles("auto", false);
  const handle = tabOf(nodes);
  expect(handle.props.accessibilityActions).toEqual([{ name: "activate" }]);
  handle.props.onAccessibilityAction({ nativeEvent: { actionName: "activate" } });
  expect(dispatch).toHaveBeenLastCalledWith({ type: "handle-tap", assistive: true });
  handle.props.onAccessibilityAction({ nativeEvent: { actionName: "longpress" } }); expect(dispatch).toHaveBeenCalledTimes(1);
  // «Con un toque» stays as it was: TalkBack's click goes to onPress.
  expect(tabOf(handles("tap", false).nodes).props.accessibilityActions).toBeUndefined();
 });
 it("a hidden bar is out of the touch and accessibility tree; a shown one slides and fades in", () => {
  expect(hasBar(dock("auto", false).nodes)).toBe(false);
  const shown = dock("auto", true).nodes;
  const motion = shown.find(n => n.type === "Animated.View")!;
  expect(motion.props.style.opacity).toBeDefined();
  expect(motion.props.style.transform[0].translateY).toBeDefined();
  expect(hasBar(elements(motion.props.children))).toBe(true);
 });
 it("a mouse on the shown bar or on the handles keeps it; a finger does not count", () => {
  for (const { nodes, dispatch } of [dock("auto", true), handles("auto", false)]) {
   const root = nodes[0];
   root.props.onPointerEnter({ nativeEvent: { pointerType: "touch" } });
   root.props.onPointerLeave({ nativeEvent: { pointerType: "touch" } });
   expect(dispatch).not.toHaveBeenCalled();
   root.props.onPointerEnter({ nativeEvent: { pointerType: "mouse" } }); expect(dispatch).toHaveBeenLastCalledWith({ type: "pointer-enter" });
   root.props.onPointerLeave({ nativeEvent: { pointerType: "mouse" } }); expect(dispatch).toHaveBeenLastCalledWith({ type: "pointer-leave" });
  }
  expect(handles("tap", false).nodes[0].props.onPointerEnter).toBeUndefined();
 });
 it("the hover edge over the system inset only listens to a mouse and takes no touches", () => {
  const dispatch = vi.fn();
  const edge = KeyBarHoverEdge({ height: 24, dispatch })!;
  expect(edge.props.style).toMatchObject({ position: "absolute", left: 0, right: 0, bottom: 0, height: 24 });
  expect(Object.keys(edge.props).filter(name => /Responder|Touch|panHandlers/.test(name))).toEqual([]);
  edge.props.onPointerEnter({ nativeEvent: { pointerType: "touch" } }); expect(dispatch).not.toHaveBeenCalled();
  edge.props.onPointerEnter({ nativeEvent: { pointerType: "mouse" } }); expect(dispatch).toHaveBeenLastCalledWith({ type: "pointer-enter" });
  edge.props.onPointerLeave({ nativeEvent: { pointerType: "mouse" } }); expect(dispatch).toHaveBeenLastCalledWith({ type: "pointer-leave" });
  expect(KeyBarHoverEdge({ height: 0, dispatch })).toBeNull();
 });
});

describe("no row or strip over the terminal in the hidden modes (S7, S8)", () => {
 it("a hidden bar leaves nothing in the layout: no row, no strip, no spacer", () => {
  for (const mode of ["auto", "tap"] as const) {
   expect(KeyBarDock({ mode, shown: false, dispatch: vi.fn(), chat, children: bar })).toBeNull();
   expect(dock(mode, false).nodes).toEqual([]);
  }
  expect(read("../src/ui/key-bar-dock.tsx")).not.toContain("key-bar-gesture-lift");
 });
 it("a shown bar is laid out alone (it pushes the terminal up), with the handles kept out of the dock", () => {
  for (const mode of ["auto", "tap"] as const) {
   const { nodes } = dock(mode, true);
   expect(hasBar(nodes)).toBe(true);
   expect(nodes.find(n => n.type === "ChatHandle")).toBeUndefined();
   expect(nodes.find(n => n.type === "Pressable")).toBeUndefined();
   expect(nodes.filter(n => n.props.style?.backgroundColor)).toEqual([]);
  }
 });
 it("the handles are a transparent row exactly as tall as their slot; «Siempre visible» or no slot has none", () => {
  for (const mode of ["auto", "tap"] as const) for (const slot of [BAND, { place: "row", height: 20 } as KeyBarHandleSlot]) {
   const root = handles(mode, false, vi.fn(), slot).nodes[0];
   expect(root.props.pointerEvents).toBe("box-none");
   expect(root.props.style).toEqual({ height: slot.height, flexDirection: "row" });
   const nodes = handles(mode, false, vi.fn(), slot).nodes;
   expect(nodes.filter(n => n.props.style?.backgroundColor)).toEqual([]);
   // Nothing is offset or slopped outside the row: not up into the terminal, not below the screen.
   for (const n of nodes) {
    expect(n.props.hitSlop).toBeUndefined();
    expect(n.props.style?.position).toBeUndefined();
   }
  }
  expect(KeyBarHandles({ mode: "always", shown: true, dispatch: vi.fn(), slot: BAND, size: 20, chat })).toBeNull();
  expect(KeyBarHandles({ mode: "tap", shown: false, dispatch: vi.fn(), slot: null, size: 20, chat })).toBeNull();
 });
});

describe("handle tab right of a centred 💬, both inside their band or row (S6, S8)", () => {
 type Rect = { left: number; right: number; bottom: number; top: number };
 // Lays the row out like flexbox: spacer (flex 1), 💬's box, then the tab centred in the remaining flex 1.
 // x from the row's left edge, y up from the row's bottom edge.
 function areas(mode: "auto" | "tap", width: number, slot: KeyBarHandleSlot, size = 20) {
  const nodes = handles(mode, false, vi.fn(), slot, true, size).nodes;
  const kids = childrenOf(nodes[0]);
  expect(kids).toHaveLength(3);
  expect(kids[0].props.style).toEqual({ flex: 1 }); expect(kids[2].props.style).toMatchObject({ flex: 1, alignItems: "center" });
  const centreWidth = kids[1].props.style.width as number;
  expect(elements(kids[1].props.children).some(n => n.type === "ChatHandle")).toBe(true);
  const side = (width - centreWidth) / 2;
  const tab = tabOf(nodes); const ts = tab.props.style;
  expect(tab.props.hitSlop).toBeUndefined();
  const tabLeft = side + centreWidth + (side - ts.width) / 2;
  const handle: Rect = { left: tabLeft, right: tabLeft + ts.width, bottom: 0, top: ts.height };
  // The real 💬 as the screen renders it in the hidden modes.
  const real = elements(ChatHandle({ state: "closed", change: vi.fn(), fit: { size, height: slot.height } }))[0];
  expect(real.props.hitSlop).toBeUndefined();
  expect(real.props.style.width).toBe(centreWidth);
  const bubble: Rect = { left: side, right: side + real.props.style.width, bottom: 0, top: real.props.style.height };
  return { handle, bubble, height: slot.height };
 }
 const size = (r: Rect) => ({ width: r.right - r.left, height: r.top - r.bottom });
 const slots: KeyBarHandleSlot[] = [{ place: "band", height: 15 }, BAND, { place: "band", height: 48 }, { place: "row", height: 12 }, { place: "row", height: 40 }];
 it("💬 stays centred and the bar tab sits to its right without overlapping, ≥ 48 dp wide, as tall as the row", () => {
  for (const mode of ["auto", "tap"] as const) for (const width of [360, 412, 800]) for (const slot of slots) for (const pill of [12, 20, 40]) {
   if (slot.height < pill) continue;
   const { handle, bubble } = areas(mode, width, slot, pill);
   expect((bubble.left + bubble.right) / 2).toBe(width / 2);
   expect(handle.left).toBeGreaterThanOrEqual(bubble.right);
   expect(handle.right).toBeLessThanOrEqual(width);
   expect(size(handle).width).toBeGreaterThanOrEqual(48); expect(size(bubble).width).toBeGreaterThanOrEqual(48);
   expect(size(handle).height).toBe(slot.height); expect(size(bubble).height).toBe(slot.height);
  }
 });
 it("never overlap the terminal box: bar hidden or shown, keyboard open, band large, small or none", () => {
  // y up from the screen's bottom. The screen stacks: terminal, (bar), (row), safe-area band.
  for (const mode of ["auto", "tap"] as const) for (const chromeBottom of [0, 10, 15, 24, 48]) for (const pill of [12, 20, 40]) for (const barHeight of [0, 58]) {
   const slot = keyBarHandleSlot(mode, pill, chromeBottom)!;
   const { handle, bubble, height } = areas(mode, 412, slot, pill);
   const base = slot.place === "band" ? 0 : chromeBottom;
   const terminalBottom = chromeBottom + (slot.place === "row" ? slot.height : 0) + barHeight;
   for (const r of [handle, bubble]) { expect(base + r.bottom).toBeGreaterThanOrEqual(0); expect(base + r.top).toBeLessThanOrEqual(terminalBottom); }
   expect(height).toBeGreaterThanOrEqual(pill);
  }
 });
 it("the pills scale with the chosen size and fit their row", () => {
  for (const pill of [12, 20, 40]) {
   const m = keyBarHandleMetrics(pill);
   const face = elements(KeyBarTabFace({ size: pill, shown: false }))[0];
   expect(face.props.style).toMatchObject({ width: m.pillWidth, height: pill, borderRadius: pill / 2 });
   const bubble = elements(ChatHandleFace({ size: pill }))[0];
   expect(bubble.props.style).toMatchObject({ width: m.pillWidth, height: pill, borderRadius: pill / 2 });
   expect(faceOf(handles("tap", false, vi.fn(), { place: "row", height: pill }, true, pill).nodes).props.size).toBe(pill);
  }
 });
 it("💬 in the band is tap only: a tap opens the floating chat, no drag is taken there", () => {
  f.pans.length = 0;
  const change = vi.fn();
  const nodes = elements(ChatHandle({ state: "closed", change, fit: { size: 20, height: 15 } }));
  expect(f.pans).toHaveLength(0);
  expect(nodes.filter(n => n.props.onResponderMove || n.props.panHandlers || n.props.onMoveShouldSetResponder)).toEqual([]);
  const press = nodes.find(n => n.type === "Pressable")!;
  expect(press.props).toMatchObject({ accessibilityRole: "button", accessibilityLabel: es.terminal.openChat });
  expect(press.props.accessibilityHint).toBeUndefined();
  press.props.onPress(); expect(change).toHaveBeenCalledWith("floating");
  // «Siempre visible» keeps today's 💬 with its swipe.
  elements(ChatHandle({ state: "closed", change })); expect(f.pans).toHaveLength(1);
 });
 it("without 💬 (a standalone computer terminal) the tab keeps its place", () => {
  const nodes = handles("auto", false, vi.fn(), BAND, false).nodes;
  expect(nodes.find(n => n.type === "ChatHandle")).toBeUndefined();
  expect(tabOf(nodes)).toBeDefined();
  const kids = childrenOf(nodes[0]);
  expect(kids[1].props.style.width).toBe(keyBarHandleMetrics(20).touchWidth);
 });
});

describe("Ajustes › Personalizar teclas: size of the handles (S9)", () => {
 const slider = (value: number, onChange = vi.fn()) => ({ onChange, nodes: elements(KeyBarHandleSizeSlider({ value, onChange })) });
 const adjustable = (nodes: Node[]) => nodes.find(n => n.props.accessibilityRole === "adjustable")!;
 it("a free slider from 12 to 40 dp with the value, a label and a live preview of the two handles", () => {
  const { nodes } = slider(26);
  expect(texts(nodes)).toEqual(expect.arrayContaining([es.terminalKeys.handleSize.title, es.terminalKeys.handleSize.value(26)]));
  const track = adjustable(nodes);
  expect(track.props).toMatchObject({ accessibilityLabel: es.terminalKeys.handleSize.title, accessibilityValue: { min: 12, max: 40, now: 26, text: es.terminalKeys.handleSize.value(26) } });
  expect(track.props.style.minHeight).toBeGreaterThanOrEqual(48);
  const preview = nodes.find(n => n.props.accessibilityLabel === es.terminalKeys.handleSize.preview)!;
  const faces = elements(preview.props.children);
  expect(faces.find(n => n.type === KeyBarTabFace)?.props).toEqual({ size: 26, shown: false });
  expect(faces.find(n => n.type === ChatHandleFace)?.props).toEqual({ size: 26 });
 });
 it("dragging or tapping along the track picks any size; screen readers and ± step by 1", () => {
  const { nodes, onChange } = slider(20);
  const track = adjustable(nodes);
  track.props.onLayout({ nativeEvent: { layout: { width: 280, height: 48, x: 0, y: 0 } } });
  const pan = f.pans.at(-1)!;
  track.props.onTouchStart({ nativeEvent: { locationX: 0, pageX: 50, pageY: 300 } });
  expect(pan.onMoveShouldSetPanResponder({}, { dx: 12, dy: 2 })).toBe(true);
  pan.onPanResponderGrant({}, { dx: 0, dy: 0 }); expect(onChange).not.toHaveBeenCalled();
  pan.onPanResponderMove({}, { dx: 140, dy: 3 }); expect(onChange).toHaveBeenLastCalledWith(26);
  pan.onPanResponderMove({}, { dx: 999, dy: 40 }); expect(onChange).toHaveBeenLastCalledWith(40);
  pan.onPanResponderMove({}, { dx: -999, dy: 0 }); expect(onChange).toHaveBeenLastCalledWith(12);
  expect(pan.onPanResponderTerminationRequest()).toBe(false);
  pan.onPanResponderMove({}, { dx: 0, dy: 0 }); pan.onPanResponderRelease?.({}, { dx: 0, dy: 0 });
  onChange.mockClear(); track.props.onTouchEnd({ nativeEvent: { pageX: 50, pageY: 300 } }); expect(onChange).not.toHaveBeenCalled(); // a drag back to its start is not also a tap
  track.props.onTouchStart({ nativeEvent: { locationX: 140, pageX: 190, pageY: 300 } });
  track.props.onTouchEnd({ nativeEvent: { pageX: 191, pageY: 301 } }); expect(onChange).toHaveBeenLastCalledWith(26);
  track.props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }); expect(onChange).toHaveBeenLastCalledWith(21);
  track.props.onAccessibilityAction({ nativeEvent: { actionName: "decrement" } }); expect(onChange).toHaveBeenLastCalledWith(19);
  const step = (label: string) => nodes.find(n => n.type === "Pressable" && n.props.accessibilityLabel === label)!;
  step(es.terminalKeys.handleSize.larger).props.onPress(); expect(onChange).toHaveBeenLastCalledWith(21);
  step(es.terminalKeys.handleSize.smaller).props.onPress(); expect(onChange).toHaveBeenLastCalledWith(19);
  const ends = slider(KEY_BAR_HANDLE_SIZE.max);
  expect(ends.nodes.find(n => n.type === "Pressable" && n.props.accessibilityLabel === es.terminalKeys.handleSize.larger)!.props.disabled).toBe(true);
  adjustable(ends.nodes).props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }); expect(ends.onChange).not.toHaveBeenCalled();
 });
 it("a vertical scroll that starts on the track scrolls the page instead of changing the size (L10)", () => {
  const { nodes, onChange } = slider(14);
  const track = adjustable(nodes);
  track.props.onLayout({ nativeEvent: { layout: { width: 280, height: 48, x: 0, y: 0 } } });
  const pan = f.pans.at(-1)!;
  expect(pan.onStartShouldSetPanResponder({}, { dx: 0, dy: 0 })).toBe(false);
  expect(pan.onStartShouldSetPanResponderCapture?.({}, { dx: 0, dy: 0 }) ?? false).toBe(false);
  track.props.onTouchStart({ nativeEvent: { locationX: 140, pageX: 190, pageY: 300 } });
  for (const [dx, dy] of [[0, 3], [2, 12], [6, 40], [20, 60], [-30, -90]]) {
   expect(pan.onMoveShouldSetPanResponder({}, { dx, dy })).toBe(false);
   expect(pan.onMoveShouldSetPanResponderCapture?.({}, { dx, dy }) ?? false).toBe(false);
  }
  expect(pan.onMoveShouldSetPanResponder({}, { dx: 4, dy: 1 })).toBe(false);
  track.props.onTouchEnd({ nativeEvent: { pageX: 160, pageY: 210 } });
  track.props.onTouchCancel?.({ nativeEvent: { pageX: 160, pageY: 210 } });
  expect(onChange).not.toHaveBeenCalled();
 });
 it("has English text and explains when they need their own thin row", () => {
  f.lang = "en";
  expect(texts(elements(KeyBarHandleSizeSlider({ value: 20, onChange: vi.fn() })))).toEqual(expect.arrayContaining([en.terminalKeys.handleSize.title, "20 dp"]));
  expect(en.terminalKeys.handleSize.hint.length).toBeGreaterThan(20); expect(es.terminalKeys.handleSize.hint.length).toBeGreaterThan(20);
 });
 it("the editor shows it under the mode picker only for the hidden modes and saves it with the mode", () => {
  const editor = read("../src/ui/terminal-keys-editor.tsx");
  const pickerAt = editor.indexOf("<KeyBarModePicker value={bar.mode} onChange={chooseBarMode} />");
  const sliderAt = editor.indexOf("{tab === \"bar\" && bar.mode !== \"always\" ? <KeyBarHandleSizeSlider value={bar.handleSize} onChange={chooseHandleSize} /> : null}");
  expect(pickerAt).toBeGreaterThan(0); expect(sliderAt).toBeGreaterThan(pickerAt);
  expect(editor).toMatch(/const changed = draftChanged\(state\) \|\| bar\.mode !== savedBar\.mode \|\| bar\.handleSize !== savedBar\.handleSize/);
  expect(editor).toMatch(/Promise\.all\(\[terminalKeys\.set\(draft\), keyBarMode\.set\(bar\)\]\)/);
 });
});

describe("Ajustes › Personalizar teclas: how the bar shows (S4)", () => {
 const radios = (nodes: Node[]) => nodes.filter(n => n.props.accessibilityRole === "radio");
 it("offers «Siempre visible», «Autodesplegable» and «Con un toque», each with a help line", () => {
  const onChange = vi.fn();
  const nodes = elements(KeyBarModePicker({ value: "always", onChange }));
  expect(texts(nodes)).toEqual(expect.arrayContaining(["Siempre visible", "Autodesplegable", "Con un toque", es.terminalKeys.barMode.title]));
  const options = radios(nodes);
  expect(options).toHaveLength(3);
  expect(options.map(n => n.props.accessibilityState.checked)).toEqual([true, false, false]);
  for (const [index, mode] of (["always", "auto", "tap"] as const).entries()) {
   const option = es.terminalKeys.barMode.options[mode];
   expect(option.help.length).toBeGreaterThan(10);
   expect(texts(elements(options[index].props.children))).toEqual([option.label, option.help]);
   expect(options[index].props.style.minHeight).toBeGreaterThanOrEqual(48);
   options[index].props.onPress(); expect(onChange).toHaveBeenLastCalledWith(mode);
  }
  expect(radios(elements(KeyBarModePicker({ value: "tap", onChange }))).map(n => n.props.accessibilityState.checked)).toEqual([false, false, true]);
 });
 it("has English equivalents", () => {
  expect([en.terminalKeys.barMode.options.always.label, en.terminalKeys.barMode.options.auto.label, en.terminalKeys.barMode.options.tap.label]).toEqual(["Always visible", "Auto-hide", "One tap"]);
  expect(en.terminal.showBar).toBe("Show bar"); expect(es.terminal.showBar).toBe("Mostrar barra");
 });
 it("«Autodesplegable» help tells to tap the tab or move the mouse down, with no swipe (L4)", () => {
  expect(es.terminalKeys.barMode.options.auto.help).toBe("Escondida: tocá la pestañita de abajo o llevá el mouse abajo. Se esconde al tocar la terminal o tras unos segundos sin usarla.");
  expect(en.terminalKeys.barMode.options.auto.help).toBe("Hidden: tap the small tab at the bottom or move the mouse to the bottom. It hides when you tap the terminal or after a few seconds unused.");
  for (const text of [es.terminalKeys.barMode.options.auto.help, en.terminalKeys.barMode.options.auto.help]) expect(text).not.toMatch(/desliz|swipe/i);
 });
 it("the editor shows the picker on the bar tab and «Guardar cambios» saves it with the keys", () => {
  const editor = read("../src/ui/terminal-keys-editor.tsx");
  expect(editor).toContain("<KeyBarModePicker value={bar.mode} onChange={chooseBarMode} />");
  expect(editor.match(/keyBarMode\.set\(/g)).toHaveLength(1);
 });
 it("persists in its own file next to the other terminal key settings", () => {
  expect(read("../src/adapters/file-key-bar-mode.ts")).toContain("\"terminal-key-bar.json\"");
  expect(read("../src/services.ts")).toContain("export const keyBarMode = new KeyBarModePreference(fileKeyBarMode);");
 });
});

describe("terminal screen wiring", () => {
 const screen = read("../src/app/session/terminal/[id].tsx");
 it("reads the settings live and drives the dock from the visibility rules", () => {
  expect(screen).toContain("const [barSettings, setBarSettings] = useState(keyBarMode.get);");
  expect(screen).toContain("keyBarMode.subscribe(setBarSettings)");
  expect(screen).toContain("const barMode = barSettings.mode;");
  expect(screen).toContain("useKeyBarVisibility(barMode, { pad: padOpen, mic: dictating.state.phase !== \"idle\" })");
  expect(screen).toContain("<KeyBarDock mode={barMode} shown={barVisibility.state.shown} dispatch={barVisibility.dispatch} chat={chatHandle}>");
  expect(screen).toContain("<KeyBarHoverEdge height={barMode === \"auto\" ? chrome.bottom : 0} dispatch={barVisibility.dispatch} />");
 });
 it("puts the handles below the terminal, never inside its box: in the bottom band or a thin row", () => {
  expect(screen).toContain("const handleSlot = keyBarHandleSlot(barMode, barSettings.handleSize, chrome.bottom);");
  expect(screen).toContain("<KeyBarHandles mode={barMode} shown={barVisibility.state.shown} dispatch={barVisibility.dispatch} slot={handleSlot} size={barSettings.handleSize} chat={chatHandle} />");
  const terminalAt = screen.indexOf("onLayout={event => { setBounds(event.nativeEvent.layout); sendPage({ type: \"fit\" }); }}");
  const padAt = screen.indexOf("<FloatingTerminalPad");
  const dockEnd = screen.indexOf("</KeyBarDock>");
  const rowAt = screen.indexOf("{handleSlot?.place === \"row\" ? barHandles : null}");
  const bandAt = screen.indexOf("{handleSlot?.place === \"band\" ? <View pointerEvents=\"box-none\" style={{ position: \"absolute\", left: insets.left, right: insets.right, bottom: 0, height: handleSlot.height }}>{barHandles}</View> : null}");
  expect(terminalAt).toBeGreaterThan(0);
  expect(rowAt).toBeGreaterThan(dockEnd); expect(rowAt).toBeLessThan(screen.indexOf("</ServerViewer>"));
  expect(bandAt).toBeGreaterThan(screen.indexOf("<KeyBarHoverEdge"));
  const terminalBox = screen.slice(terminalAt, padAt);
  expect(terminalBox).not.toContain("KeyBarHandles"); expect(terminalBox).not.toContain("barHandles");
  // The terminal ends at the safe area: below it only the (shown) bar and the thin row, if any.
  expect(screen).toContain("paddingBottom: chrome.bottom }}");
  expect(screen).not.toMatch(/keyBarDockLift|barLift|useSystemGestureInset/);
 });
 it("💬 is tap only and sized to its slot in the hidden modes", () => {
  expect(screen).toMatch(/<TourAnchor id="terminal\.chatHandle"><ChatHandle state="closed" fit=\{handleSlot \? \{ size: barSettings\.handleSize, height: handleSlot\.height \} : undefined\}/);
 });
 it("a terminal tap and any bar key press reach the rules", () => {
  expect(screen).toMatch(/message\.type === "tap"\) \{ kbd\.terminalTapped\(\); barVisibility\.dispatch\(\{ type: "terminal-tap" \}\); \}/);
  expect(screen).toContain("onTouchStart={() => barVisibility.dispatch({ type: \"key-press\", held: true })}");
  expect(screen).toContain("onTouchEnd={event => barVisibility.dispatch({ type: \"key-press\", held: event.nativeEvent.touches.length > 0 })}");
  expect(screen).toContain("onTouchCancel={() => barVisibility.dispatch({ type: \"key-press\", held: false })}");
 });
});
