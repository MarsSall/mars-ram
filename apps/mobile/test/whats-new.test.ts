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
});
