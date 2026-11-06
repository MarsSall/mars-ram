import { describe, expect, it } from "vitest";
import { installCommands } from "../src/core/install-command";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

describe("install commands", () => {
 it("recommends the pnpm global install, the same on every system", () => {
  expect(installCommands.recommended).toBe("pnpm add -g mars-ram");
 });
 it("offers the npm global install as the alternative", () => {
  expect(installCommands.npm).toBe("npm i -g mars-ram");
 });
});

describe("welcome install step texts", () => {
 it("says where and how to run the command in Spanish", () => {
  expect(es.home.install).toBe("En tu computadora, abrí una terminal y ejecutá:");
  expect(es.home.recommended).toBe("Recomendado");
  expect(es.home.usingNpm).toBe("¿Usás npm?");
  expect(es.home.run).toBe("Ejecutá");
  expect(es.home.scanStep).toBe("Escaneá el código");
  expect(es.home.copy).toBe("Copiar");
  expect(es.home.copied).toBe("Copiado");
  expect(es.home.copyCommand).toBe("Copiar el comando");
  expect(es.home.copyFailed).toBe("No se pudo copiar. Probá de nuevo.");
 });
 it("says where and how to run the command in English", () => {
  expect(en.home.install).toBe("On your computer, open a terminal and run:");
  expect(en.home.recommended).toBe("Recommended");
  expect(en.home.usingNpm).toBe("Using npm?");
  expect(en.home.run).toBe("Run");
  expect(en.home.scanStep).toBe("Scan the code");
  expect(en.home.copy).toBe("Copy");
  expect(en.home.copied).toBe("Copied");
  expect(en.home.copyCommand).toBe("Copy the command");
  expect(en.home.copyFailed).toBe("Could not copy. Try again.");
 });
 it("no longer offers a per-system choice", () => {
  for (const t of [en, es]) expect(t.home).not.toHaveProperty("systemUnix");
 });
});
