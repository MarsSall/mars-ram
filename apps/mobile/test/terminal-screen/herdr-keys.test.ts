import { describe, expect, it } from "vitest";
import { parseHerdrKeys, herdrKeyBytes, readHerdrKeys } from "../../src/core/herdr-keys";
import { tapTerminalCtrl, applyTerminalCtrl, terminalToolbarKeys } from "../../src/core/terminal-controls";

const bytes = (text: string) => new TextEncoder().encode(text);
describe("Herdr key configuration", () => {
 it("defaults absent keys and ignores other tables, comments and malformed values", () => {
  expect(parseHerdrKeys(null)).toEqual({ prefix: "ctrl+b" });
  expect(parseHerdrKeys('[other]\nprefix="ctrl+z"\n[keys]\nprefix = "ctrl+a" # hello\nprevious_agent = \'prefix+alt+k\'\nnext_agent=42\n[else]\nnext_agent="x"')).toEqual({ prefix: "ctrl+a", previous_agent: "prefix+alt+k" });
  expect(parseHerdrKeys('[keys]\nprefix="#" # comment')).toEqual({ prefix: "#" });
  expect(parseHerdrKeys('[keys]\nprefix="bad\\q"')).toEqual({ prefix: "ctrl+b" });
 });
 it("maps only understood bindings, including full prefix bindings", () => {
  for (let i = 0; i < 26; i++) expect(herdrKeyBytes(`ctrl+${String.fromCharCode(97 + i)}`)).toEqual(new Uint8Array([i + 1]));
  expect(herdrKeyBytes("prefix+alt+k", "ctrl+a")).toEqual(bytes("\x01\x1bk"));
  expect(herdrKeyBytes("shift+a")).toEqual(bytes("A"));
  expect(herdrKeyBytes("Z")).toEqual(bytes("Z"));
  for (const [key, value] of Object.entries({ esc: "\x1b", tab: "\t", enter: "\r", space: " ", backspace: "\x7f", left: "\x1b[D", f1: "\x1bOP", f12: "\x1b[24~" })) expect(herdrKeyBytes(key)).toEqual(bytes(value));
  for (const key of ["ctrl+1", "super+k", "unknown", "prefix+x", "alt+unknown", "constructor", "__proto__", "alt+".repeat(2000) + "x"]) expect(herdrKeyBytes(key)).toBeNull();
 });
 it("reads bounded home-relative paths, Windows first only for Windows, and falls back safely", async () => {
  const paths: string[] = [];
  const host = { homeDirectory: async () => ({ ok: true as const, path: "/C:/Users/test" }), readFile: async (_id: string, path: string, max: number) => { paths.push(path); expect(max).toBe(16384); return path.startsWith("AppData") ? { ok: true as const, content: '[keys]\nprefix="ctrl+a"' } : { ok: false as const, code: "SSH_ERROR" as const, message: "missing" }; } };
  expect(await readHerdrKeys(host, "connection")).toEqual({ prefix: "ctrl+a" });
  expect(paths).toEqual(["AppData/Roaming/herdr/config.toml"]);
  paths.length = 0;
  host.homeDirectory = async () => ({ ok: true as const, path: "/home/test" });
  expect(await readHerdrKeys(host, "connection")).toEqual({ prefix: "ctrl+a" });
  expect(paths).toEqual([".config/herdr/config.toml", "AppData/Roaming/herdr/config.toml"]);
  paths.length = 0;
  host.homeDirectory = async () => { throw new Error("offline"); };
  await readHerdrKeys(host, "connection");
  expect(paths).toEqual([".config/herdr/config.toml", "AppData/Roaming/herdr/config.toml"]);
  expect(await readHerdrKeys({ ...host, readFile: async () => { throw new Error("offline"); } }, "c")).toEqual({ prefix: "ctrl+b" });
 });
});
describe("thin chrome controls", () => {
 it("keeps order while changing arrows by moment, with panel taking precedence", () => {
  const row = (arrows: string[], mic = true) => ["attach", "ctrl", "prefix", "esc", "tab", "paste", ...(mic ? ["mic"] : []), ...arrows, "dpad", "keyboard"];
  expect(terminalToolbarKeys({ keyboard: false, prefixPanel: false })).toEqual(row(["up", "down"]));
  expect(terminalToolbarKeys({ keyboard: true, prefixPanel: false })).toEqual(row([]));
  expect(terminalToolbarKeys({ keyboard: true, prefixPanel: true })).toEqual(row(["up", "down", "left", "right"], false));
 });
 it("arms, double-tap locks, unlocks and consumes only one-shot Ctrl", () => {
  const armed = tapTerminalCtrl({ mode: "off", tappedAt: null }, 1000);
  expect(armed.mode).toBe("armed");
  const locked = tapTerminalCtrl(armed, 1399);
  expect(locked.mode).toBe("locked");
  expect(tapTerminalCtrl(locked, 1500).mode).toBe("off");
  expect(tapTerminalCtrl(armed, 1401).mode).toBe("off");
  expect(applyTerminalCtrl(armed, bytes("a"))).toEqual({ state: { mode: "off", tappedAt: null }, bytes: bytes("\x01") });
  expect(applyTerminalCtrl(locked, bytes("z"))).toEqual({ state: locked, bytes: bytes("\x1a") });
  expect(applyTerminalCtrl(locked, bytes("\x1b[A"))).toEqual({ state: locked, bytes: bytes("\x1b[A") });
  expect(applyTerminalCtrl(armed, bytes(""))).toEqual({ state: armed, bytes: bytes("") });
 });
});
