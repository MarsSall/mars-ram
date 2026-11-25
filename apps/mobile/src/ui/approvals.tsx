// claude-codex-support S7: what the agent waits for the user to allow, answered with buttons (protocol 1.9).
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { ApprovalDecision, ApprovalRequest } from "@workspace/protocol";
import type { ActionResult } from "../core/live-session";
import { usePreferences } from "./preferences";
import { TourAnchor } from "./tour/anchors";

/**
 * The card's body (title, cut notice, detail) stays inside the card: a long command or title scrolls there instead of
 * pushing the chat away. The buttons are a fixed footer below it, so they never wait behind a scroll (build 15 L5).
 */
export const APPROVAL_BODY_MAX_HEIGHT = 140;
/** The most the approval area takes; with less room the body shrinks first, the header and the buttons stay. */
export const APPROVAL_LIST_MAX_HEIGHT = 400;
/** The least the body keeps when it gives way: one full title line (the title's line height). */
export const APPROVAL_BODY_MIN_HEIGHT = 20;
/** One line of the card's small texts (header, terminal hint, «N more»): their fixed line height. */
const LINE = 18;
const PER_ROW = 2;

type Metrics = { spacing(n: number): number; touch: number };
/** The buttons in rows of at most two, so the footer's height is known and can be held (build 15 phone check). */
function rowsOf<T>(items: readonly T[]): T[][] {
 const rows: T[][] = [];
 for (let i = 0; i < items.length; i += PER_ROW) rows.push(items.slice(i, i + PER_ROW));
 return rows;
}
function footerMinHeight(choices: number, theme: Metrics): number {
 const rows = Math.ceil(choices / PER_ROW);
 return rows * theme.touch + Math.max(0, rows - 1) * theme.spacing(2);
}
function hasBody(approval: ApprovalRequest): boolean {
 return Boolean(approval.title || approval.detailTruncated === true || approval.detail);
}
/**
 * The least the card may shrink to: padding, border, header, one body line and the whole footer. Yoga lets a
 * shrinking view go below its children, so the card (and its area) carry this explicitly: with less room the
 * screen around it gives way, never the buttons (build 15 phone check: «Rechazar» squeezed to 13 px).
 */
export function approvalCardMinHeight(approval: ApprovalRequest, canAnswer: boolean, theme: Metrics): number {
 const gap = theme.spacing(2);
 const body = hasBody(approval) ? gap + APPROVAL_BODY_MIN_HEIGHT : 0;
 const footer = canAnswer ? footerMinHeight(approval.choices.length, theme) : LINE;
 return theme.spacing(3) * 2 + 2 + LINE + body + gap + footer;
}

type Answer = (id: string, decision: ApprovalDecision) => Promise<ActionResult>;

/**
 * One pending approval. `canAnswer` is the session's `capabilities.approvals`: without it the card only
 * says where to answer. A press shows «Enviando…» on that button and locks the others; success leaves the
 * card to the parent (the approval leaves the list), a failure shows an error line and unlocks the buttons.
 * A detail the bridge cut (`detailTruncated`) gets a notice to review it in the terminal, read before the cut text,
 * and approving stops being the prominent choice: every button is drawn as a secondary one.
 */
