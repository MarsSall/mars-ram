import { describe, expect, it } from "vitest";
import { currentAppBuild, parseBuild, parseSeenBuild, RELEASE_NOTES, WhatsNew, type AppBuild, type LastSeenBuild, type ReleaseNote, type SeenBuildStore } from "../src/core/whats-new";

const note = (build: number, version = `1.0.${build}`): ReleaseNote => ({ build, version, es: { new: [`nuevo ${build}`], fixes: [] }, en: { new: [`new ${build}`], fixes: [] } });
const notes = [note(10), note(9), note(8)];
const at = (build: number | null, version: string | null = build === null ? null : `1.0.${build}`): AppBuild => ({ build, version });

function fakeStore(initial: LastSeenBuild, failWrite = false) {
 const writes: AppBuild[] = [];
 let current = initial;
 const store: SeenBuildStore = {
  read: async () => current,
  write: async seen => { if (failWrite) throw new Error("disk"); writes.push(seen); current = { kind: "seen", ...seen }; },
 };
 return { store, writes };
}
const seen = (build: number | null, version: string | null = build === null ? null : `1.0.${build}`): LastSeenBuild => ({ kind: "seen", build, version });

describe("Novedades after an update", () => {
 it("a fresh install records the build and shows nothing", async () => {
  const { store, writes } = fakeStore({ kind: "fresh" });
  expect(await new WhatsNew({ store, current: at(10), notes }).pending()).toEqual([]);
  expect(writes).toEqual([at(10)]);
  expect(await new WhatsNew({ store, current: at(10), notes }).pending()).toEqual([]);
 });

 it("shows every entry newer than the last seen build, up to this build, newest first", async () => {
  const { store, writes } = fakeStore(seen(8));
  expect((await new WhatsNew({ store, current: at(10), notes }).pending()).map(n => n.build)).toEqual([10, 9]);
  expect(writes).toEqual([]);
 });

 it("«Entendido» records this build so the screen does not come back for it", async () => {
  const { store, writes } = fakeStore(seen(9));
  const whatsNew = new WhatsNew({ store, current: at(10), notes });
  expect((await whatsNew.pending()).map(n => n.build)).toEqual([10]);
  await whatsNew.dismiss();
  expect(writes).toEqual([at(10)]);
  expect(await new WhatsNew({ store, current: at(10), notes }).pending()).toEqual([]);
 });

 it("shows nothing for the same build and never shows notes for a future build", async () => {
  expect(await new WhatsNew({ store: fakeStore(seen(10)).store, current: at(10), notes }).pending()).toEqual([]);
  expect((await new WhatsNew({ store: fakeStore(seen(8)).store, current: at(9), notes }).pending()).map(n => n.build)).toEqual([9]);
 });

 it("an update without its own entry records the build silently", async () => {
  const { store, writes } = fakeStore(seen(10));
  expect(await new WhatsNew({ store, current: at(11), notes }).pending()).toEqual([]);
  expect(writes).toEqual([at(11)]);
 });

 it("an app used before this feature (no record, but saved data) shows only this build's notes", async () => {
  expect((await new WhatsNew({ store: fakeStore({ kind: "unrecorded" }).store, current: at(10), notes }).pending()).map(n => n.build)).toEqual([10]);
  expect(await new WhatsNew({ store: fakeStore({ kind: "unrecorded" }).store, current: at(11), notes }).pending()).toEqual([]);
 });

 it("without a build number it falls back to the app version", async () => {
  const byVersion = [note(9, "1.1.0"), note(8, "1.0.0")];
  const changed = fakeStore(seen(null, "1.0.0"));
  const whatsNew = new WhatsNew({ store: changed.store, current: at(null, "1.1.0"), notes: byVersion });
  expect((await whatsNew.pending()).map(n => n.version)).toEqual(["1.1.0"]);
  await whatsNew.dismiss();
  expect(changed.writes).toEqual([at(null, "1.1.0")]);
  expect(await new WhatsNew({ store: changed.store, current: at(null, "1.1.0"), notes: byVersion }).pending()).toEqual([]);
  // A record from a build without a number is compared by version once the number is known.
  expect((await new WhatsNew({ store: fakeStore(seen(null, "1.0.0")).store, current: at(9, "1.1.0"), notes: byVersion }).pending()).map(n => n.build)).toEqual([9]);
  expect(await new WhatsNew({ store: fakeStore({ kind: "fresh" }).store, current: at(null, "1.1.0"), notes: byVersion }).pending()).toEqual([]);
 });

 it("with neither build nor version it shows nothing and stores nothing", async () => {
  const { store, writes } = fakeStore(seen(8));
  const whatsNew = new WhatsNew({ store, current: at(null, null), notes });
  expect(await whatsNew.pending()).toEqual([]);
  await whatsNew.dismiss();
  expect(writes).toEqual([]);
 });

 it("storage failures never block the app", async () => {
  const fresh = fakeStore({ kind: "fresh" }, true);
  expect(await new WhatsNew({ store: fresh.store, current: at(10), notes }).pending()).toEqual([]);
  const failing = fakeStore(seen(9), true);
  const whatsNew = new WhatsNew({ store: failing.store, current: at(10), notes });
  expect((await whatsNew.pending()).map(n => n.build)).toEqual([10]);
  await expect(whatsNew.dismiss()).resolves.toBeUndefined();
  const broken: SeenBuildStore = { read: async () => { throw new Error("disk"); }, write: async () => {} };
  expect(await new WhatsNew({ store: broken, current: at(10), notes }).pending()).toEqual([]);
 });

 it("lists every bundled entry newest first for Ajustes", () => {
  expect(new WhatsNew({ store: fakeStore({ kind: "fresh" }).store, current: at(10), notes: [note(8), note(10), note(9)] }).all().map(n => n.build)).toEqual([10, 9, 8]);
 });
});

