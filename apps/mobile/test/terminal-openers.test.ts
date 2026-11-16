import { describe, expect, it, vi } from "vitest";
import { HostConnections } from "../src/core/host-connections";
import type { HostConnection } from "../src/core/ports";
import { TERMINAL_ROUTE, TerminalOpenerHost, openerInitialStep, terminalOpeners } from "../src/core/terminal-openers";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";
import { FakeSsh, failure, savedHost } from "./fakes";

const record = (value: unknown) => ({ record: value as Record<string, unknown> | null });
const opener = (id: string) => terminalOpeners.find(o => o.id === id)!;
function setup() {
 const host = new FakeSsh();
 const connections = new HostConnections({ host: host as unknown as HostConnection, keyAlias: "key", unlock: async () => false });
 return { host, openers: new TerminalOpenerHost({ host: host as unknown as HostConnection, connections }) };
}

describe("terminal openers", () => {
 it("lists Herdr first, then the plain terminal, as data", () => {
  expect(terminalOpeners.map(o => o.id)).toEqual(["herdr", "shell"]);
 });
 it("opens Herdr exactly like «Abrir Herdr» and the plain terminal as a standalone shell", () => {
  const computer = { id: "one", name: "Desk" };
  expect(TERMINAL_ROUTE).toBe("/session/terminal/[id]");
  expect(opener("herdr").params(computer)).toEqual({ id: "one", standalone: "1", computer: "Desk" });
  expect(opener("shell").params(computer)).toEqual({ id: "one", standalone: "1", computer: "Desk", shell: "1" });
 });
 it("marks Herdr unavailable only when the installer recorded no Herdr", () => {
  const herdr = opener("herdr");
  expect(herdr.check(record({ node: "/usr/bin/node", herdr: "/home/dev/.local/bin/herdr" }))).toEqual({ available: true });
  expect(herdr.check(record({ node: "C:\\node\\node.exe", herdr: "C:\\Program Files\\Herdr\\herdr.exe" }))).toEqual({ available: true });
  expect(herdr.check(record({ node: "/usr/bin/node" }))).toEqual({ available: false, reason: "herdrMissing" });
  expect(herdr.check(record({ node: "/usr/bin/node", herdr: "/bin/bash" }))).toEqual({ available: false, reason: "herdrMissing" });
  // Unknown (no or damaged record): offered, and the terminal reports a missing Herdr like «Abrir Herdr».
  expect(herdr.check(record(null))).toEqual({ available: true });
  expect(herdr.check(record({}))).toEqual({ available: true });
 });
 it("always offers the plain terminal: every SSH server has a login shell", () => {
  for (const value of [null, {}, { node: "/usr/bin/node" }]) expect(opener("shell").check(record(value))).toEqual({ available: true });
 });
 it("skips the computer choice when only one computer is saved, like «Agregar atajo»", () => {
  expect(openerInitialStep(1)).toBe("opener");
  expect(openerInitialStep(0)).toBe("computer");
  expect(openerInitialStep(2)).toBe("computer");
 });
});

describe("terminal opener host", () => {
 it("reads the bounded host record once and reports every opener's availability", async () => {
  const { host, openers } = setup();
  host.readFile = vi.fn(async () => ({ ok: true as const, content: JSON.stringify({ node: "/usr/bin/node" }) }));
  expect(await openers.check(savedHost("one"))).toEqual({ ok: true, openers: [
   { id: "herdr", availability: { available: false, reason: "herdrMissing" } },
   { id: "shell", availability: { available: true } },
  ] });
  expect(host.readFile).toHaveBeenCalledTimes(1);
  expect(host.readFile).toHaveBeenCalledWith(expect.any(String), ".mars-ram/host.json", 4096);
 });
 it("offers everything when the record cannot be read", async () => {
  const { openers } = setup();
  const result = await openers.check(savedHost("one"));
  expect(result).toEqual({ ok: true, openers: [{ id: "herdr", availability: { available: true } }, { id: "shell", availability: { available: true } }] });
 });
 it("returns the connection failure code instead of a list", async () => {
  const { host, openers } = setup(); host.locked = true;
  expect(await openers.check(savedHost("one"))).toEqual({ ok: false, code: "UNLOCK_REQUIRED" });
  const other = setup(); other.host.refuse = failure("UNREACHABLE");
  other.host.connect = async () => failure("UNREACHABLE");
  expect(await other.openers.check(savedHost("one"))).toEqual({ ok: false, code: "UNREACHABLE" });
 });
 it("never throws: an unexpected port error becomes FAILED", async () => {
  const { host, openers } = setup();
  host.connect = async () => { throw new Error("boom"); };
  expect(await openers.check(savedHost("one"))).toEqual({ ok: false, code: "FAILED" });
 });
});

describe("terminal opener copy", () => {
 it("has es (Rioplatense) and en copy for the button, steps, openers and reasons", () => {
  expect(es.openers.button).toBe("Abrir terminal");
  expect(en.openers.button).toBe("Open terminal");
  expect(es.openers.names).toEqual({ herdr: "Herdr", shell: "Terminal" });
  expect(en.openers.names).toEqual({ herdr: "Herdr", shell: "Terminal" });
  expect(es.openers.descriptions.shell).toContain("carpeta personal");
  expect(en.openers.descriptions.shell).toContain("home folder");
  expect(es.openers.herdrMissing("Desk")).toContain("Desk");
  expect(en.openers.herdrMissing("Desk")).toContain("Desk");
  expect(es.openers.chooseOpener).toBe("¿Qué abrís?");
  for (const t of [es, en]) for (const id of terminalOpeners.map(o => o.id)) {
   expect(t.openers.names[id]).toBeTruthy(); expect(t.openers.descriptions[id]).toBeTruthy();
  }
  expect(es.terminal.shellExit).toBeTruthy(); expect(en.terminal.shellDisconnected).toBeTruthy();
 });
});
