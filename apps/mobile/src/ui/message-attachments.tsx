import Ionicons from "@expo/vector-icons/Ionicons";
import { splitAttachedFiles } from "@workspace/protocol";
import { useState, useSyncExternalStore } from "react";
import { Image, Text, View } from "react-native";
import { attachmentPresentation } from "../core/attachment-history";
import { attachmentHistory } from "../services";
import { usePreferences } from "./preferences";

/** Shared by confirmed history, live user messages, and phone-queued messages. */
export function UserMessage({ text, files, queued = false }: { text: string; files?: readonly string[]; queued?: boolean }) {
	const { theme } = usePreferences();
	const parsed = splitAttachedFiles(text);
	const names = files ?? parsed.files;
	return <View style={{ gap: theme.spacing(2) }}>
		{parsed.text.trim() ? <Text selectable style={{ color: queued ? theme.colors.text : theme.colors.onAccent, fontSize: 15, lineHeight: 21 }}>{parsed.text}</Text> : null}
		{names.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing(2) }}>
			{names.map((name, i) => <MessageAttachment key={`${name}:${i}`} name={name} />)}
		</View> : null}
	</View>;
}

function MessageAttachment({ name }: { name: string }) {
	const { theme, t } = usePreferences();
	useSyncExternalStore(attachmentHistory.subscribe, attachmentHistory.snapshot);
	const [failedUri, setFailedUri] = useState<string>();
	const candidate = attachmentPresentation(attachmentHistory, name);
	const item = attachmentPresentation(attachmentHistory, name, !!candidate.uri && candidate.uri === failedUri);
	const label = item.image ? t.attachments.imageItem(item.displayName) : t.attachments.fileItem(item.displayName);
	if (item.uri) return <Image source={{ uri: item.uri }} accessibilityLabel={label} accessible
		onError={() => setFailedUri(item.uri)} style={{ width: 72, height: 72, borderRadius: theme.radius.medium }} />;
	return <View accessible accessibilityLabel={label} style={{ minHeight: 72, maxWidth: 220, flexDirection: "row", alignItems: "center", gap: 8, padding: 12, backgroundColor: theme.colors.surfaceRaised, borderRadius: theme.radius.medium }}>
		<Ionicons name={item.image ? "image-outline" : "document-outline"} size={24} color={theme.colors.textMuted} />
		<Text style={{ color: theme.colors.text, flexShrink: 1 }}>{item.displayName}</Text>
	</View>;
}
