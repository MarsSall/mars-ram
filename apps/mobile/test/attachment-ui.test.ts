import { describe, expect, it } from "vitest";
import { DraftStore } from "../src/core/composer-drafts";
import { parseRetention } from "../src/core/retention-preference";
import { attachmentError, withheldNotice } from "../src/ui/attachment-messages";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";
import { UPDATE_REQUIRED_MESSAGE } from "../src/core/uploads-folder";

const image = { id: "a", sourceUri: "file:///a.png", displayName: "a.png", size: 10, mimeType: "image/png", kind: "image" as const };
describe("composer drafts", () => {
 it("notifies remounted composers, locks concurrent sends, and never clears newer edits", () => {
  const store = new DraftStore();
  let notifications = 0;
  const stop = store.subscribe("s", () => notifications++);
  const sent = { text: "first", attachments: [image] };
  store.set("s", sent);
  expect(store.beginSend("s")).toBe(true);
  expect(store.isSending("s")).toBe(true);
  expect(store.beginSend("s")).toBe(false);
  store.set("s", { text: "newer", attachments: [image] });
  store.clearIfUnchanged("s", sent);
  expect(store.get("s").text).toBe("newer");
  store.endSend("s");
  expect(store.isSending("s")).toBe(false);
  const current = store.get("s");
  store.clearIfUnchanged("s", current);
  expect(store.get("s").attachments).toEqual([]);
  expect(notifications).toBe(5);
  stop();
  store.set("s", sent);
  expect(notifications).toBe(5);
 });
 it("keeps text and attachments across visits and reconnects, isolated by session and composer", () => {
  const store = new DraftStore();
  store.set("chat:s", { text: "look", attachments: [image] });
  expect(store.get("chat:s")).toEqual({ text: "look", attachments: [image] });
  expect(store.get("terminal:s")).toEqual({ text: "", attachments: [] });
  expect(store.get("chat:other")).toEqual({ text: "", attachments: [] });
  store.clear("chat:s");
  expect(store.get("chat:s")).toEqual({ text: "", attachments: [] });
 });
});
describe("retention preference", () => {
 it.each([1, 7, 30, "never"] as const)("reads persisted %s", value => expect(parseRetention(JSON.stringify(value))).toBe(value));
 it.each([null, "bad", '"7"', "0", "null", "{}"])("defaults safely for %s", raw => expect(parseRetention(raw)).toBe(7));
});
describe("attachment language", () => {
 it("maps known core errors without leaking English and falls back safely", () => {
  expect(attachmentError("informe.pdf is over 25 MB. Choose a smaller file.", es.attachments)).toBe("informe.pdf pesa más de 25 MB. Elegí uno más chico.");
  expect(attachmentError("Attach at most 10 files.", es.attachments)).toBe(es.attachments.tooMany);
  expect(attachmentError("Please update Mars-RAM on the computer to send attachments.", es.attachments)).toBe("Actualizá Mars-RAM en la computadora para enviar adjuntos.");
  expect(attachmentError("a.png could not be read. Please select it again.", es.attachments)).toBe(es.attachments.unreadable("a.png"));
  expect(attachmentError("Connection reset", es.attachments)).toBe(es.attachments.sendFailed);
  expect(attachmentError("Connection reset", en.attachments)).toBe(en.attachments.sendFailed);
 });
 it("asks to update both sides and shows the host's folder refusal", () => {
  expect(attachmentError(UPDATE_REQUIRED_MESSAGE, es.attachments)).toBe("Actualizá la app y mars-ram para mandar archivos.");
  expect(attachmentError(UPDATE_REQUIRED_MESSAGE, en.attachments)).toBe("Update the app and mars-ram to send files.");
  expect(attachmentError("Uploads folder refused: /tmp/mars-ram-1000 is a link.", es.attachments)).toBe("La computadora rechazó la carpeta de adjuntos: /tmp/mars-ram-1000 is a link.");
  expect(attachmentError("Uploads folder refused: /tmp/mars-ram-1000 is a link.", en.attachments)).toBe("The computer refused the attachments folder: /tmp/mars-ram-1000 is a link.");
  expect(attachmentError("Uploads folder unavailable: No temp.", es.attachments)).toBe("La carpeta de adjuntos de la computadora no está disponible: No temp.");
 });
 it("describes the private temporary folder, not the home folder", () => {
  for (const t of [es, en]) {
   expect(t.attachments.location).not.toContain("~/.mars-ram/uploads");
   expect(t.attachments.location).toMatch(/tempor/i);
  }
 });
 it("only claims images were withheld when confirmed", () => {
  expect(withheldNotice("model", es.attachments)).toBe("Este modelo no acepta imágenes: el agente recibió solo la ruta del archivo.");
  expect(withheldNotice("blocked", es.attachments)).toBe(es.attachments.blocked);
  expect(withheldNotice("none", es.attachments)).toBeNull();
  expect(withheldNotice(undefined, en.attachments)).toBeNull();
 });
});
