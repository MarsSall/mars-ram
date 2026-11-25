import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { proxyInput } from "../../src/core/terminal-keyboard";

// A model of the hidden Android TextInput, following RN 0.88 sources:
// - every native text change emits onChangeText with the whole native text;
// - JS cannot empty it from onChangeText: TextInput.clear() there carries the previous
//   render's event count (TextInput.js _onChange updates it only afterwards) and
//   ReactEditText.maybeSetText drops it as stale, so the native text keeps growing;
// - a soft Backspace fires onKeyPress before the native deletion (if any);
// - the input is multiline with submitBehavior="newline", so Enter (IME action or a
//   KEYCODE_ENTER key event) inserts "\n" into the native text and fires no submit/blur.
//   A single-line input would hide the keyboard: ReactEditText.onKeyUp calls
//   hideSoftKeyboard() on KEYCODE_ENTER whenever !isMultiline, whatever submitBehavior is.
function proxyFake() {
 const sent: string[] = [];
 let native = "";
 const decoder = new TextDecoder();
 const typed = proxyInput({ send: bytes => sent.push(decoder.decode(bytes)) });
 let blurs = 0;
 const edit = (next: string) => {
  if (next === native) return;
  native = next;
  typed.change(native);
 };
 return {
  sent,
  native: () => native,
  type(text: string) { for (const ch of text) edit(native + ch); },
  /** Samsung clipboard chip / keyboard «Pegar»: one commit of the whole clip. */
  paste(text: string) { edit(native + text); },
  /** IME composition: the composing region grows letter by letter, then commits as is. */
  compose(word: string, commit = word) {
   const base = native;
   const letters = Array.from(word);
   for (let i = 1; i <= letters.length; i++) edit(base + letters.slice(0, i).join(""));
   edit(base + commit);
  },
  backspace() { typed.key("Backspace"); if (native) edit(native.slice(0, -1)); },
  enter() { edit(native + "\n"); },
  /** The input lost focus and was recreated empty. */
  blur() { blurs++; native = ""; typed.reset(); },
  blurs: () => blurs,
 };
}

const DEL = "\x7f";

describe("hidden input proxy: a paste is sent once (paste repeat bug)", () => {
 it("paste once then type «abc» sends the pasted text once followed by a, b, c", () => {
  const p = proxyFake();
  p.paste("git status");
  p.type("abc");
  expect(p.sent).toEqual(["git status", "a", "b", "c"]);
 });
 it("typing without a paste sends each key once", () => {
  const p = proxyFake();
  p.type("ls -la");
  expect(p.sent.join("")).toBe("ls -la");
  expect(p.sent).toEqual(["l", "s", " ", "-", "l", "a"]);
 });
 it("an IME composition sends the word once, also when it commits unchanged", () => {
  const p = proxyFake();
  p.compose("hola");
  p.type(" ");
  p.compose("mundo");
  expect(p.sent.join("")).toBe("hola mundo");
 });
 it("an IME correction of the composing word sends only the edit", () => {
  const p = proxyFake();
  p.compose("teh", "the");
  // t e h, then the correction: two Backspaces and «he».
  expect(p.sent.join("")).toBe(`teh${DEL}${DEL}he`);
 });
 it("Backspace sends one DEL after typing, after a paste and on an empty input", () => {
  const p = proxyFake();
  p.type("ab");
  p.backspace();
  p.paste("xyz");
  p.backspace();
  p.type("c");
  expect(p.sent).toEqual(["a", "b", DEL, "xyz", DEL, "c"]);
  const empty = proxyFake();
  empty.backspace(); empty.backspace();
  expect(empty.sent).toEqual([DEL, DEL]);
 });
 it("deleting everything typed, then Backspace again, still reaches the terminal", () => {
  const p = proxyFake();
  p.type("a");
  p.backspace();
  p.backspace();
  expect(p.sent).toEqual(["a", DEL, DEL]);
 });
 it("Enter sends CR and does not resend the line", () => {
  const p = proxyFake();
  p.paste("echo hi");
  p.enter();
  p.type("x");
  expect(p.sent).toEqual(["echo hi", "\r", "x"]);
 });
 it("Enter sends exactly one CR and keeps the input (no blur, no remount)", () => {
  const p = proxyFake();
  p.type("ls");
  p.enter();
  expect(p.sent).toEqual(["l", "s", "\r"]);
  expect(p.blurs()).toBe(0);
  expect(p.native()).toBe("ls\n");
 });
 it("typing after Enter sends only the new characters, also after a paste and twice", () => {
  const p = proxyFake();
  p.paste("git status");
  p.enter();
  p.type("ab");
  p.enter();
  p.enter();
  p.compose("pwd");
  expect(p.sent).toEqual(["git status", "\r", "a", "b", "\r", "\r", "p", "w", "d"]);
 });
 it("a pasted newline is Enter and an emoji is not split", () => {
  const p = proxyFake();
  p.paste("a\nb");
  p.type("😀");
  expect(p.sent).toEqual(["a\rb", "😀"]);
  const q = proxyFake();
  q.compose("😀", "😃");
  expect(q.sent).toEqual(["😀", DEL, "😃"]);
 });
 it("after the input is recreated on blur, typing starts from empty", () => {
  const p = proxyFake();
  p.paste("secret");
  p.blur();
  p.type("ok");
  p.backspace(); p.backspace(); p.backspace();
  expect(p.sent).toEqual(["secret", "o", "k", DEL, DEL, DEL]);
 });
});

describe("screen wiring", () => {
 const screen = readFileSync(new URL("../../src/app/session/terminal/[id].tsx", import.meta.url), "utf8");
 it("routes the hidden input through proxyInput and never clears it from onChangeText", () => {
  expect(screen).toContain("onChangeText={text => typed.change(text)}");
  expect(screen).toContain("onKeyPress={({ nativeEvent }) => typed.key(nativeEvent.key)}");
  expect(screen).not.toContain("proxy.current?.clear()");
 });
 it("Enter is a newline in the text diff, so the keyboard stays open", () => {
  // Single-line ReactEditText hides the keyboard on KEYCODE_ENTER (onKeyUp); multiline does not.
  expect(screen).toMatch(/<TextInput key=\{proxyGeneration\}[^>]*\bmultiline\b/);
  expect(screen).toMatch(/<TextInput key=\{proxyGeneration\}[^>]*submitBehavior="newline"/);
  expect(screen).not.toContain("onSubmitEditing");
  expect(screen).not.toContain("blurOnSubmit");
 });
 it("recreates the hidden input empty when it loses focus", () => {
  expect(screen).toContain("key={proxyGeneration}");
  expect(screen).toMatch(/onBlur=\{\(\) => \{ setProxyActive\(false\); typed\.reset\(\); setProxyGeneration\(/);
 });
});
