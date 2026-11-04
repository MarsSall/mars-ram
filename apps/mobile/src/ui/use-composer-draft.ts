import { useCallback, useState, useSyncExternalStore } from "react";
import { addAttachment, removeAttachment } from "../core/attachment-draft";
import { composerDrafts, type ComposerDraft } from "../core/composer-drafts";
import type { AttachmentSource } from "../core/media-source";
import { chooseAttachments } from "../services";
import { attachmentError } from "./attachment-messages";
import { usePreferences } from "./preferences";

export function useComposerDraft(key: string) {
 const { t } = usePreferences();
 const subscribe = useCallback((listener: () => void) => composerDrafts.subscribe(key, listener), [key]);
 const draft = useSyncExternalStore(subscribe, () => composerDrafts.get(key));
 const sending = useSyncExternalStore(subscribe, () => composerDrafts.isSending(key));
 const [sourceBusy, setSourceBusy] = useState(false);
 const [sourceError, setSourceError] = useState<string | null>(null);
 function save(next: ComposerDraft) { composerDrafts.set(key, next); }
 return {
  ...draft, sourceBusy, sourceError, sending,
  beginSend: () => composerDrafts.beginSend(key),
  endSend: () => composerDrafts.endSend(key),
  setText: (text: string) => save({ ...composerDrafts.get(key), text }),
  clear: () => composerDrafts.clearIfUnchanged(key, draft),
  remove: (id: string) => { const current = composerDrafts.get(key); save({ ...current, attachments: removeAttachment(current.attachments, id) }); },
  select: async (source: AttachmentSource) => {
   setSourceBusy(true); setSourceError(null);
   try {
    const result = await chooseAttachments(source);
    if (!result.ok) { setSourceError(t.attachments[result.reason]); return; }
    let current = composerDrafts.get(key);
    const errors: string[] = [];
    for (const item of result.items) {
     const added = addAttachment(current.attachments, item);
     if (added.ok) current = { ...current, attachments: added.items };
     else errors.push(attachmentError(added.message, t.attachments));
    }
    save(current);
    if (errors.length) setSourceError([...new Set(errors)].join("\n"));
   } finally { setSourceBusy(false); }
  },
 };
}
