import { describe, expect, it } from "vitest";
import { installCommand } from "../src/core/install-command";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

describe("install command", () => {
 it("pipes the Pages install script to sh on Linux and Mac", () => {
  expect(installCommand("unix")).toBe("curl -fsSL https://marssall.github.io/mars-ram/install.sh | sh");
 });
 it("runs the Pages install script through PowerShell on Windows", () => {
  expect(installCommand("windows")).toBe('powershell -ExecutionPolicy Bypass -c "irm https://marssall.github.io/mars-ram/install.ps1 | iex"');
 });
});

describe("welcome install step texts", () => {
 it("says where and how to run the command in Spanish", () => {
  expect(es.home.install).toBe("En tu computadora, abrí una terminal y ejecutá:");
  expect(es.home.systemUnix).toBe("Linux / Mac");
  expect(es.home.systemWindows).toBe("Windows");
  expect(es.home.copy).toBe("Copiar");
  expect(es.home.copied).toBe("Copiado");
  expect(es.home.copyCommand).toBe("Copiar el comando");
  expect(es.home.copyFailed).toBe("No se pudo copiar. Probá de nuevo.");
 });
 it("says where and how to run the command in English", () => {
  expect(en.home.install).toBe("On your computer, open a terminal and run:");
  expect(en.home.systemUnix).toBe("Linux / Mac");
  expect(en.home.systemWindows).toBe("Windows");
  expect(en.home.copy).toBe("Copy");
  expect(en.home.copied).toBe("Copied");
  expect(en.home.copyCommand).toBe("Copy the command");
  expect(en.home.copyFailed).toBe("Could not copy. Try again.");
 });
});
