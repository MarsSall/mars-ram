import type { Strings } from "./i18n/en";

type Labels = Strings["attachments"];
/** Core errors remain English; never present an untranslated transport error as UI copy. */
export function attachmentError(message: string, t: Labels): string {
 const large = message.match(/^(.*) is over 25 MB\. Choose a smaller file\.$/s);
 if (large) return t.tooLarge(large[1]!);
 const unreadable = message.match(/^(.*) could not be read\. Please select it again\.$/s);
 if (unreadable) return t.unreadable(unreadable[1]!);
 if (message === "Attach at most 10 files.") return t.tooMany;
 if (message === "Please update Mars-RAM on the computer to send attachments.") return t.oldBridge;
 return t.sendFailed;
}
export function withheldNotice(reason: "none" | "model" | "blocked" | undefined, t: Labels): string | null {
 return reason === "model" ? t.model : reason === "blocked" ? t.blocked : null;
}
