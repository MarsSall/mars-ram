import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SecretFilesPreference, hideSecrets, isSecretFileName, isSecretPath, type SecretFilesStore } from "../src/core/secret-files";

class FakeSecretFilesStore implements SecretFilesStore {
 writes: string[] = []; fail = false;
 constructor(public stored: string | null = null, private readonly broken = false) {}
 read() { if (this.broken) throw new Error("unreadable"); return this.stored; }
 write(text: string) {
  this.writes.push(text);
  if (this.fail) return Promise.reject(new Error("disk full"));
  this.stored = text; return Promise.resolve();
 }
}

const secrets = [".env", ".env.local", ".env.production", ".env.development.local", "server.pem", "tls.key", "cert.p12", "cert.pfx", "release.jks", "upload.keystore",
 "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", "id_ecdsa_sk", "id_ed25519_sk", ".netrc", ".npmrc", ".pgpass"];
const safe = [".env.example", ".env.sample", ".env.template", ".env.dist", ".env.local.example", ".environment", "id_rsa.pub", "id_ed25519_sk.pub", "id_utils.ts", "id_rsa_backup.txt",
 "key.ts", "monkey", "pem", "README.md", "env", ".envrc", "npmrc", "keys.json", "pem.ts"];

describe("secret file names", () => {
 it.each(secrets)("hides %s", name => {
  expect(isSecretFileName(name)).toBe(true);
  expect(isSecretFileName(name.toUpperCase())).toBe(true);
 });
 it.each(safe)("shows %s", name => {
  expect(isSecretFileName(name)).toBe(false);
  expect(isSecretFileName(name.toUpperCase())).toBe(false);
 });
 it("judges a path by its last segment only", () => {
  expect(isSecretPath("apps/api/.env")).toBe(true);
  expect(isSecretPath("deploy/certs/server.PEM")).toBe(true);
  expect(isSecretPath(".ssh/id_ed25519")).toBe(true);
  expect(isSecretPath(".env/readme.md")).toBe(false);
  expect(isSecretPath("keys.pem/notes.txt")).toBe(false);
  expect(isSecretPath("src/id_utils.ts")).toBe(false);
 });
});

describe("hiding secret files from a list", () => {
 const changes = [{ path: "src/app.ts" }, { path: "apps/api/.env" }, { path: "README.md" }, { path: "certs/tls.key" }, { path: ".env.example" }];
 it("removes secret files and counts them when hiding is on", () => {
  const { shown, hidden } = hideSecrets(changes, ch => ch.path, true);
  expect(shown.map(ch => ch.path)).toEqual(["src/app.ts", "README.md", ".env.example"]);
  expect(hidden).toBe(2);
 });
 it("shows everything when hiding is off", () => {
  const { shown, hidden } = hideSecrets(changes, ch => ch.path, false);
  expect(shown).toEqual(changes); expect(hidden).toBe(0);
 });
 it("never hides items without a path (folders)", () => {
  const entries = [{ name: ".env", kind: "dir" }, { name: ".env", kind: "file" }, { name: "id_rsa", kind: "link" }, { name: "a.pem", kind: "other" }];
  const { shown, hidden } = hideSecrets(entries, e => e.kind === "dir" ? null : `deep/${e.name}`, true);
  expect(shown).toEqual([{ name: ".env", kind: "dir" }]); expect(hidden).toBe(3);
 });
 it("builds diff previous/next lists without hidden files", () => {
  const list = hideSecrets(changes, ch => ch.path, true).shown.map(ch => ch.path);
  expect(list).not.toContain("apps/api/.env"); expect(list).not.toContain("certs/tls.key"); expect(list).toHaveLength(3);
 });
});

describe("hide secret files preference", () => {
 it("is on by default", () => {
  expect(new SecretFilesPreference(new FakeSecretFilesStore()).get()).toBe(true);
 });
 it("is off only when stored false", () => {
  expect(new SecretFilesPreference(new FakeSecretFilesStore("false")).get()).toBe(false);
  expect(new SecretFilesPreference(new FakeSecretFilesStore("true")).get()).toBe(true);
 });
 it.each(["", "nope", "0", "null", "\"false\"", "{}"])("stays on for stored %j", raw => {
  expect(new SecretFilesPreference(new FakeSecretFilesStore(raw)).get()).toBe(true);
 });
 it("stays on when the store cannot be read", () => {
  expect(new SecretFilesPreference(new FakeSecretFilesStore("false", true)).get()).toBe(true);
 });
 it("saves a change as JSON and notifies listeners", async () => {
  const store = new FakeSecretFilesStore(); const pref = new SecretFilesPreference(store);
  const seen: boolean[] = []; const off = pref.subscribe(value => seen.push(value));
  await pref.set(false);
  expect(pref.get()).toBe(false); expect(store.stored).toBe("false"); expect(seen).toEqual([false]);
  off(); await pref.set(true); expect(seen).toEqual([false]); expect(store.writes).toEqual(["false", "true"]);
 });
 it("does not write the same value again", async () => {
  const store = new FakeSecretFilesStore(); const pref = new SecretFilesPreference(store);
  const seen: boolean[] = []; pref.subscribe(value => seen.push(value));
  await pref.set(true);
  expect(store.writes).toEqual([]); expect(seen).toEqual([]);
 });
 it("restores the previous value, notifies, and rejects when the write fails", async () => {
  const store = new FakeSecretFilesStore(); store.fail = true; const pref = new SecretFilesPreference(store);
  const seen: boolean[] = []; pref.subscribe(value => seen.push(value));
  await expect(pref.set(false)).rejects.toThrow("disk full");
  expect(pref.get()).toBe(true); expect(seen).toEqual([false, true]);
 });
});

describe("project sheet wiring", () => {
 const sheet = readFileSync(new URL("../src/ui/project-sheet.tsx", import.meta.url), "utf8");
 it("filters the files tree, the changes and a commit's files through the preference", () => {
  expect(sheet).toContain("useSyncExternalStore(secretFiles.subscribe, secretFiles.get)");
  expect(sheet.match(/hideSecrets\(/g)?.length).toBeGreaterThanOrEqual(3);
 });
 it("builds diff navigation lists from the shown files only", () => {
  expect(sheet).not.toContain("value.changes.map(ch => ch.path)");
  expect(sheet).not.toContain("files.map(f => f.path)");
 });
 it("forgets a reveal when the sheet closes", () => {
  expect(sheet).toMatch(/if \(!visible\) \{ setView\(\{ kind: "list" \}\);[^\n]*setRevealed\(false\); \} \}, \[visible\]\);/);
 });
});
