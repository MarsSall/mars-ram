import type { ComposerDraft, DraftStore } from "./composer-drafts";
import type { ActionResult } from "./live-session";

/** Both chat surfaces share one per-session draft and in-flight lock. Only a
 * confirmed, unchanged snapshot may be cleared; failures never consume work. */
export async function sendComposerDraft(store: DraftStore, key: string, send: (draft: ComposerDraft) => Promise<ActionResult>): Promise<ActionResult | null> {
 if (!store.beginSend(key)) return null;
 const draft = store.get(key);
 try {
  const result = await send(draft);
  if (result.ok) store.clearIfUnchanged(key, draft);
  return result;
 } finally { store.endSend(key); }
}
