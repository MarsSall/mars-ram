import { describe, expect, it } from "vitest";
import { DraftStore } from "../../src/core/composer-drafts";
import { sendComposerDraft } from "../../src/core/send-composer-draft";

describe("shared floating and full chat draft delivery", () => {
 it("keeps text and attachments on rejection or thrown transport errors, releasing the send lock", async () => {
  const store = new DraftStore(); const key = "chat:host/session";
  const draft = { text: "Try this", attachments: [{ id: "file-1", sourceUri: "file:///cache/example.txt", displayName: "example.txt", size: 12, mimeType: "text/plain", kind: "file" as const }] };
  store.set(key, draft);
  expect(await sendComposerDraft(store, key, async snapshot => { expect(snapshot).toBe(draft); return { ok: false, message: "offline" }; })).toEqual({ ok: false, message: "offline" });
  expect(store.get(key)).toBe(draft);
  await expect(sendComposerDraft(store, key, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  expect(store.get(key)).toBe(draft); expect(store.isSending(key)).toBe(false);
 });
 it("clears only the confirmed snapshot, prevents duplicate sends, and preserves edits made in flight", async () => {
  const store = new DraftStore(); const key = "chat:host/session";
  store.set(key, { text: "First", attachments: [] });
  let accept!: () => void;
  const pending = sendComposerDraft(store, key, async () => { await new Promise<void>(resolve => { accept = resolve; }); return { ok: true, imagesWithheld: "model" }; });
  expect(store.isSending(key)).toBe(true);
  expect(await sendComposerDraft(store, key, async () => { throw new Error("duplicate"); })).toBeNull();
  const next = { text: "Next", attachments: [] }; store.set(key, next);
  accept(); expect(await pending).toEqual({ ok: true, imagesWithheld: "model" });
  expect(store.get(key)).toBe(next); expect(store.isSending(key)).toBe(false);
  await sendComposerDraft(store, key, async () => ({ ok: true }));
  expect(store.get(key)).toEqual({ text: "", attachments: [] });
 });
});