export function ApprovalCard({ approval, canAnswer, answer }: { approval: ApprovalRequest; canAnswer: boolean; answer: Answer }) {
 const { theme, t } = usePreferences(); const c = theme.colors; const a = t.approvals;
 const [busy, setBusy] = useState<ApprovalDecision | null>(null);
 const [failed, setFailed] = useState(false);
 async function press(decision: ApprovalDecision) {
  if (busy) return;
  setBusy(decision); setFailed(false);
  let ok = false;
  try { ok = (await answer(approval.id, decision)).ok; } catch { ok = false; }
  // On success the card is about to leave; keep it locked so a second tap cannot answer twice.
  if (!ok) { setBusy(null); setFailed(true); }
 }
 const mono = approval.kind === "command";
 const truncated = approval.detailTruncated === true;
 // The card's margin lives on its TourAnchor wrapper (ApprovalList), so the tip's ring hugs the card.
 return <View accessibilityLabel={`${a.title}: ${a.kinds[approval.kind]}${approval.title ? `, ${approval.title}` : ""}`} style={{ flexShrink: 1, minHeight: approvalCardMinHeight(approval, canAnswer, theme), padding: theme.spacing(3), gap: theme.spacing(2), borderRadius: theme.radius.medium, borderWidth: 1, borderColor: c.attention, borderLeftWidth: 4, backgroundColor: c.surfaceRaised }}>
  <Text accessibilityRole="header" style={{ flexShrink: 0, color: c.attention, fontSize: 13, lineHeight: LINE, fontWeight: "700" }}>{a.title} · {a.kinds[approval.kind]}</Text>
  {hasBody(approval) ? <ScrollView nestedScrollEnabled style={{ flexGrow: 0, flexShrink: 1, minHeight: APPROVAL_BODY_MIN_HEIGHT, maxHeight: APPROVAL_BODY_MAX_HEIGHT }} contentContainerStyle={{ gap: theme.spacing(2) }}>
   {approval.title ? <Text style={{ color: c.text, fontSize: 15, lineHeight: APPROVAL_BODY_MIN_HEIGHT, fontWeight: "600" }}>{approval.title}</Text> : null}
   {truncated ? <Text accessibilityRole="alert" style={{ color: c.attention, fontSize: 13, fontWeight: "600" }}>{a.detailTruncated}</Text> : null}
   {approval.detail ? <View accessibilityLabel={a.detail} style={{ padding: theme.spacing(2), backgroundColor: c.surface, borderRadius: theme.radius.small }}>
    <Text selectable style={{ color: c.text, fontSize: 13, ...(mono ? { fontFamily: theme.font.mono } : {}) }}>{approval.detail}</Text>
   </View> : null}
  </ScrollView> : null}
  {canAnswer ? <View accessibilityRole="toolbar" style={{ flexShrink: 0, minHeight: footerMinHeight(approval.choices.length, theme), gap: theme.spacing(2) }}>
   {rowsOf(approval.choices).map(row => <View key={row.join(" ")} style={{ flexShrink: 0, minHeight: theme.touch, flexDirection: "row", gap: theme.spacing(2) }}>
   {row.map(choice => {
    const primary = !truncated && (choice === "accept" || choice === "acceptForSession");
    const label = busy === choice ? a.sending : a.choices[choice];
    return <Pressable key={choice} accessibilityRole="button" accessibilityLabel={a.choices[choice]} accessibilityState={{ disabled: busy !== null, busy: busy === choice }} disabled={busy !== null} onPress={() => void press(choice)}
     style={{ minHeight: theme.touch, flexGrow: 1, flexShrink: 0, flexBasis: 0, paddingHorizontal: theme.spacing(3), borderRadius: theme.radius.medium, alignItems: "center", justifyContent: "center", backgroundColor: primary ? c.accent : "transparent", borderWidth: primary ? 0 : 1, borderColor: choice === "decline" ? c.danger : c.border, opacity: busy !== null && busy !== choice ? 0.5 : 1 }}>
     <Text accessibilityLiveRegion={busy === choice ? "polite" : undefined} style={{ color: primary ? c.onAccent : choice === "decline" ? c.danger : c.text, fontWeight: "700" }}>{label}</Text>
    </Pressable>;
   })}
   </View>)}
  </View> : <Text style={{ flexShrink: 0, color: c.textMuted, fontSize: 13, lineHeight: LINE }}>{a.answerInTerminal}</Text>}
  {failed ? <Text accessibilityRole="alert" style={{ color: c.danger, fontSize: 13 }}>{a.failed}</Text> : null}
 </View>;
}

/**
 * The oldest pending approval, with how many more wait after it; nothing at all when there are none. Only one card
 * is drawn, outside any scroll, so its buttons are always on screen; answering it brings in the next one.
 * The area never goes below the card's minimum: screens put it outside their shrinking list (or terminal), so with
 * little room that list gives way first.
 * anchor: this screen is in front, so the card is the approval tip's target; the wrapper carries the card's margin
 * (so the ring hugs the card and nothing moves) and only registers on the screen in front, so the session screen
 * under the terminal (or the reverse) never takes or rings the target.
 */
export function ApprovalList({ approvals, canAnswer, answer, anchor = false }: { approvals: readonly ApprovalRequest[]; canAnswer: boolean; answer: Answer; anchor?: boolean }) {
 const { theme, t } = usePreferences();
 const [first] = approvals;
 if (!first) return null;
 const more = approvals.length - 1;
 const cardMin = approvalCardMinHeight(first, canAnswer, theme);
 const minHeight = cardMin + theme.spacing(3) * 2 + (more > 0 ? LINE : 0);
 return <View style={{ flexShrink: 1, minHeight, maxHeight: Math.max(APPROVAL_LIST_MAX_HEIGHT, minHeight) }}>
  <TourAnchor key={first.id} id="approvals.first" enabled={anchor} style={{ flexShrink: 1, minHeight: cardMin, marginHorizontal: theme.spacing(3), marginVertical: theme.spacing(3) }}>
   <ApprovalCard approval={first} canAnswer={canAnswer} answer={answer} />
  </TourAnchor>
  {more > 0 ? <Text accessibilityLiveRegion="polite" style={{ flexShrink: 0, color: theme.colors.attention, fontSize: 13, lineHeight: LINE, fontWeight: "600", marginHorizontal: theme.spacing(3), marginTop: -theme.spacing(2), marginBottom: theme.spacing(2) }}>{t.approvals.more(more)}</Text> : null}
 </View>;
}
