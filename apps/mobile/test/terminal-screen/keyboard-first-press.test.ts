import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { terminalHtml } from "../../assets/terminal/page";
import { decodeWebMessage } from "../../src/core/terminal-controls";
import { TAP_SETTLE_MS, proxyKeyBytes, proxyTextBytes, terminalKeyboard } from "../../src/core/terminal-keyboard";

// A fake platform: the hidden input's focus and RN's last-known keyboard visibility are
// plain state, and every platform call is recorded in order. The real IME needs a phone.
function fakes() {
 const calls: string[] = [];
 const state = { proxy: false, visible: false };
 const keyboard = terminalKeyboard({
  proxyFocused: () => state.proxy,
  keyboardVisible: () => state.visible,
  focusProxy: () => { calls.push("focusProxy"); state.proxy = true; },
  blurProxy: () => { calls.push("blurProxy"); state.proxy = false; },
  dismiss: () => calls.push("dismiss"),
  focusTerminal: () => calls.push("focusTerminal"),
 });
 return { calls, state, keyboard };
}

describe("terminal keyboard button (S1)", () => {
 beforeEach(() => { vi.useFakeTimers(); });
 afterEach(() => { vi.useRealTimers(); });

 it("first press opens the keyboard on the hidden input and never hands focus to the WebView", () => {
  const { calls, keyboard } = fakes();
  keyboard.pageReady(true);
  expect(keyboard.press()).toBe(true);
  expect(calls).toEqual(["focusProxy"]);
  vi.advanceTimersByTime(5000);
  expect(calls).toEqual(["focusProxy"]);
 });
 it("toggles from the real state: the hidden input being focused means open, even without keyboardDidShow", () => {
  const { calls, keyboard } = fakes();
  keyboard.press();
  // keyboardDidShow never arrived (biometric prompt, app in background): visible stays false.
  expect(keyboard.isOpen()).toBe(true);
  expect(keyboard.press()).toBe(false);
  expect(calls).toEqual(["focusProxy", "blurProxy", "dismiss"]);
  expect(keyboard.press()).toBe(true);
  expect(keyboard.press()).toBe(false);
  expect(calls).toEqual(["focusProxy", "blurProxy", "dismiss", "focusProxy", "blurProxy", "dismiss"]);
 });
 it("closes a keyboard the terminal opened by tap (no hidden input focus) with dismiss only", () => {
  const { calls, state, keyboard } = fakes();
  state.visible = true;
  expect(keyboard.press()).toBe(false);
  expect(calls).toEqual(["dismiss"]);
 });
 it("system Back hides the keyboard: the hidden input is released so the next press opens", () => {
  const { calls, keyboard } = fakes();
  keyboard.press();
  keyboard.keyboardHidden();
  expect(calls).toEqual(["focusProxy", "blurProxy"]);
  expect(keyboard.press()).toBe(true);
  expect(calls).toEqual(["focusProxy", "blurProxy", "focusProxy"]);
  keyboard.keyboardHidden(); keyboard.keyboardHidden();
  expect(calls).toEqual(["focusProxy", "blurProxy", "focusProxy", "blurProxy"]);
 });
});

describe("tapping the terminal while the hidden input owns the keyboard (S2)", () => {
 beforeEach(() => { vi.useFakeTimers(); });
 afterEach(() => { vi.useRealTimers(); });

 it("does nothing when native focus already moved to the WebView", () => {
  const { calls, state, keyboard } = fakes();
  keyboard.press();
  state.proxy = false; // the WebView took native focus on touch; the input's onBlur already ran
  keyboard.terminalTapped();
  vi.advanceTimersByTime(TAP_SETTLE_MS);
  expect(calls).toEqual(["focusProxy"]);
 });
 it("blurs the hidden input once the tap settled if it still owns the IME", () => {
  const { calls, keyboard } = fakes();
  keyboard.press();
  keyboard.terminalTapped();
  expect(calls).toEqual(["focusProxy"]);
  vi.advanceTimersByTime(TAP_SETTLE_MS);
  expect(calls).toEqual(["focusProxy", "blurProxy"]);
 });
 it("waits for the focus change to land before deciding", () => {
  const { calls, state, keyboard } = fakes();
  keyboard.press();
  keyboard.terminalTapped();
  state.proxy = false; // onBlur arrives after the page's tap message
  vi.advanceTimersByTime(TAP_SETTLE_MS);
  expect(calls).toEqual(["focusProxy"]);
 });
 it("a button press cancels a pending tap check", () => {
  const { calls, keyboard } = fakes();
  keyboard.press(); keyboard.terminalTapped();
  keyboard.press(); keyboard.press();
  vi.advanceTimersByTime(TAP_SETTLE_MS);
  expect(calls).toEqual(["focusProxy", "blurProxy", "dismiss", "focusProxy"]);
 });
});

