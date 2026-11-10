import { describe, expect, it } from "vitest";
import { parseHerdrKeys } from "../src/core/herdr-keys";
import { terminalToolbarKeys, terminalToolbarWidth, type TerminalToolbarKey } from "../src/core/terminal-controls";
import { addToBar, catalogKeyBytes, defaultTerminalKeys, removeFromBar, saveCustom, TERMINAL_KEY_CATALOG, terminalKeyInfo, type CustomButton, type KeyEdit } from "../src/core/terminal-keys";
import { customAccessibleName, customInput, customPress, keyChip, keyName, padKeyFace, terminalBarItems } from "../src/ui/terminal-key-view";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

const ok = (result: KeyEdit) => { if (!result.ok) throw new Error(result.reason); return result.layout; };
const button = (over: Partial<CustomButton> = {}): CustomButton => ({ id: "b1", name: "Estado", text: "git status", enter: true, ignoreCtrl: true, ...over });
const bytes = (text: string) => new TextEncoder().encode(text);
const info = (id: string) => terminalKeyInfo(defaultTerminalKeys(), id as never)!;
const moments = [false, true].flatMap(keyboard => [false, true].map(prefixPanel => ({ keyboard, prefixPanel })));

describe("terminal bar from the saved layout", () => {
 it("renders the default layout exactly as today: same keys, order and widths in all four moments", () => {
  for (const moment of moments) {
   const items = terminalBarItems(defaultTerminalKeys(), moment);
   expect(items.map(item => item.id)).toEqual(terminalToolbarKeys(moment));
   for (const item of items) expect(item.info.width).toBe(terminalToolbarWidth(item.id as TerminalToolbarKey));
  }
 });
 it("renders a custom layout: added keys, custom buttons, and no removed keys", () => {
  const layout = ok(addToBar(ok(addToBar(ok(saveCustom(ok(removeFromBar(ok(removeFromBar(defaultTerminalKeys(), "attach")), "mic")), button())), "custom:b1", 4)), "ctrl+c", 4));
  const items = terminalBarItems(layout, { keyboard: false, prefixPanel: false });
  expect(items.map(item => item.id)).toEqual(["ctrl", "prefix", "esc", "tab", "ctrl+c", "custom:b1", "paste", "up", "down", "dpad", "keyboard"]);
  expect(items.find(item => item.id === "custom:b1")?.info).toMatchObject({ kind: "custom", label: "Estado", width: 44 });
 });
});

describe("what catalog keys send", () => {
 const herdr = parseHerdrKeys('[keys]\nprefix = "ctrl+a"\nprevious_agent = "prefix+h"\n');
 it("sends terminal keys in the cursor mode the page reports, like today's keys", () => {
  expect(catalogKeyBytes(info("up"), { cursorMode: false, herdr })).toEqual(bytes("\x1b[A"));
  expect(catalogKeyBytes(info("up"), { cursorMode: true, herdr })).toEqual(bytes("\x1bOA"));
  expect(catalogKeyBytes(info("home"), { cursorMode: true, herdr })).toEqual(bytes("\x1bOH"));
  expect(catalogKeyBytes(info("pageDown"), { cursorMode: false, herdr })).toEqual(bytes("\x1b[6~"));
  expect(catalogKeyBytes(info("esc"), { cursorMode: false, herdr })).toEqual(bytes("\x1b"));
 });
 it("sends combos, Space and F-keys as Herdr key specs", () => {
  expect(catalogKeyBytes(info("ctrl+c"), { cursorMode: false, herdr })).toEqual(new Uint8Array([3]));
  expect(catalogKeyBytes(info("alt+b"), { cursorMode: false, herdr })).toEqual(bytes("\x1bb"));
  expect(catalogKeyBytes(info("space"), { cursorMode: false, herdr })).toEqual(bytes(" "));
  expect(catalogKeyBytes(info("f5"), { cursorMode: false, herdr })).toEqual(bytes("\x1b[15~"));
 });
 it("sends the agent keys with this computer's Herdr prefix, or nothing when not configured", () => {
  expect(catalogKeyBytes(info("previousAgent"), { cursorMode: false, herdr })).toEqual(new Uint8Array([1, 104]));
  expect(catalogKeyBytes(info("nextAgent"), { cursorMode: false, herdr })).toBeNull();
 });
 it("app controls and custom buttons are not catalog bytes", () => {
  expect(catalogKeyBytes(info("mic"), { cursorMode: false, herdr })).toBeNull();
  expect(catalogKeyBytes(terminalKeyInfo(ok(saveCustom(defaultTerminalKeys(), button())), "custom:b1")!, { cursorMode: false, herdr })).toBeNull();
 });
});

