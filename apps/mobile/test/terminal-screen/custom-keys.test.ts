import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { readFileSync } from "node:fs";
import { terminalPadLayout } from "../../src/core/terminal-controls";
import { CUSTOM_HOLD_MS, defaultTerminalKeys, saveCustom, setPadSlot, type KeyEdit } from "../../src/core/terminal-keys";
import { FloatingTerminalPad } from "../../src/ui/floating-terminal-pad";
import { CustomButtonForm } from "../../src/ui/custom-button-form";
import { es } from "../../src/ui/i18n/es";

vi.mock("react", async importOriginal => ({
 ...await importOriginal<typeof import("react")>(),
 useState: (initial: unknown) => [typeof initial === "function" ? (initial as () => unknown)() : initial, vi.fn()],
 useRef: (initial: unknown) => ({ current: initial }),
 useMemo: (factory: () => unknown) => factory(),
 useEffect: () => {},
}));
vi.mock("react-native", () => ({
 Pressable: "Pressable", Text: "Text", View: "View", Modal: "Modal", ScrollView: "ScrollView", Switch: "Switch", TextInput: "TextInput", Alert: { alert: vi.fn() },
 Animated: { View: "Animated.View", Value: class { constructor(public value: number) {} }, timing: () => ({ start: () => {}, stop: () => {} }) },
 PanResponder: { create: () => ({ panHandlers: {} }) },
}));
vi.mock("../../src/ui/preferences", async () => { const { es: t } = await import("../../src/ui/i18n/es"); return { usePreferences: () => ({ t, theme: { colors: { accent: "#0A4F31", surfaceRaised: "#101A14", text: "#fff", textMuted: "#ccc", attention: "#E0C27A", border: "#1F3328" }, spacing: (n: number) => n * 4, radius: { small: 6, medium: 10 }, font: { mono: "monospace" }, touch: 48 } }) }; });
vi.mock("../../src/ui/components", () => ({ Card: "Card", PrimaryButton: "PrimaryButton", Screen: "Screen", SectionTitle: "SectionTitle" }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));

type Node = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Node[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.children), ...elements(node.props.footer)];
}
const texts = (nodes: Node[]) => nodes.filter(n => n.type === "Text").map(n => [n.props.children].flat().join("")).join("\n");
const ok = (result: KeyEdit) => { if (!result.ok) throw new Error(result.reason); return result.layout; };
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const bounds = { width: 400, height: 700 };
afterEach(() => { vi.clearAllMocks(); });

describe("floating D-pad from the saved layout", () => {
 it("renders the default layout exactly like today's seven keys", () => {
  const act = vi.fn();
  const keys = elements(FloatingTerminalPad({ bounds, layout: defaultTerminalKeys(), act, disabled: false, open: true })).filter(n => n.type === "Pressable");
  const labels = { esc: es.terminal.escape, backspace: es.terminal.backspace, up: es.terminal.up, left: es.terminal.left, enter: es.terminal.enter, right: es.terminal.right, down: es.terminal.down };
  expect(keys).toHaveLength(7);
  for (const item of terminalPadLayout()) {
   const key = keys.find(k => k.props.accessibilityLabel === labels[item.key])!;
   expect(key.props.style).toMatchObject({ left: item.x, top: item.y, width: 48, height: 48 });
   expect(key.props.onLongPress).toBeUndefined();
   key.props.onPress(); expect(act).toHaveBeenLastCalledWith(item.key, "tap");
  }
 });
 it("renders a custom layout, and a custom button with Enter sends only on hold", () => {
  const act = vi.fn();
  const layout = ok(setPadSlot(ok(setPadSlot(ok(saveCustom(defaultTerminalKeys(), { id: "b1", name: "Estado", text: "git status", enter: true, ignoreCtrl: true })), 6, "custom:b1")), 8, "ctrl+c"));
  const keys = elements(FloatingTerminalPad({ bounds, layout, act, disabled: false, open: true })).filter(n => n.type === "Pressable");
  expect(keys).toHaveLength(9);
  const custom = keys.find(k => k.props.accessibilityLabel === "Botón propio Estado: envía git status y Enter")!;
  expect(custom.props.style).toMatchObject({ left: 12, top: 152 });
  expect(custom.props.delayLongPress).toBe(CUSTOM_HOLD_MS);
  expect(custom.props.accessibilityHint).toBe(es.terminal.holdToSend);
  custom.props.onPress(); expect(act).toHaveBeenLastCalledWith("custom:b1", "tap");
  custom.props.onLongPress(); expect(act).toHaveBeenLastCalledWith("custom:b1", "hold");
  expect(keys.find(k => k.props.accessibilityLabel === "Ctrl+C")?.props.style).toMatchObject({ left: 156, top: 152 });
 });
});

