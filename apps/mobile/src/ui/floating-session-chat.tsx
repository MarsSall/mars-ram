import { useRef, useState } from "react";
import { ChatHandle } from "./chat-handle";
import { Pressable, Text, TextInput, View } from "react-native";
import { composerDrafts } from "../core/composer-drafts";
import { sendComposerDraft } from "../core/send-composer-draft";
import { sendErrorContext, chatError, sendFailure, visibleChatError, type ChatError } from "../core/send-error";
import { AttachmentButton, AttachmentCards } from "./attachment-composer";
import { attachmentError, withheldNotice } from "./attachment-messages";
import { useComposerDraft } from "./use-composer-draft";
import type { useLiveSession } from "./use-live-session";
import { usePreferences } from "./preferences";
import { appendDictation } from "../core/dictation";
import { DictationMic, DictationModelSheet, DictationStatus, dictationVisible, useDictation } from "./dictation";
import { useTourAnchor } from "./tour/anchors";
import { agentDisplayName, expectedCapabilities, sessionControls } from "../core/session-controls";
import type { AgentKind } from "@workspace/protocol";

/** Uses the terminal's already-followed bridge, never a competing event stream. */
/** `agent`: what the listing said ("pi" for a listed Pi session), for texts shown before the first snapshot; absent: not known yet.
 * `project`: the target session's project, shown so the user always sees where a message goes (claude-codex L20). */