describe("custom buttons in the terminal: hold to send (S5)", () => {
 it("with Enter, a tap only shows the hint and a hold sends the text and Enter", () => {
  expect(customPress(button(), "tap")).toEqual({ bytes: null, hint: true });
  expect(customPress(button(), "hold")).toEqual({ bytes: bytes("git status\r"), hint: false });
 });
 it("without Enter, a tap or a hold types the text", () => {
  for (const gesture of ["tap", "hold"] as const) expect(customPress(button({ enter: false, text: "ls" }), gesture)).toEqual({ bytes: bytes("ls"), hint: false });
 });
 it("with «Ignorar Ctrl», sends the text as written and leaves Ctrl as it was", () => {
  const armed = { mode: "armed" as const, tappedAt: 10 }, locked = { mode: "locked" as const, tappedAt: null };
  expect(customInput(button({ enter: false, text: "c" }), "tap", armed)).toEqual({ bytes: bytes("c"), hint: false, ctrl: armed });
  expect(customInput(button({ enter: false, text: "c" }), "tap", locked)).toEqual({ bytes: bytes("c"), hint: false, ctrl: locked });
  expect(customInput(button(), "tap", armed)).toEqual({ bytes: null, hint: true, ctrl: armed });
 });
 it("without «Ignorar Ctrl», goes through Ctrl like typed text and uses up an armed Ctrl", () => {
  const armed = { mode: "armed" as const, tappedAt: 10 }, locked = { mode: "locked" as const, tappedAt: null };
  const plain = button({ enter: false, text: "c", ignoreCtrl: false });
  expect(customInput(plain, "tap", armed)).toEqual({ bytes: new Uint8Array([3]), hint: false, ctrl: { mode: "off", tappedAt: null } });
  expect(customInput(plain, "tap", locked)).toEqual({ bytes: new Uint8Array([3]), hint: false, ctrl: locked });
  expect(customInput(plain, "tap", { mode: "off", tappedAt: null })).toEqual({ bytes: bytes("c"), hint: false, ctrl: { mode: "off", tappedAt: null } });
  expect(customInput(button({ ignoreCtrl: false }), "tap", armed)).toEqual({ bytes: null, hint: true, ctrl: armed });
 });
 it("says what the button sends to screen readers, and that it needs a hold", () => {
  expect(customAccessibleName(button(), es.terminalKeys)).toBe("Botón propio Estado: envía git status y Enter");
  expect(customAccessibleName(button({ enter: false }), en.terminalKeys)).toBe("Custom button Estado: types git status");
  expect(customAccessibleName(button({ text: "x".repeat(200) }), es.terminalKeys).length).toBeLessThan(120);
 });
});

describe("key names and faces", () => {
 it("every catalog key has a spoken name in both languages", () => {
  for (const strings of [es, en]) for (const key of TERMINAL_KEY_CATALOG) {
   const name = keyName(key, strings.terminal);
   expect(name.length, key.id).toBeGreaterThan(0);
   expect(name).not.toBe(key.accessible && "i18n" in key.accessible ? key.accessible.i18n : "");
  }
  expect(keyName(info("pageUp"), es.terminal)).toBe("Página arriba");
  expect(keyName(info("ctrl+c"), es.terminal)).toBe("Ctrl+C");
  expect(es.terminal.holdToSend).toBe("Mantené apretado para enviar");
 });
 it("catalog chips read like the artboard", () => {
  expect(keyChip(info("esc"), es.terminal)).toBe("Esc");
  expect(keyChip(info("enter"), es.terminal)).toBe("↵ Enter");
  expect(keyChip(info("ctrl+c"), es.terminal)).toBe("Ctrl+C");
  expect(keyChip(info("home"), es.terminal)).toBe("⇱ Inicio");
  expect(keyChip(info("mic"), es.terminal)).toBe("Dictar");
  expect(keyChip(info("previousAgent"), es.terminal)).toBe("Agente anterior");
 });
 it("keeps today's D-pad faces: small Esc, big accented Enter", () => {
  expect(padKeyFace(info("esc"))).toEqual({ glyph: "Esc", size: 12, accent: false });
  expect(padKeyFace(info("enter"))).toEqual({ glyph: "↵", size: 26, accent: true });
  expect(padKeyFace(info("up"))).toEqual({ glyph: "↑", size: 18, accent: false });
  expect(padKeyFace(info("ctrl+c")).size).toBe(18);
  expect(padKeyFace(info("f10")).size).toBe(12);
 });
});
