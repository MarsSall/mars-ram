import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { terminalHtml } from "../../assets/terminal/page";

function page() {
 const messages: Record<string, unknown>[] = [];
 const listeners = new Map<string, (event: { data: string }) => void>();
 const handlers: Record<string, (value?: any) => void> = {};
 const writes: Uint8Array[] = [];
 let terminal: any;
 const textareaListeners = new Map<string, { fn: (event: any) => void; capture: boolean }[]>();
 const textarea = {
  value: "",
  addEventListener(name: string, fn: (event: any) => void, capture = false) {
   const entries = textareaListeners.get(name) ?? [];
   entries.push({ fn, capture }); textareaListeners.set(name, entries);
  },
 };
 const dispatchTextarea = (name: string, event: any = {}) => {
  for (const capture of [true, false]) {
   for (const listener of textareaListeners.get(name) ?? []) {
    if (listener.capture === capture) listener.fn(event);
   }
  }
 };
 class Terminal {
  options: Record<string, any>; cols = 80; rows = 24; modes = { applicationCursorKeysMode: false };
  constructor(options: Record<string, any>) { this.options = options; terminal = this; }
  textarea = textarea;
  bracketedPaste = false;
  paste(text: string) { handlers.data(this.bracketedPaste ? `\x1b[200~${text}\x1b[201~` : text); }
  loadAddon() {}
  open() {
   // xterm 6 handles the clipboard but does not cancel the browser default.
   textarea.addEventListener("paste", (event) => {
    event.stopPropagation(); this.paste(event.clipboardData.getData("text/plain")); textarea.value = "";
   });
  }
  focus() {} blur() {}
  onData(fn: () => void) { handlers.data = fn; } onBinary(fn: () => void) { handlers.binary = fn; }
  onResize(fn: () => void) { handlers.resize = fn; } onWriteParsed(fn: () => void) { handlers.parsed = fn; }
  onSelectionChange(fn: () => void) { handlers.selection = fn; } getSelection() { return "selected"; }
  resets = 0;
  reset() { this.resets++; this.modes.applicationCursorKeysMode = false; }
  write(bytes: Uint8Array) { writes.push(bytes); }
 }
 const wheels: { deltaY: number; deltaMode: number; clientX: number; clientY: number }[] = [];
 const touch = new Map<string, (event: any) => void>();
 const node = { addEventListener() {}, clientWidth: 400, clientHeight: 600, dispatchEvent: (event: any) => { wheels.push({ deltaY: event.deltaY, deltaMode: event.deltaMode, clientX: event.clientX, clientY: event.clientY }); return true; } };
 const document = {
  body: node, getElementById: () => node, querySelector: () => node,
  addEventListener: (name: string, fn: any) => (name.startsWith("touch") ? touch.set(name, fn) : listeners.set(name, fn)),
 };
 class WheelEvent { deltaY: number; deltaMode: number; clientX: number; clientY: number; constructor(_type: string, init: any) { this.deltaY = init.deltaY; this.deltaMode = init.deltaMode; this.clientX = init.clientX; this.clientY = init.clientY; } }
 const window = { ReactNativeWebView: { postMessage: (message: string) => messages.push(JSON.parse(message)) }, addEventListener() {}, open() {} };
 const script = terminalHtml.slice(terminalHtml.lastIndexOf("<script>") + 8, terminalHtml.lastIndexOf("</script>"));
 runInNewContext(script, { Terminal, FitAddon: { FitAddon: class { fit() {} } }, document, window, TextEncoder, Uint8Array, atob, btoa, WheelEvent, ResizeObserver: class { observe() {} }, requestAnimationFrame: (fn: () => void) => fn() });
 const finger = (name: string, ys: number[]) => {
  const event = { touches: ys.map((y) => ({ clientX: 100, clientY: y })), prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  touch.get(name)!(event); return event;
 };
 const paste = (text: string) => {
  const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, clipboardData: { getData: () => text } };
  dispatchTextarea("paste", event);
  // A WebView's uncancelled native paste runs after xterm's handler.
  if (!event.defaultPrevented) textarea.value += text;
  return event;
 };
 const type = (text: string) => { textarea.value += text; handlers.data(textarea.value); };
 const input = () => messages.filter((m) => m.type === "input").map((m) => Buffer.from(m.data as string, "base64").toString("utf8"));
 return { messages, terminal, handlers, writes, wheels, finger, paste, type, input, textarea, dispatchTextarea, receive: (message: unknown) => listeners.get("message")!({ data: JSON.stringify(message) }) };
}