describe("other focus requests (PREFIX, project paste)", () => {
 it("focus the terminal once the page is ready", () => {
  const { calls, keyboard } = fakes();
  keyboard.focus();
  expect(calls).toEqual([]);
  keyboard.pageReady(true);
  expect(calls).toEqual(["focusTerminal"]);
  keyboard.pageReady(true);
  keyboard.focus();
  expect(calls).toEqual(["focusTerminal", "focusTerminal"]);
  keyboard.pageReady(false); keyboard.focus();
  expect(calls).toEqual(["focusTerminal", "focusTerminal"]);
 });
 it("keep the hidden input when it owns the keyboard (typing already reaches the terminal)", () => {
  const { calls, keyboard } = fakes();
  keyboard.pageReady(true);
  keyboard.press(); keyboard.focus();
  expect(calls).toEqual(["focusProxy"]);
 });
 it("blurring the terminal (switcher, chat, project sheet) drops a queued focus and releases the hidden input", () => {
  const { calls, keyboard } = fakes();
  keyboard.focus(); keyboard.release(); keyboard.pageReady(true);
  expect(calls).toEqual([]);
  keyboard.press(); keyboard.release();
  expect(calls).toEqual(["focusProxy", "blurProxy"]);
 });
});

describe("keys typed into the hidden input reach the terminal", () => {
 it("maps Backspace and Enter to terminal bytes and ignores other key events", () => {
  expect(proxyKeyBytes("Backspace")).toEqual(new Uint8Array([0x7f]));
  expect(proxyKeyBytes("Enter")).toEqual(new Uint8Array([0x0d]));
  expect(proxyKeyBytes("a")).toBeNull();
  expect(proxyKeyBytes("Tab")).toBeNull();
 });
 it("sends text as UTF-8, newlines as Enter and keeps Tab", () => {
  expect(proxyTextBytes("x")).toEqual(new TextEncoder().encode("x"));
  expect(proxyTextBytes("ñ\t")).toEqual(new TextEncoder().encode("ñ\t"));
  expect(proxyTextBytes("a\nb\r\n")).toEqual(new TextEncoder().encode("a\rb\r"));
 });
});

describe("terminal page", () => {
 it("reports a tap on the terminal and no longer acknowledges focus requests", () => {
  expect(terminalHtml).toContain("document.getElementById('terminal').addEventListener('click',()=>{term.focus();post({type:'tap'});});");
  expect(terminalHtml).not.toContain("type:'focused'");
  expect(decodeWebMessage('{"type":"tap"}')).toEqual({ type: "tap" });
  expect(decodeWebMessage('{"type":"focused"}')).toBeNull();
 });
});

describe("screen wiring", () => {
 const screen = readFileSync(new URL("../../src/app/session/terminal/[id].tsx", import.meta.url), "utf8");
 it("routes the button, keyboard events, taps, page ready and blur through the controller", () => {
  expect(screen).toContain("proxyFocused: () => proxy.current?.isFocused() ?? false");
  expect(screen).toContain("keyboardVisible: () => Keyboard.isVisible()");
  expect(screen).toContain("blurProxy: () => proxy.current?.blur()");
  expect(screen).toContain("kbd.press()");
  expect(screen).toContain("kbd.keyboardHidden()");
  expect(screen).toContain("kbd.terminalTapped()");
  expect(screen).toContain("kbd.pageReady(true)");
  expect(screen).toContain("kbd.release()");
  expect(screen).not.toContain("kbd.pageFocused");
  expect(screen).not.toContain("kbd.keyboardShown");
 });
 it("routes the hidden input's text, Backspace and Enter to the terminal", () => {
  expect(screen).toContain("input(proxyTextBytes(text))");
  expect(screen).toContain('input(proxyKeyBytes("Backspace")!)');
  expect(screen).toContain('input(proxyKeyBytes("Enter")!)');
 });
});
