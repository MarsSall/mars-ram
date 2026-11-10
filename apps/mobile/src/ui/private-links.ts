import type { LinkFailure, LinkHistoryItem, LinkStatus } from "../core/links";

/** Availability requires host evidence; expiry can only make that evidence less permissive. */
export function linkRow(item: LinkHistoryItem, now: number) {
 const remaining = Date.parse(item.expiresAt) - now;
 const status: LinkStatus = remaining <= 0 ? "expired" : item.status;
 const valid = status === "valid";
 return {
  status, url: valid ? item.url : null,
  hours: valid && remaining >= 3600000 ? Math.floor(remaining / 3600000) : null,
  minutes: valid && remaining < 3600000 ? Math.max(1, Math.ceil(remaining / 60000)) : null,
  canRemove: status !== "unavailable", confirmRemoval: valid,
 };
}
export const unavailableLinks = (items: readonly LinkHistoryItem[]): LinkHistoryItem[] => items.map(item => item.status === "valid" ? { ...item, status: "unavailable" } : item);
export const newestLinks = (items: readonly LinkHistoryItem[]): LinkHistoryItem[] => [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
/** Display only: keep the stamped upload name for storage and host operations. */
export const linkDisplayName = (name: string): string => name.replace(/^\d{8}-\d{6}-[a-z0-9]{6}-(?=.)/, "");
export const linkSize = (bytes: number): string => bytes < 1024 ? `${bytes} B` : bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
export type FilesError = { key: "updateRequired" | "zeroTierAddress" | "failed" | "notInstalled" | "tooLarge" | "unlockRequired" | "loadFailed" | "removeFailed" | "copyFailed" | "noImage" | "cameraDenied" | "sourceFailed"; detail?: string };
export const linkOperationError = (failure: LinkFailure, fallback: "failed" | "removeFailed"): FilesError => ({
 key: failure.code === "UPDATE_REQUIRED" ? "updateRequired" : failure.code === "ZEROTIER_ADDRESS_NOT_FOUND" ? "zeroTierAddress" : failure.code === "UNLOCK_REQUIRED" ? "unlockRequired" : failure.code === "LINK_NOT_INSTALLED" ? "notInstalled" : failure.code === "TOO_LARGE" ? "tooLarge" : fallback,
 detail: `${failure.code}: ${failure.message}`,
});
export const selectComputer = (ids: readonly string[], remembered: string | null): string | null => remembered && ids.includes(remembered) ? remembered : ids[0] ?? null;