describe("the app's build", () => {
 it("prefers the Android versionCode read natively", () => {
  expect(currentAppBuild({ versionCode: 8, versionName: "1.0.0" }, { nativeBuildVersion: "", nativeApplicationVersion: null })).toEqual({ build: 8, version: "1.0.0" });
 });
 it("falls back to the Expo build number, then to the app version when the build is empty", () => {
  expect(currentAppBuild(null, { nativeBuildVersion: "7", nativeApplicationVersion: "1.0.0" })).toEqual({ build: 7, version: "1.0.0" });
  expect(currentAppBuild({ versionCode: null, versionName: null }, { nativeBuildVersion: "", nativeApplicationVersion: "1.0.0" })).toEqual({ build: null, version: "1.0.0" });
  expect(currentAppBuild(null, { nativeBuildVersion: null, nativeApplicationVersion: "" })).toEqual({ build: null, version: null });
 });
 it("parses only positive integer build numbers", () => {
  expect(parseBuild("8")).toBe(8);
  expect(parseBuild(8)).toBe(8);
  for (const raw of [null, undefined, "", "abc", "0", "-1", "1.5", 0, Number.NaN]) expect(parseBuild(raw)).toBeNull();
 });
});

describe("the stored record", () => {
 it("keeps only a valid build and version, and rejects text that is not JSON", () => {
  expect(parseSeenBuild(JSON.stringify({ version: 1, build: 8, appVersion: "1.0.0" }))).toEqual({ build: 8, version: "1.0.0" });
  expect(parseSeenBuild(JSON.stringify({ version: 1, build: "8", appVersion: " " }))).toEqual({ build: null, version: null });
  expect(parseSeenBuild("null")).toEqual({ build: null, version: null });
  expect(() => parseSeenBuild("{")).toThrow();
 });
});

