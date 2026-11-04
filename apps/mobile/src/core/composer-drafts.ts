import type { Attachment } from "./attachment-draft";

export type ComposerDraft = { text: string; attachments: readonly Attachment[] };
const empty: ComposerDraft = { text: "", attachments: [] };
/** Deliberately memory-only: no instruction text or copied images in persisted preferences. */
export class DraftStore {
 private readonly drafts = new Map<string, ComposerDraft>();
 private readonly sending = new Set<string>();
 private readonly listeners = new Map<string, Set<() => void>>();
 get(key: string): ComposerDraft { return this.drafts.get(key) ?? empty; }
 set(key: string, draft: ComposerDraft): void { this.drafts.set(key, draft); this.notify(key); }
 clear(key: string): void { this.drafts.delete(key); this.notify(key); }
 clearIfUnchanged(key: string, sent: ComposerDraft): void { if (this.get(key) === sent) this.clear(key); }
 isSending(key: string): boolean { return this.sending.has(key); }
 beginSend(key: string): boolean {
  if (this.isSending(key)) return false;
  this.sending.add(key); this.notify(key); return true;
 }
 endSend(key: string): void { this.sending.delete(key); this.notify(key); }
 subscribe(key: string, listener: () => void): () => void {
  const listeners = this.listeners.get(key) ?? new Set();
  listeners.add(listener); this.listeners.set(key, listeners);
  return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(key); };
 }
 private notify(key: string): void { this.listeners.get(key)?.forEach(listener => listener()); }
}
export const composerDrafts = new DraftStore();