describe("bundled terminal page bridge", () => {
 it("cancels native paste insertion so subsequent Android input cannot replay the clipboard", () => {
  const p = page();
  p.paste("clipboard ñ");
  expect(p.input()).toEqual(["clipboard ñ"]);
  p.type("a");
  expect(p.input()).toEqual(["clipboard ñ", "a"]);
 });
 it("keeps xterm's bracketed paste encoding and handles repeated pastes once each", () => {
  const p = page(); p.terminal.bracketedPaste = true;
  expect(p.paste("one\ntwo").defaultPrevented).toBe(true);
  p.paste("three"); p.type("z");
  expect(p.input()).toEqual(["\x1b[200~one\ntwo\x1b[201~", "\x1b[200~three\x1b[201~", "z"]);
 });
 it("defers paste cleanup until composition ends without clearing normal IME input", () => {
  const p = page();
  p.dispatchTextarea("compositionstart"); p.textarea.value = "draft";
  p.paste("clipboard");
  // Simulate an IME update after xterm's paste handler has emptied the textarea.
  p.textarea.value = "に"; p.handlers.data("に");
  expect(p.textarea.value).toBe("に");
  p.dispatchTextarea("compositionend");
  // xterm reads the final composition asynchronously; do not erase it first.
  expect(p.textarea.value).toBe("に");
  p.handlers.data("本");
  expect(p.textarea.value).toBe("");
  p.type("x"); expect(p.input()).toEqual(["clipboard", "に", "本", "x"]);
  p.dispatchTextarea("compositionstart"); p.textarea.value = "日本";
  p.handlers.data("日本"); p.dispatchTextarea("compositionend");
  expect(p.textarea.value).toBe("日本");
 });
 it("turns a one-finger vertical drag into wheel scrolling at the finger, older content when dragging down", () => {
  const p = page();
  p.finger("touchstart", [500]);
  expect(p.finger("touchmove", [503]).prevented).toBe(false); // a tap jitter is not a scroll
  const move = p.finger("touchmove", [560]);
  expect(move.prevented).toBe(true);
  // At the finger, so Herdr scrolls the pane under it and not the cell at 1;1.
  expect(p.wheels).toEqual([{ deltaY: -60, deltaMode: 0, clientX: 100, clientY: 560 }]);
  p.finger("touchmove", [540]);
  expect(p.wheels.at(-1)).toEqual({ deltaY: 20, deltaMode: 0, clientX: 100, clientY: 540 });
  p.finger("touchend", []);
 });
 it("sends no wheel for a tap or a two-finger pinch", () => {
  const p = page();
  p.finger("touchstart", [500]); p.finger("touchmove", [504]); p.finger("touchend", []);
  p.finger("touchstart", [500, 700]); p.finger("touchmove", [440, 760]); p.finger("touchend", []);
  expect(p.wheels).toEqual([]);
 });
 it("ships an offline document with both emulator libraries and deny-by-default resource policy", () => {
  expect(terminalHtml).toContain("default-src 'none'");
  expect(terminalHtml).toContain("connect-src 'none'");
  expect(terminalHtml).not.toMatch(/<(?:script|link|iframe)[^>]+(?:src|href)=/i);
  expect(terminalHtml).toContain("FitAddon");
  expect(terminalHtml).toContain("xterm-viewport");
 });
 it("handshakes and sends dimensions even when fit did not change size", () => {
  const p = page(); expect(p.messages).toContainEqual({ type: "ready" });
  p.receive({ type: "fit" });
  expect(p.messages.at(-1)).toEqual({ type: "size", cols: 80, rows: 24 });
  p.receive({ type: "fontSize", value: 20 }); expect(p.terminal.options.fontSize).toBe(20);
  p.receive({ type: "fontSize", value: 0 }); expect(p.terminal.options.fontSize).toBe(20);
 });
 it("resets the emulator and reports cleared cursor mode and selection before a full redraw", () => {
  const p = page(); p.terminal.modes.applicationCursorKeysMode = true; p.handlers.parsed();
  p.receive({ type: "reset" });
  expect(p.terminal.resets).toBe(1);
  expect(p.messages.slice(-2)).toEqual([{ type: "cursorMode", enabled: false }, { type: "selection", text: "" }]);
 });
 it("preserves output bytes, Unicode input, binary mouse input and cursor mode", () => {
  const p = page();
  p.receive({ type: "output", data: btoa(String.fromCharCode(0, 27, 255)) });
  expect([...p.writes[0]]).toEqual([0, 27, 255]);
  p.handlers.data("ñ"); expect(p.messages.at(-1)).toEqual({ type: "input", data: "w7E=" });
  p.handlers.binary(String.fromCharCode(255)); expect(p.messages.at(-1)).toEqual({ type: "input", data: "/w==" });
  p.terminal.modes.applicationCursorKeysMode = true; p.handlers.parsed();
  expect(p.messages.at(-1)).toEqual({ type: "cursorMode", enabled: true });
  p.handlers.selection(); expect(p.messages.at(-1)).toEqual({ type: "selection", text: "selected" });
 });
});