export function FloatingSessionChat({ sessionKey, live, close, expand, agent, project }: { sessionKey: string; live: ReturnType<typeof useLiveSession>; close(): void; expand(): void; agent?: AgentKind | "unknown"; project?: string }) {
 const { theme, t } = usePreferences(); const c = theme.colors;
 const key = `chat:${sessionKey}`; const composer = useComposerDraft(key);
 const [error, setError] = useState<ChatError | null>(null);
 const [progress, setProgress] = useState<[number, number] | null>(null);
 const [withheld, setWithheld] = useState<"none" | "model" | "blocked" | undefined>();
 const phase = live.view?.phase ?? "connecting";
 const d = useDictation(text => composer.setText(appendDictation(composer.text, text)));
 const conversation = live.view?.conversation ?? null;
 // The agent-asking refusal goes once the approvals change or the draft is edited; other errors stay (phone check 3).
 const approvalsNow = useRef(conversation?.approvals); approvalsNow.current = conversation?.approvals;
 const shownError = visibleChatError(error, sendErrorContext(conversation?.approvals, composer));
 // claude-codex T3b: unsupported controls are hidden; a Pi bridge without capabilities keeps them all.
 const controls = sessionControls(conversation?.capabilities ?? expectedCapabilities(undefined), conversation?.running ?? false);
 const agentName = agentDisplayName(conversation?.agent ?? agent, t.agents.names);
 // Before the snapshot an unlisted session may be any agent: no name rather than a wrong «Pi».
 const composerName = conversation || agent !== undefined ? agentName : null;
 const placeholder = composerName ? t.session.composerTo(composerName) : t.session.composerPlaceholder;
 const target = project ? (composerName ? `${composerName} · ${project}` : project) : null;
 const canSend = controls.composer && phase === "live" && !composer.sending && !composer.sourceBusy && Boolean(composer.text.trim() || composer.attachments.length) && (!conversation?.running || controls.sendWhileRunning);
 async function send() {
  if (!canSend) return;
  setError(null); setProgress(null);
  try {
   let sent = { text: composer.text, attachments: composer.attachments };
   const result = await sendComposerDraft(composerDrafts, key, draft => { sent = draft; return live.send(draft.text, draft.attachments, (n, total) => setProgress(n ? [n, total] : null)); });
   if (!result) return;
   if (result.ok) setWithheld(result.imagesWithheld);
   else setError(sendFailure(result.message, attachmentError(result.message, t.attachments), sendErrorContext(approvalsNow.current, sent)));
  } catch { setError(chatError(t.attachments.sendFailed)); }
  finally { setProgress(null); }
 }
 // The first-visit tip marks the whole box.
 const composerAnchor = useTourAnchor("chat.composer");
 const actionStyle = { width: 48, height: 48, borderRadius: 24, alignItems: "center" as const, justifyContent: "center" as const };
 return <View {...composerAnchor} style={{ marginHorizontal: 10, marginBottom: 8, padding: 12, borderRadius: 24, borderWidth: 1, borderColor: c.border, backgroundColor: c.terminalBackground }}>
  <View pointerEvents="box-none" style={{ position: "absolute", top: -11, left: 0, right: 0, alignItems: "center", zIndex: 2 }}><ChatHandle state="floating" change={next => { if (next === "full") expand(); else if (next === "closed") close(); }} /></View>
  <Pressable accessibilityRole="button" accessibilityLabel={t.terminal.closeChat} onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ position: "absolute", top: 4, right: 8, width: 28, height: 28, alignItems: "center", justifyContent: "center", zIndex: 2 }}><Text style={{ color: c.textMuted, fontSize: 20 }}>×</Text></Pressable>
  {target ? <Text numberOfLines={1} style={{ color: c.textMuted, fontSize: 12, paddingRight: 28, marginBottom: 4 }}>{target}</Text> : null}
  {!controls.composer ? <Text accessibilityLiveRegion="polite" style={{ color: c.textMuted, paddingVertical: 8, paddingRight: 28 }}>{t.session.noMessagesChat}</Text> : <>
  <TextInput autoFocus multiline value={composer.text} onChangeText={composer.setText} accessibilityLabel={placeholder} placeholder={placeholder} placeholderTextColor={c.textMuted} editable={phase !== "ended" && !composer.sending} style={{ color: c.terminalText, fontSize: 16, minHeight: 40, maxHeight: 120, fontFamily: theme.font.mono }} />
  {phase !== "live" ? <Text accessibilityLiveRegion="polite" style={{ color: c.attention }}>{phase === "ended" ? t.session.ended(agentName) : phase === "reconnecting" ? t.session.reconnecting : t.session.connecting}</Text> : null}
  {live.view?.conversation?.outgoing.map(message => <Text key={message.key} accessibilityLiveRegion="polite" numberOfLines={2} style={{ color: c.attention }}>{message.state === "queued" ? t.session.queued : t.session.returned(agentName)}{" · "}{message.text}</Text>)}
  {withheldNotice(withheld, t.attachments) ? <Text accessibilityLiveRegion="polite" style={{ color: c.attention }}>{withheldNotice(withheld, t.attachments)}</Text> : null}
  {shownError || composer.sourceError ? <Text accessibilityRole="alert" style={{ color: c.danger }}>{shownError ?? composer.sourceError}</Text> : null}
  {dictationVisible(d) ? <DictationStatus d={d} /> : null}
  <AttachmentCards items={composer.attachments} remove={composer.remove} disabled={composer.sending} />
  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
   {controls.attachments ? <View style={actionStyle}><AttachmentButton compact label={t.attachments.add} disabled={composer.sending || phase === "ended"} busy={composer.sourceBusy} select={composer.select} /></View> : null}
   <View style={{ flex: 1 }} />
   <DictationMic d={d} disabled={phase === "ended" || composer.sending} />
   <Pressable accessibilityRole="button" accessibilityLabel={composer.sending ? t.attachments.sending : t.session.send} accessibilityState={{ disabled: !canSend }} disabled={!canSend} onPress={() => void send()} style={{ ...actionStyle, backgroundColor: c.accent, opacity: canSend ? 1 : 0.4 }}><Text style={{ color: c.onAccent, fontSize: 24 }}>↑</Text></Pressable>
  </View>
  {composer.sending ? <Text accessibilityLiveRegion="polite" style={{ color: c.textMuted }}>{progress ? t.attachments.uploading(...progress) : t.attachments.sending}</Text> : null}
  <DictationModelSheet visible={d.needsModel} close={d.closeModel} />
  </>}
 </View>;
}
