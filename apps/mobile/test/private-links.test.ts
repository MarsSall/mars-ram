import { describe, expect, it } from "vitest";
import type { LinkHistoryItem } from "../src/core/links";
import { linkDisplayName, linkOperationError, linkRow, newestLinks, linkSize, selectComputer, unavailableLinks } from "../src/ui/private-links";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

const now = Date.parse("2026-10-25T12:00:00.000Z");
const item: LinkHistoryItem = { id: "a", computerId: "pc", fileName: "photo.png", url: "http://pc/l/token", size: 1024, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), status: "valid" };
describe("private link rows", () => {
 it("shows a newly confirmed link and a full day remaining", () => {
  expect(linkRow(item, now)).toEqual({ status: "valid", url: item.url, hours: 24, minutes: null, canRemove: true, confirmRemoval: true });
 });
 it("rounds down hours and uses minutes for the last hour", () => {
  expect(linkRow({ ...item, expiresAt: new Date(now + 90 * 60000).toISOString() }, now).hours).toBe(1);
  expect(linkRow({ ...item, expiresAt: new Date(now + 1000).toISOString() }, now).minutes).toBe(1);
 });
 it("expires locally at the deadline without another network check", () => {
  expect(linkRow(item, now + 86400000)).toMatchObject({ status: "expired", url: null, canRemove: true, confirmRemoval: false });
 });
 it.each(["expired", "deleted", "unavailable"] as const)("never exposes a copyable URL for %s", status => {
  expect(linkRow({ ...item, status }, now)).toMatchObject({ status, url: null, canRemove: status !== "unavailable", confirmRemoval: false });
 });
 it("sorts newest first without changing the input", () => {
  const old = { ...item, id: "old", createdAt: new Date(now - 1000).toISOString() };
  const input = [old, item];
  expect(newestLinks(input).map(row => row.id)).toEqual(["a", "old"]);
  expect(input[0]).toBe(old);
 });
 it("withdraws availability on a failed check without losing history or terminal states", () => {
  const deleted = { ...item, id: "deleted", status: "deleted" as const };
  const items = unavailableLinks([item, deleted]);
  expect(items[0]).toEqual({ ...item, status: "unavailable" });
  expect(items[1]).toEqual(deleted);
  expect(item.status).toBe("valid");
 });
 it("formats sizes including zero and the maximum", () => {
  expect([0, 179, 1023, 1024, 1025, 1024 * 1024, 25 * 1024 * 1024].map(linkSize)).toEqual(["0 B", "179 B", "1023 B", "1 KB", "2 KB", "1.0 MB", "25.0 MB"]);
 });
 it("shows only the original portion of an upload name without mutating history", () => {
  const uploaded = { ...item, fileName: "20261025-120001-abc123-my-photo.png" };
  expect(linkDisplayName(uploaded.fileName)).toBe("my-photo.png");
  expect(uploaded.fileName).toBe("20261025-120001-abc123-my-photo.png");
  expect(linkDisplayName("20261025-120001-abc123-20261024-115959-def456-photo.png")).toBe("20261024-115959-def456-photo.png");
 });
 it.each(["photo.png", "20261025-120001-abc12-photo.png", "20261025-120001-ABC123-photo.png", "20261025-120001-abc123-", "prefix-20261025-120001-abc123-photo.png"])("preserves a non-upload name: %s", name => {
  expect(linkDisplayName(name)).toBe(name);
 });
 it.each(["failed", "removeFailed"] as const)("maps an unlock failure instead of the %s connection error", fallback => {
  expect(linkOperationError({ ok: false, code: "UNLOCK_REQUIRED", message: "Unlock first" }, fallback)).toEqual({ key: "unlockRequired", detail: "UNLOCK_REQUIRED: Unlock first" });
 });
 it.each(["failed", "removeFailed"] as const)("keeps other operation mappings and the %s fallback", fallback => {
  for (const [code, key] of [["LINK_NOT_INSTALLED", "notInstalled"], ["TOO_LARGE", "tooLarge"], ["LINK_FAILED", fallback], ["UNREACHABLE", fallback]] as const) {
   expect(linkOperationError({ ok: false, code, message: "Try again" }, fallback)).toEqual({ key, detail: `${code}: Try again` });
  }
 });
 it("keeps a remembered computer only while it is still saved", () => {
  expect(selectComputer(["a", "b"], "b")).toBe("b");
  expect(selectComputer(["a"], "gone")).toBe("a");
  expect(selectComputer([], "gone")).toBeNull();
 });
 it("explains that links need Tailscale on a ZeroTier computer", () => {
  expect(linkOperationError({ ok: false, code: "TAILSCALE_ONLY", message: "Only Tailscale" }, "failed")).toEqual({ key: "tailscaleOnly", detail: "TAILSCALE_ONLY: Only Tailscale" });
  expect(es.files.tailscaleOnly).toBe("Disponible solo con Tailscale");
  expect(en.files.tailscaleOnly).toBe("Available only with Tailscale");
 });
});