describe("terminal screen reads the saved layout live", () => {
 const screen = read("../../src/app/session/terminal/[id].tsx");
 it("builds the bar from visibleBar and subscribes for live updates", () => {
  expect(screen).toContain("useState(terminalKeys.get)");
  expect(screen).toContain("terminalKeys.subscribe(setKeys)");
  expect(screen).toContain("terminalBarItems(keys, { keyboard, prefixPanel })");
  expect(screen).not.toContain("terminalToolbarKeys(");
  expect(screen).toContain("layout={keys}");
 });
 it("custom buttons: a hold of CUSTOM_HOLD_MS sends; a tap may only show the hint", () => {
  expect(screen).toContain("delayLongPress={CUSTOM_HOLD_MS}");
  expect(screen).toContain("s.holdToSend");
  expect(screen).toContain("customInput(");
 });
});

describe("Ajustes › Terminal › «Personalizar teclas»", () => {
 it("opens the editor route from the terminal card, and only «Guardar» persists", () => {
  expect(read("../../src/app/(tabs)/settings.tsx")).toContain("<TerminalFontSettings><TerminalKeysEntry open={() => router.push(\"/terminal-keys\")} /></TerminalFontSettings>");
  expect(read("../../src/app/terminal-keys.tsx")).toContain("<TerminalKeysEditor close={() => router.back()} />");
  const editor = read("../../src/ui/terminal-keys-editor.tsx");
  expect(editor.match(/terminalKeys\.set\(/g)).toHaveLength(1);
  expect(editor).toContain("terminalKeys.set(draft)");
 });
});

describe("custom button form (S5)", () => {
 const props = (enter: boolean) => ({ visible: true, initial: { id: null, name: "Estado", text: "git status", enter }, layout: defaultTerminalKeys(), submit: vi.fn(), close: vi.fn() });
 const k = es.terminalKeys;
 it("always shows the fixed warning and that it is for every computer", () => {
  for (const enter of [true, false]) {
   const text = texts(elements(CustomButtonForm(props(enter))));
   expect(text).toContain(k.warningTitle); expect(text).toContain(k.warning); expect(text).toContain(k.global);
   expect(k.warningTitle.startsWith("Se ejecuta en la computadora apenas lo tocás")).toBe(true);
   expect(k.warning).toContain("No pongas contraseñas");
  }
 });
 it("says a button with Enter is sent by holding it", () => {
  expect(texts(elements(CustomButtonForm(props(true))))).toContain(k.holdNote);
  expect(texts(elements(CustomButtonForm(props(false))))).not.toContain(k.holdNote);
  expect(k.holdNote).toBe("Se envía manteniéndolo apretado.");
 });
 it("limits the fields, labels the switch, and previews the key", () => {
  const nodes = elements(CustomButtonForm(props(true)));
  const inputs = nodes.filter(n => n.type === "TextInput");
  expect(inputs.map(n => n.props.maxLength)).toEqual([8, 512]);
  expect(inputs[1].props.multiline).toBe(true);
  expect(nodes.find(n => n.type === "Switch")?.props).toMatchObject({ accessibilityLabel: k.enter, value: true });
  expect(texts(nodes)).toContain("6 / 8");
  expect(texts(nodes)).toContain("Estado");
 });
 it("«Ignorar Ctrl» is on for a new button, explains itself, and keeps an edited button's choice", () => {
  const nodes = elements(CustomButtonForm(props(false)));
  expect(nodes.find(n => n.type === "Switch" && n.props.accessibilityLabel === k.ignoreCtrl)?.props.value).toBe(true);
  expect(texts(nodes)).toContain(k.ignoreCtrlHelp);
  expect(k.ignoreCtrl).toBe("Ignorar Ctrl");
  expect(k.ignoreCtrlHelp).toBe("El botón manda siempre su texto, aunque Ctrl esté activado.");
  const layout = ok(saveCustom(defaultTerminalKeys(), { id: "b1", name: "Estado", text: "git status", enter: false, ignoreCtrl: false }));
  const edit = elements(CustomButtonForm({ ...props(false), initial: { id: "b1", name: "Estado", text: "git status", enter: false }, layout }));
  expect(edit.find(n => n.type === "Switch" && n.props.accessibilityLabel === k.ignoreCtrl)?.props.value).toBe(false);
 });
});
