import Ionicons from "@expo/vector-icons/Ionicons";
import { appendDictation } from "../../core/dictation";
import { DictationMic, DictationModelSheet, DictationStatus, dictationVisible, useDictation } from "../../ui/dictation";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, PanResponder, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChatItem, OutgoingMessage } from "../../core/conversation";
import { statusOf, visiblePrompt } from "../../core/conversation";
import type { LivePhase } from "../../core/live-session";
import { UserMessage } from "../../ui/message-attachments";
import { AttachmentButton, AttachmentCards } from "../../ui/attachment-composer";
import { attachmentError, withheldNotice } from "../../ui/attachment-messages";
import { useComposerDraft } from "../../ui/use-composer-draft";
import { composerDrafts } from "../../core/composer-drafts";
import { sendComposerDraft } from "../../core/send-composer-draft";
import type { ComposerDraft } from "../../core/composer-drafts";
import { chatError, sendErrorContext, sendFailure, visibleChatError, type ChatError } from "../../core/send-error";
import { StatusPill } from "../../ui/components";
import { sessions } from "../../services";
import { usePreferences } from "../../ui/preferences";
import { useLiveSession } from "../../ui/use-live-session";
import { agentDisplayName, expectedCapabilities, sessionControls } from "../../core/session-controls";
import { AgentBadge } from "../../ui/agent-badge";
import { ApprovalList } from "../../ui/approvals";
import { useFirstVisitTip } from "../../ui/tour/tips";
import { approvalTip } from "../../ui/tour/tip-gate";

import OpenSession from "./open/[id]";

type Row = { type: "item"; item: ChatItem } | { type: "outgoing"; message: OutgoingMessage };

export default function SessionScreen() {
	const { chat, notHerdr } = useLocalSearchParams<{ chat?: string; notHerdr?: string }>();
	return chat === "1" || notHerdr === "1" ? <ChatScreen /> : <OpenSession />;
}