describe("bundled changelog", () => {
 it("has unique builds and matching, non-empty Spanish and English lists", () => {
  expect(new Set(RELEASE_NOTES.map(n => n.build)).size).toBe(RELEASE_NOTES.length);
  for (const entry of RELEASE_NOTES) {
   expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
   expect(entry.es.new.length + entry.es.fixes.length).toBeGreaterThan(0);
   expect(entry.es.new).toHaveLength(entry.en.new.length);
   expect(entry.es.fixes).toHaveLength(entry.en.fixes.length);
   for (const line of [...entry.es.new, ...entry.es.fixes, ...entry.en.new, ...entry.en.fixes]) expect(line.trim().length).toBeGreaterThan(0);
  }
 });

 it("the first entry describes this batch in plain words", () => {
  const first = RELEASE_NOTES.find(n => n.build === 8)!;
  expect(first).toBeDefined();
  const es = [...first.es.new, ...first.es.fixes].join("\n");
  const en = [...first.en.new, ...first.en.fixes].join("\n");
  for (const text of [es, en]) {
   expect(text).toContain("/reload");
   expect(text).toContain("Herdr");
   expect(text).toContain("Gentle Shell");
   expect(text).toContain("«?»");
   expect(text).not.toMatch(/SSH|SFTP|bridge|protocol|PTY|foreground service/i);
  }
  for (const mode of ["Apagado", "Mientras trabajan", "Siempre atento"]) expect(es).toContain(mode);
  for (const mode of ["Off", "While working", "Always attentive"]) expect(en).toContain(mode);
  expect(first.es.fixes).toHaveLength(2);
  expect(first.en.fixes).toHaveLength(2);
 });

 it("build 9 names ZeroTier and the mars-ram 0.1.5 it needs, in plain words", () => {
  const note = RELEASE_NOTES.find(n => n.build === 9)!;
  expect(note).toBeDefined();
  for (const side of [note.es, note.en]) {
   const text = [...side.new, ...side.fixes].join("\n");
   for (const word of ["ZeroTier", "Tailscale", "mars-ram 0.1.5", "Mac"]) expect(text).toContain(word);
   expect(text).not.toMatch(/SSH|SFTP|bridge|protocol|PTY|DownloadManager|uploads-dir|pair-zt/i);
   expect(side.new).toHaveLength(3);
   expect(side.fixes).toHaveLength(5);
  }
 });

 it("build 10 names the custom keys, ZeroTier links and the mars-ram 0.1.6 it needs, in plain words", () => {
  const note = RELEASE_NOTES.find(n => n.build === 10)!;
  expect(note).toBeDefined();
  for (const side of [note.es, note.en]) {
   const text = [...side.new, ...side.fixes].join("\n");
   for (const word of ["ZeroTier", "D-pad", "Enter", ".env", "mars-ram 0.1.6"]) expect(text).toContain(word);
   expect(text).not.toMatch(/SSH|SFTP|bridge|protocol|PTY|stage-link|--network|notify register/i);
   expect(side.new).toHaveLength(3);
   expect(side.fixes).toHaveLength(1);
  }
  expect(note.es.new.join("\n")).toContain("Mostrar");
  expect(note.en.new.join("\n")).toContain("Show");
 });

 it("build 11 names the tour, Abrir terminal, the smaller QR and mars-ram update of 0.1.7, in plain words", () => {
  const note = RELEASE_NOTES.find(n => n.build === 11)!;
  expect(note).toBeDefined();
  for (const side of [note.es, note.en]) {
   const text = [...side.new, ...side.fixes].join("\n");
   for (const word of ["QR", "mars-ram 0.1.7", "mars-ram update", "Tailscale", "ZeroTier"]) expect(text).toContain(word);
   expect(text).not.toMatch(/SSH|SFTP|bridge|protocol|PTY|\bIME\b|base64|\bv3\b|JSON|--network|pair-zt/i);
   expect(side.new).toHaveLength(4);
   expect(side.fixes).toHaveLength(2);
  }
  expect(note.es.new.join("\n")).toContain("«Abrir terminal»");
  expect(note.es.new.join("\n")).toContain("«Ver tutorial»");
  expect(note.en.new.join("\n")).toContain("«Open terminal»");
  expect(note.en.new.join("\n")).toContain("«Show tutorial»");
 });

 it("build 12 names the link confirmation, Herdr's other machines, mars-ram 0.1.8 and the network choice, in plain words", () => {
  const note = RELEASE_NOTES.find(n => n.build === 12)!;
  expect(note).toBeDefined();
  for (const side of [note.es, note.en]) {
   const text = [...side.new, ...side.fixes].join("\n");
   for (const word of ["Herdr", "mars-ram 0.1.8", "mars-ram update", "mars-ram doctor", "mars-ram pair", "Windows", "Tailscale", "ZeroTier"]) expect(text).toContain(word);
   expect(text).not.toMatch(/SSH|SFTP|bridge|protocol|PTY|deep link|herdr machine|JSON|versionCode|recomendado|recommended/i);
   expect(side.new).toHaveLength(3);
   expect(side.fixes).toHaveLength(2);
  }
  expect(note.es.new[0]).toMatch(/^Parche de seguridad: /);
  expect(note.en.new[0]).toMatch(/^Security fix: /);
  expect(note.es.new.join("\n")).toContain("«¿Abrir la terminal?»");
  expect(note.es.new.join("\n")).toContain("«Este Herdr también muestra: …»");
  expect(note.en.new.join("\n")).toContain("«Open the terminal?»");
  expect(note.en.new.join("\n")).toContain("«This Herdr also shows: …»");
 });

 it("build 13 tells the first testers about the easter eggs and how to open them, without naming anyone or mentioning themes", () => {
  const note = RELEASE_NOTES.find(n => n.build === 13)!;
  expect(note).toBeDefined();
  const es = [...note.es.new, ...note.es.fixes].join("\n");
  const en = [...note.en.new, ...note.en.fixes].join("\n");
  for (const word of ["primeros testers", "easter eggs", "Ajustes", "tocá varias veces", "versión", "código"]) expect(es).toContain(word);
  for (const word of ["first testers", "easter eggs", "Settings", "tap", "version", "code"]) expect(en).toContain(word);
  // The surprise stays a surprise: no names and no word about themes.
  for (const text of [es, en]) expect(text).not.toMatch(/cinlo|j0k3r|batmad|bojack|neko|tema|theme|SSH|JSON|versionCode/i);
  expect(note.es.new).toHaveLength(note.en.new.length);
 });

 it("build 13 says Home shows each session's running subagents, needing mars-ram 0.1.9 and Gentle Shell", () => {
  const note = RELEASE_NOTES.find(n => n.build === 13)!;
  const es = [...note.es.new, ...note.es.fixes].join("\n");
  const en = [...note.en.new, ...note.en.fixes].join("\n");
  for (const word of ["Inicio", "subagentes", "mars-ram 0.1.9", "Gentle Shell"]) expect(es).toContain(word);
  for (const word of ["Home", "subagents", "mars-ram 0.1.9", "Gentle Shell"]) expect(en).toContain(word);
  for (const text of [es, en]) expect(text).not.toMatch(/cinlo|j0k3r|batmad|bojack|neko|tema|theme|SSH|JSON|versionCode/i);
  expect(note.es.new).toHaveLength(2);
  expect(note.es.new).toHaveLength(note.en.new.length);
 });

 it("build 15 names Claude Code and Codex (experimental, with mars-ram 0.2.0), the hideable key bar and the paste and Enter fixes", () => {
  const note = RELEASE_NOTES.find(n => n.build === 15)!;
  expect(note).toBeDefined();
  expect(RELEASE_NOTES[0]).toBe(note);
  const es = [...note.es.new, ...note.es.fixes].join("\n");
  const en = [...note.en.new, ...note.en.fixes].join("\n");
  for (const word of ["Claude Code", "Codex", "experimental", "mars-ram 0.2.0", "mars-ram install", "Personalizar teclas", "Siempre visible", "Autodesplegable", "Con un toque", "pegar", "Enter"]) expect(es).toContain(word);
  for (const word of ["Claude Code", "Codex", "experimental", "mars-ram 0.2.0", "mars-ram install", "Customize keys", "Always visible", "Auto-hide", "One tap", "paste", "Enter"]) expect(en).toContain(word);
  for (const text of [es, en]) expect(text).not.toMatch(/\btemas?\b|\bthemes?\b|easter|regal|gift|cinlo|j0k3r|batmad|bojack|marvin|ramons|\bOTA\b/i);
  expect(note.es.new).toHaveLength(2);
  expect(note.es.fixes).toHaveLength(2);
  expect(note.es.new).toHaveLength(note.en.new.length);
  expect(note.es.fixes).toHaveLength(note.en.fixes.length);
 });

 it("build 14 names Agentes first, workspace cards, Home subagents in Personalización, Más ajustes and the Windows fix of mars-ram 0.1.10, without the surprises", () => {
  const note = RELEASE_NOTES.find(n => n.build === 14)!;
  expect(note).toBeDefined();
  expect(RELEASE_NOTES[1]).toBe(note);
  const es = [...note.es.new, ...note.es.fixes].join("\n");
  const en = [...note.en.new, ...note.en.fixes].join("\n");
  for (const word of ["Agentes", "Espacios", "Personalización", "Más ajustes", "Windows", "mars-ram 0.1.10"]) expect(es).toContain(word);
  for (const word of ["Agents", "Workspaces", "Personalization", "More settings", "Windows", "mars-ram 0.1.10"]) expect(en).toContain(word);
  // Let them discover the rest on their own: no themes, easter eggs or gifts.
  for (const text of [es, en]) expect(text).not.toMatch(/\btemas?\b|\bthemes?\b|easter|regal|gift|cinlo|j0k3r|batmad|bojack|marvin|ramons/i);
  expect(note.es.new).toHaveLength(3);
  expect(note.es.fixes).toHaveLength(1);
  expect(note.es.new).toHaveLength(note.en.new.length);
  expect(note.es.fixes).toHaveLength(note.en.fixes.length);
 });
});
