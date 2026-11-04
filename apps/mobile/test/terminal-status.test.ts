import { describe, expect, it } from "vitest";
import { terminalActivityStatus } from "../src/ui/terminal-status";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

const conversation = { running: true, prompt: null, activity: "exploring" };
describe("terminal activity status", () => {
 it("requires a live bridge and an open session terminal", () => {
  for (const phase of ["connecting", "reconnecting", "ended"] as const) {
   expect(terminalActivityStatus(true, { phase, conversation }, es.terminal.activity)).toBeNull();
  }
  expect(terminalActivityStatus(false, { phase: "live", conversation }, es.terminal.activity)).toBeNull();
  expect(terminalActivityStatus(true, null, es.terminal.activity)).toBeNull();
  expect(terminalActivityStatus(true, { phase: "live", conversation: null }, es.terminal.activity)).toBeNull();
 });
 it("localizes every phase and falls back safely for absent or unknown ids", () => {
  for (const strings of [es.terminal.activity, en.terminal.activity]) {
   for (const [activity, label] of Object.entries(strings.phases)) {
    expect(terminalActivityStatus(true, { phase: "live", conversation: { ...conversation, activity } }, strings)).toEqual({ kind: "working", text: label + "…", announcement: strings.working + ": " + label });
   }
   for (const activity of [null, "future-phase", "toString", "__proto__"]) {
    expect(terminalActivityStatus(true, { phase: "live", conversation: { ...conversation, activity } }, strings)?.text).toBe(strings.fallback + "…");
   }
  }
 });
 it("prioritizes a waiting prompt over idle, otherwise reports done", () => {
  const view = { phase: "live" as const, conversation: { ...conversation, running: false, prompt: { kind: "confirm" as const } } };
  expect(terminalActivityStatus(true, view, es.terminal.activity)).toEqual({ kind: "attention", text: "esperando tu respuesta", announcement: "Bloqueado: esperando tu respuesta" });
  expect(terminalActivityStatus(true, { ...view, conversation: { ...view.conversation, prompt: null } }, es.terminal.activity)).toEqual({ kind: "done", text: "listo", announcement: "Terminado" });
 });
});
