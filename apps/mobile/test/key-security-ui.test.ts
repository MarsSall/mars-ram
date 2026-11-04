import { describe, expect, it } from "vitest";
import { acceptSecurityStatus, beginSecurityChange, finishSecurityChange, securityErrorKey, securityRow, type SecurityViewState } from "../src/ui/key-security";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

describe("key security status", () => {
 const done = { requireUnlock: true, perComputer: [{ hostId: "computer", name: "Computer", phase: "done" as const }] };
 const initial: SecurityViewState = { generation: 0, changing: false, status: done };
 it("immediately replaces previous done and error rows with changing", () => {
  const state = beginSecurityChange({ ...initial, status: { ...done, perComputer: [
   ...done.perComputer,
   { hostId: "offline", name: "Offline", phase: "pending", lastError: { code: "TIMEOUT", message: "Offline" } },
  ] } });
  expect(state.generation).toBe(1);
  expect(state.status?.perComputer.map(securityRow)).toEqual([
   { textKey: "changing", retry: false }, { textKey: "changing", retry: false },
  ]);
  expect(es.keySecurity.changing).toBe("Cambiando la clave…");
  expect(initial.status).toEqual(done);
 });
 it("ignores pre-change status even when it resolves after completion", () => {
  const changing = beginSecurityChange(initial);
  expect(acceptSecurityStatus(changing, initial.generation, done)).toBe(changing);
  expect(acceptSecurityStatus(changing, changing.generation, done)).toBe(changing);
  const completed = finishSecurityChange(changing);
  expect(acceptSecurityStatus(completed, initial.generation, done)).toBe(completed);
  expect(completed.status?.perComputer.map(securityRow)[0].textKey).toBe("changing");
 });
 it("shows Lista only from fresh status after completion", () => {
  const completed = finishSecurityChange(beginSecurityChange(initial));
  const fresh = acceptSecurityStatus(completed, completed.generation, done);
  expect(fresh.status?.perComputer.map(securityRow)[0].textKey).toBe("done");
  expect(es.keySecurity.done).toBe("Lista");
  const next = beginSecurityChange(fresh);
  expect(acceptSecurityStatus(next, completed.generation, done)).toBe(next);
 });
 it("only reports ready for core-confirmed done", () => {
  expect(securityRow({ phase: "done" })).toEqual({ textKey: "done", retry: false });
  expect(securityRow({ phase: "pending" }).textKey).toBe("pending");
  for (const phase of ["added", "verified"] as const) expect(securityRow({ phase }).textKey).toBe("changing");
 });
 it.each(["UNREACHABLE", "TIMEOUT", "HOST_NOT_FOUND"])("explains offline %s as pending", code => {
  expect(securityRow({ phase: "pending", lastError: { code } })).toEqual({ textKey: "pending", retry: true });
 });
 it.each([
  ["KEY_ROTATION_NOT_INSTALLED", "updateHost"],
  ["HOST_KEY_CHANGED", "authorizationFailed"],
  ["AUTH_FAILED", "authorizationFailed"],
  ["KEY_ROTATION_FAILED", "authorizationFailed"],
  ["CREDENTIAL_METADATA_DAMAGED", "metadataDamaged"],
  ["UNLOCK_REQUIRED", "unlockRequired"],
  ["KEY_INVALIDATED", "keyInvalidated"],
  ["unexpected", "failed"],
 ] as const)("maps %s to safe localized text without raw errors", (code, textKey) => {
  expect(securityRow({ phase: "verified", lastError: { code } })).toEqual({ textKey, retry: true });
  expect(en.keySecurity[textKey]).toBeTruthy();
  expect(es.keySecurity[textKey]).toBeTruthy();
 });
 it("does not hide a reported error behind done", () => {
  expect(securityRow({ phase: "done", lastError: { code: "CREDENTIAL_METADATA_DAMAGED" } }).textKey).toBe("metadataDamaged");
 });
 it("explains a refused toggle and metadata failure", () => {
  expect(securityErrorKey({ code: "ROTATION_PENDING" })).toBe("rotationPending");
  expect(securityErrorKey({ code: "CREDENTIAL_METADATA_DAMAGED" })).toBe("metadataDamaged");
  expect(securityErrorKey(new Error("private path"))).toBe("failed");
 });
 it("preserves the approved Spanish warning and remediation", () => {
  expect(es.keySecurity.warning).toBe("Sin huella, cualquiera que tenga tu teléfono desbloqueado puede abrir sesiones en tus computadoras.");
  expect(es.keySecurity.rotationNotice).toBe("La app va a crear una clave nueva y autorizarla sola en cada computadora; no hace falta parear de nuevo.");
  expect(es.keySecurity.updateHost).toBe("Actualizá Mars-RAM en esta computadora (mars-ram install)");
  expect(es.keySecurity.metadataDamaged).toBe("Los datos de las claves están dañados: no se borró ninguna clave");
 });
});