function ChatScreen() {
	const router = useRouter();
	const params = useLocalSearchParams<{ id: string; project?: string; cwd?: string; computer?: string; notHerdr?: string; fromTerminal?: string; agent?: string }>();
	const { theme, t } = usePreferences();
	const insets = useSafeAreaInsets();
	const c = theme.colors;
	const fromTerminal = params.fromTerminal === "1";
	const headerSwipe = useMemo(() => PanResponder.create({
		onMoveShouldSetPanResponder: (_event, g) => fromTerminal && g.dy > 8 && g.dy > Math.abs(g.dx),
		onPanResponderRelease: (_event, g) => { if (fromTerminal && g.dy >= 48) router.back(); },
	}), [fromTerminal, router]);
	const [terminalAvailable, setTerminalAvailable] = useState(false);
	useFocusEffect(useCallback(() => {
		let active = true;
		setTerminalAvailable(false);
		void sessions.terminalAvailable(params.id).then(value => { if (active) setTerminalAvailable(value); }).catch(() => { if (active) setTerminalAvailable(false); });
		return () => { active = false; };
	}, [params.id]));
	const composer = useComposerDraft(`chat:${params.id}`);
	const draft = composer.text;
	const dictating = useDictation(text => composer.setText(appendDictation(composer.text, text)));
	const setDraft = composer.setText;
	const [sendingLocal, setSending] = useState(false);
	const sending = sendingLocal || composer.sending;
	const sendingRef = useRef(false);
	const [progress, setProgress] = useState<[number, number] | null>(null);
	const [withheld, setWithheld] = useState<"none" | "model" | "blocked" | undefined>();
	const [error, setError] = useState<ChatError | null>(null);
	const live = useLiveSession(params.id);
	const conversation = live.view?.conversation ?? null;
	// The approvals when a send fails (not when it started): the agent-asking refusal is tied to them (phone check 3).
	const approvalsNow = useRef(conversation?.approvals); approvalsNow.current = conversation?.approvals;
	const shownError = visibleChatError(error, sendErrorContext(conversation?.approvals, { text: draft, attachments: composer.attachments }));
	// With an approval pending, its card replaces the generic prompt banner the bridge also raises (S7).
	const prompt = conversation ? visiblePrompt(conversation) : null;
	const phase: LivePhase = live.view?.phase ?? "connecting";

	// Newest first, for a list drawn from the bottom like a chat.
	const rows = useMemo<Row[]>(() => {
		if (!conversation) return [];
		const items: Row[] = conversation.items.map((item) => ({ type: "item", item }));
		const outgoing: Row[] = conversation.outgoing.map((message) => ({ type: "outgoing", message }));
		return [...items, ...outgoing].reverse();
	}, [conversation]);

	const freshness: Record<LivePhase, { text: string; warn: boolean }> = {
		connecting: { text: t.session.connecting, warn: false },
		live: { text: t.freshness.live, warn: false },
		reconnecting: { text: t.session.reconnecting, warn: true },
		ended: { text: t.session.closed, warn: true },
	};

	async function send() {
		if (sendingRef.current || composer.sourceBusy || composer.sending) return;
		sendingRef.current = true;
		setSending(true); setProgress(null); setError(null);
		try {
			const sent: { draft?: ComposerDraft } = {};
			const result = await sendComposerDraft(composerDrafts, `chat:${params.id}`, snapshot => { sent.draft = snapshot; return live.send(snapshot.text, snapshot.attachments, (n, total) => setProgress(n ? [n, total] : null)); });
			if (!result) return;
			if (result.ok) { setWithheld(result.imagesWithheld); }
			else setError(sendFailure(result.message, attachmentError(result.message, t.attachments), sendErrorContext(approvalsNow.current, sent.draft ?? { text: draft, attachments: composer.attachments })));
		} catch { setError(chatError(t.attachments.sendFailed)); }
		finally { sendingRef.current = false; setSending(false); setProgress(null); }
	}

	async function stop() {
		setError(null);
		const result = await live.stop();
		if (!result.ok) setError(chatError(t.session.stopFailed));
	}

	const banner = (text: string, hint?: string, warn = false) => (
		<View style={{ backgroundColor: c.surfaceRaised, borderLeftColor: warn ? c.danger : c.attention, borderLeftWidth: 3, padding: theme.spacing(3), gap: theme.spacing(1) }}>
			<Text style={{ color: c.text, fontSize: 14, fontWeight: "600" }}>{text}</Text>
			{hint ? <Text style={{ color: c.textMuted, fontSize: 13 }}>{hint}</Text> : null}
		</View>
	);

	const renderRow = ({ item: row }: { item: Row }) => {
		if (row.type === "outgoing") {
			const queued = row.message.state === "queued";
			return (
				<View style={{ alignSelf: "flex-end", maxWidth: "85%", gap: 4 }}>
					<View style={{ backgroundColor: c.surfaceRaised, borderColor: c.accentText, borderWidth: 1, borderStyle: "dashed", borderRadius: theme.radius.large, padding: theme.spacing(3) }}>
						<UserMessage text={row.message.text} files={row.message.files} queued />
					</View>
					<Text style={{ color: queued ? c.textMuted : c.attention, fontSize: 12, textAlign: "right" }}>{queued ? t.session.queued : t.session.returned(agentName)}</Text>
				</View>
			);
		}
		const item = row.item;
		if (item.kind === "tools") {
			return (
				<View style={{ flexDirection: "row", gap: theme.spacing(2), alignItems: "center", backgroundColor: c.surfaceRaised, borderRadius: theme.radius.small, padding: theme.spacing(3) }}>
					{item.running ? <ActivityIndicator size="small" color={c.working} /> : <Ionicons name={item.failed > 0 ? "alert-circle" : "construct"} size={16} color={item.failed > 0 ? c.danger : c.textMuted} />}
					<Text style={{ color: c.text, fontFamily: theme.font.mono, fontSize: 13, flex: 1 }} numberOfLines={1}>
						{item.running ? t.session.toolRunning(item.running) : t.session.toolsUsed(item.count, item.failed)}
					</Text>
				</View>
			);
		}
		const mine = item.kind === "user";
		return (
			<View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%", backgroundColor: mine ? c.accent : c.surface, borderRadius: theme.radius.large, padding: theme.spacing(3) }}>
				{mine ? <UserMessage text={item.text} /> : <Text selectable style={{ color: c.text, fontSize: 15, lineHeight: 21 }}>
					{item.text}
					{item.kind === "assistant" && item.streaming ? " ▍" : ""}
				</Text>}
			</View>
		);
	};

	const running = conversation?.running ?? false;
	// claude-codex T3b: what this agent supports decides which controls exist; Pi without capabilities keeps all.
	const routeAgent = params.agent === "claude-code" || params.agent === "codex" || params.agent === "unknown" ? params.agent : undefined;
	const agent = conversation?.agent ?? routeAgent;
	const controls = sessionControls(conversation?.capabilities ?? expectedCapabilities(params.agent), running);
	// The approval tip (first visit): only on the screen in front, so the terminal under it (or over it) never shares the target.
	const [screenFocused, setScreenFocused] = useState(true);
	useFocusEffect(useCallback(() => { setScreenFocused(true); return () => setScreenFocused(false); }, []));
	useFirstVisitTip("approval", approvalTip({ focused: screenFocused, overlay: dictating.needsModel, pending: conversation?.approvals.length ?? 0, canAnswer: controls.answerApprovals }));
	// Session texts name this session's agent, not always Pi (claude-codex L18).
	const agentName = agentDisplayName(agent, t.agents.names);
	// Before the snapshot, a route without an agent may be any agent: no name rather than a wrong «Pi».
	const composerName = conversation || routeAgent ? agentName : null;
	const placeholder = composerName ? t.session.composerTo(composerName) : t.session.composerPlaceholder;
	const canSend = phase === "live" && (draft.trim().length > 0 || composer.attachments.length > 0) && !sending && !composer.sourceBusy && (!running || controls.sendWhileRunning);

	return (
		<KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
			{/* Header: where you are, its status and model, and the two views of this session. */}
			<View {...headerSwipe.panHandlers} style={{ paddingHorizontal: theme.spacing(3), paddingBottom: theme.spacing(3), borderBottomColor: c.border, borderBottomWidth: 1, gap: theme.spacing(2) }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing(1) }}>
					<Pressable accessibilityRole="button" onPress={() => router.back()} accessibilityLabel={fromTerminal ? t.terminal.backToTerminal : t.session.back} style={{ width: theme.touch, height: theme.touch, alignItems: "center", justifyContent: "center" }}>
						<Ionicons name={fromTerminal ? "chevron-down" : "chevron-back"} size={26} color={c.accentText} />
					</Pressable>
					<View style={{ flex: 1 }}>
						<Text numberOfLines={1} ellipsizeMode="middle" style={{ color: c.textMuted, fontSize: 13 }}>
							{params.computer} › {params.cwd}
						</Text>
						<Text numberOfLines={1} style={{ color: c.text, fontSize: 19, fontWeight: "700" }}>
							{params.project}
						</Text>
						<View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: theme.spacing(3), marginTop: 2 }}>
							{conversation ? <StatusPill status={statusOf(conversation)} /> : null}
							<Text style={{ color: freshness[phase].warn ? c.danger : c.textMuted, fontSize: 12 }}>{freshness[phase].text}</Text>
							{conversation?.model ? <Text style={{ color: c.textMuted, fontSize: 12 }}>{conversation.model.id}</Text> : null}
							<AgentBadge agent={agent} />
						</View>
					</View>
					{controls.stop ? (
						<Pressable
							onPress={stop}
							disabled={conversation?.stopping}
							accessibilityLabel={t.session.stop}
							style={{ minHeight: theme.touch, paddingHorizontal: theme.spacing(3), borderRadius: theme.radius.medium, borderColor: c.danger, borderWidth: 1, alignItems: "center", justifyContent: "center", opacity: conversation?.stopping ? 0.6 : 1 }}
						>
							<Text style={{ color: c.danger, fontWeight: "700" }}>{conversation?.stopping ? t.session.stopping : t.session.stop}</Text>
						</Pressable>
					) : null}
				</View>
				{fromTerminal ? <Pressable accessibilityRole="button" accessibilityLabel={t.terminal.backToTerminal} onPress={() => router.back()} style={{ minHeight: 48, justifyContent: "center", alignItems: "center" }}><Text style={{ color: c.accentText }}>{t.terminal.backToTerminal}</Text></Pressable> : terminalAvailable && controls.terminal ? (
					<Pressable accessibilityRole="button" accessibilityLabel={t.session.terminal} onPress={() => params.fromTerminal === "1" ? router.back() : router.push({ pathname: "/session/terminal/[id]", params: { id: params.id, project: params.project, cwd: params.cwd, computer: params.computer } })} style={{ minHeight: 48, justifyContent: "center", alignItems: "center", backgroundColor: c.surfaceRaised, borderRadius: theme.radius.medium }}>
						<Text style={{ color: c.accentText, fontWeight: "700" }}>{t.session.terminal}</Text>
					</Pressable>
				) : null}
			</View>
				<>
					{params.notHerdr === "1" ? banner(t.terminal.notHerdr) : null}
					{phase === "ended" ? banner(t.session.ended(agentName), undefined, true) : null}
					{prompt ? banner(prompt.title ? `${t.session.waiting(agentName)} ${prompt.title}` : t.session.waiting(agentName), t.session.waitingHint) : null}
					{live.view?.missedEvents ? banner(t.session.missed) : null}
					{live.view?.stopSlow ? banner(t.session.stopSlow(agentName), undefined, true) : null}
					{/* The message area is the part that gives way: no size of its own (flex basis 0), clipped so no bubble
					   draws over the approval card below it (build 15 phone check). */}
					<View style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
						{rows.length === 0 ? (
							// Outside the list: an inverted list would draw this text mirrored.
							<View style={{ flex: 1, justifyContent: "flex-end", padding: theme.spacing(4) }}>
								<Text style={{ color: c.textMuted, textAlign: "center" }}>{conversation ? t.session.empty : t.session.connecting}</Text>
							</View>
						) : (
							<FlatList
								inverted
								data={rows}
								style={{ flex: 1 }}
								keyExtractor={(row) => (row.type === "item" ? row.item.key : row.message.key)}
								renderItem={renderRow}
								contentContainerStyle={{ padding: theme.spacing(4), gap: theme.spacing(3) }}
							/>
						)}
					</View>
					{/* Outside the shrinking list, above the composer: the card keeps its buttons and minimum whatever the keyboard or an error line take. */}
					<ApprovalList anchor={screenFocused} approvals={conversation?.approvals ?? []} canAnswer={controls.answerApprovals} answer={live.answer} />
					{shownError ? <Text style={{ color: c.danger, fontSize: 13, paddingHorizontal: theme.spacing(4), paddingBottom: theme.spacing(1) }}>{shownError}</Text> : null}
					{controls.composer ? <>
						{withheldNotice(withheld, t.attachments) ? <Text accessibilityLiveRegion="polite" style={{ color: c.attention, padding: 8 }}>{withheldNotice(withheld, t.attachments)}</Text> : null}
						{composer.sourceError ? <Text accessibilityRole="alert" style={{ color: c.danger, padding: 8 }}>{composer.sourceError}</Text> : null}
						<AttachmentCards items={composer.attachments} remove={composer.remove} disabled={sending} />
						{dictationVisible(dictating) ? <View style={{ paddingHorizontal: theme.spacing(4) }}><DictationStatus d={dictating} /></View> : null}
						<DictationModelSheet visible={dictating.needsModel} close={dictating.closeModel} />
						<View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing(2), padding: theme.spacing(3), paddingBottom: theme.spacing(3) + insets.bottom, borderTopColor: c.border, borderTopWidth: 1, backgroundColor: c.surface }}>
							{controls.attachments ? <AttachmentButton disabled={sending || phase === "ended"} busy={composer.sourceBusy} select={composer.select} /> : null}
							<TextInput
								value={draft}
								onChangeText={setDraft}
								placeholder={placeholder}
								placeholderTextColor={c.textMuted}
								multiline
								editable={phase !== "ended" && !sending}
								style={{ flex: 1, color: c.text, backgroundColor: c.surfaceRaised, borderRadius: theme.radius.medium, paddingHorizontal: theme.spacing(3), minHeight: theme.touch - 4, maxHeight: 160, fontSize: 15 }}
							/>
							<DictationMic d={dictating} disabled={phase === "ended" || sending} />
							<Pressable
								onPress={send}
								disabled={!canSend}
								accessibilityLabel={sending ? progress ? t.attachments.uploading(...progress) : t.attachments.sending : t.session.send}
								style={{ minWidth: theme.touch, minHeight: theme.touch, paddingHorizontal: sending ? 8 : 0, borderRadius: theme.touch / 2, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", opacity: canSend ? 1 : 0.4 }}
							>
								{sending ? <Text accessibilityLiveRegion="polite" style={{ color: c.onAccent, maxWidth: 140 }}>{progress ? t.attachments.uploading(...progress) : t.attachments.sending}</Text> : <Ionicons name="arrow-up" size={22} color={c.onAccent} />}
							</Pressable>
						</View>
					</> : (
						// No dead end (PRD C6): say where this session can be written to instead.
						<View style={{ padding: theme.spacing(4), paddingBottom: theme.spacing(4) + insets.bottom, borderTopColor: c.border, borderTopWidth: 1, backgroundColor: c.surface }}>
							<Text accessibilityLiveRegion="polite" style={{ color: c.textMuted, fontSize: 14, textAlign: "center" }}>{terminalAvailable && controls.terminal ? t.session.noMessagesTerminal : t.session.noMessages}</Text>
						</View>
					)}
				</>
		</KeyboardAvoidingView>
	);
}
