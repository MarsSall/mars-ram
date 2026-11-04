import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { terminalKey } from "../../src/core/herdr-terminal";
import { terminalToolbarKeys, terminalToolbarWidth, terminalChromeInsets, terminalPadLayout, clampDpad, clampDpadTab, resolveDpadGesture, consumeTerminalCtrl, decodeWebMessage, encodeTerminalMessage, sessionDestination } from "../../src/core/terminal-controls";

describe("immersive terminal controls", () => {
 it("fits all four moments in 360dp without scrolling, including the four-arrow panel", () => {
  for (const keyboard of [false, true]) for (const prefixPanel of [false, true]) {
   const keys = terminalToolbarKeys({ keyboard, prefixPanel });
   expect(keys[0]).toBe("attach");
   expect(keys.at(-1)).toBe("keyboard");
   expect(keys.reduce((width, key) => width + terminalToolbarWidth(key), 20 + 14 + (keys.length - 1) * 2)).toBeLessThanOrEqual(360);
  }
 });
 it("puts the dictation mic after paste except when the PREFIX panel needs the four arrows (voice-dictation 04)", () => {
  expect(terminalToolbarKeys({ keyboard: false, prefixPanel: false })).toEqual(["attach", "ctrl", "prefix", "esc", "tab", "paste", "mic", "up", "down", "dpad", "keyboard"]);
  expect(terminalToolbarKeys({ keyboard: true, prefixPanel: false })).toEqual(["attach", "ctrl", "prefix", "esc", "tab", "paste", "mic", "dpad", "keyboard"]);
  for (const keyboard of [false, true]) expect(terminalToolbarKeys({ keyboard, prefixPanel: true })).not.toContain("mic");
 });
 it("keeps the camera row and navigation inset independently of keyboard avoidance", () => {
  expect(terminalChromeInsets({ top: 28, bottom: 24 }, false)).toEqual({ stripHeight: 32, cameraGap: 64, bottom: 24 });
  expect(terminalChromeInsets({ top: 40, bottom: 24 }, true)).toEqual({ stripHeight: 40, cameraGap: 80, bottom: 0 });
  expect(terminalChromeInsets({ top: 0, bottom: 0 }, false)).toEqual({ stripHeight: 32, cameraGap: 64, bottom: 0 });
 });
 it("always exposes the edge tab and shares controlled pad state with the toolbar", () => {
  const pad = readFileSync(new URL("../../src/ui/floating-terminal-pad.tsx", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../../src/app/session/terminal/[id].tsx", import.meta.url), "utf8");
  expect(pad).not.toContain("hideTab");
  expect(screen).not.toContain("hideTab");
  expect(screen).toContain("open={padOpen}");
  expect(screen).toContain("onOpenChange={setPadOpen}");
  expect(screen).toContain("setPadOpen(value => !value)");
 });
 it("keeps Escape and the pad toggle in every moment, moving Enter and Backspace to the pad", () => {
  for (const keyboard of [false, true]) for (const prefixPanel of [false, true]) {
   const keys = terminalToolbarKeys({ keyboard, prefixPanel });
   expect(keys).toEqual(expect.arrayContaining(["esc", "dpad", "ctrl", "prefix"]));
   expect(keys).not.toContain("enter");
   expect(keys).not.toContain("backspace");
  }
 });
 it("places Enter at the center of four arrows and preserves Esc and Backspace", () => {
  const layout = terminalPadLayout();
  expect(layout).toEqual([
   { key: "esc", x: 12, y: 8 }, { key: "backspace", x: 156, y: 8 },
   { key: "up", x: 84, y: 8 }, { key: "left", x: 12, y: 80 },
   { key: "enter", x: 84, y: 80 }, { key: "right", x: 156, y: 80 },
   { key: "down", x: 84, y: 152 },
  ]);
  expect(new Set(layout.map(item => item.key)).size).toBe(7);
 });
 it("preserves terminal key bytes in normal and application cursor modes", () => {
  const fixed = { esc: "\u001b", tab: "\t", enter: "\r", backspace: "\u007f" };
  for (const application of [false, true]) {
   for (const [key, value] of Object.entries(fixed)) expect(terminalKey(key, application)).toEqual(new TextEncoder().encode(value));
   for (const [key, suffix] of Object.entries({ up: "A", down: "B", left: "D", right: "C" })) {
    expect(terminalKey(key, application)).toEqual(new TextEncoder().encode(`\u001b${application ? "O" : "["}${suffix}`));
   }
  }
 });
});

describe("terminal controls", () => {
 it("arms Ctrl for exactly one ASCII letter without changing non-letter input", () => {
  expect(consumeTerminalCtrl(true, new Uint8Array([99]))).toEqual({ armed: false, bytes: new Uint8Array([3]) });
  expect(consumeTerminalCtrl(false, new Uint8Array([99]))).toEqual({ armed: false, bytes: new Uint8Array([99]) });
  expect(consumeTerminalCtrl(true, new Uint8Array([27, 91, 65]))).toEqual({ armed: false, bytes: new Uint8Array([27, 91, 65]) });
  expect(consumeTerminalCtrl(true, new Uint8Array())).toEqual({ armed: true, bytes: new Uint8Array() });
 });
 it("clamps the floating pad above the final terminal line, including small landscapes", () => {
  expect(clampDpad({ x: -20, y: 900 }, { width: 400, height: 500 })).toEqual({ x: 0, y: 236 });
  expect(clampDpad({ x: 900, y: -10 }, { width: 180, height: 100 })).toEqual({ x: 0, y: 0 });
 });
 it("toggles the edge tab on taps but not on drags that return to their origin", () => {
  expect(resolveDpadGesture(false, { dx: 2, dy: 3, vx: 0, distance: 3 })).toBe(true);
  expect(resolveDpadGesture(true, { dx: 0, dy: 0, vx: 0, distance: 0 })).toBe(false);
  expect(resolveDpadGesture(false, { dx: 0, dy: 0, vx: 0, distance: 60 })).toBe(false);
 });
 it("opens left and closes right by distance or a deliberate horizontal flick", () => {
  expect(resolveDpadGesture(false, { dx: -40, dy: 2, vx: 0, distance: 40 })).toBe(true);
  expect(resolveDpadGesture(true, { dx: 40, dy: 2, vx: 0, distance: 40 })).toBe(false);
  expect(resolveDpadGesture(false, { dx: -12, dy: 0, vx: -0.6, distance: 12 })).toBe(true);
  expect(resolveDpadGesture(true, { dx: 12, dy: 0, vx: 0.6, distance: 12 })).toBe(false);
  expect(resolveDpadGesture(false, { dx: -20, dy: 0, vx: 0, distance: 20 })).toBe(false);
  expect(resolveDpadGesture(true, { dx: -80, dy: 0, vx: -1, distance: 80 })).toBe(true);
  expect(resolveDpadGesture(false, { dx: 80, dy: 0, vx: 1, distance: 80 })).toBe(false);
 });
 it("keeps vertical drags from toggling even with horizontal velocity", () => {
  for (const open of [false, true]) expect(resolveDpadGesture(open, { dx: -40, dy: 100, vx: -1, distance: 100 })).toBe(open);
 });
 it("clamps the 64dp edge tab above the protected line on resize and tiny bounds", () => {
  expect(clampDpadTab(-10, 500)).toBe(0);
  expect(clampDpadTab(900, 500)).toBe(388);
  expect(clampDpadTab(200, 80)).toBe(0);
  expect(clampDpadTab(200, 0)).toBe(0);
 });
 it("round trips all byte values without Unicode conversion", () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  const encoded = JSON.parse(encodeTerminalMessage({ type: "output", bytes }));
  expect(decodeWebMessage(JSON.stringify({ type: "input", data: encoded.data }))).toEqual({ type: "input", bytes });
  expect(encodeTerminalMessage({ type: "fontSize", value: 16 })).toBe('{"type":"fontSize","value":16}');
 });
 it("validates untrusted page messages and rejects oversized/invalid payloads", () => {
  for (const raw of ['null', '{}', 'bad', '{"type":"input","data":"!"}', '{"type":"size","cols":0,"rows":24}', '{"type":"size","cols":80.5,"rows":24}', '{"type":"cursorMode","enabled":"yes"}', JSON.stringify({ type: "input", data: "A".repeat(100000) })]) expect(decodeWebMessage(raw)).toBeNull();
  expect(decodeWebMessage('{"type":"size","cols":80,"rows":24}')).toEqual({ type: "size", cols: 80, rows: 24 });
  expect(decodeWebMessage('{"type":"selection","text":"hola"}')).toEqual({ type: "selection", text: "hola" });
  expect(decodeWebMessage('{"type":"cursorMode","enabled":true}')).toEqual({ type: "cursorMode", enabled: true });
 });
 it("opens chat only on an explicit non-Herdr bridge result", () => {
  expect(sessionDestination(true)).toBe("terminal");
  expect(sessionDestination(false)).toBe("chat");
  expect(sessionDestination(null)).toBe("unavailable");
 });
});
