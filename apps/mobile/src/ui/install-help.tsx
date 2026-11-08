import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { installCommands } from "../core/install-command";
import { clipboard } from "../services";
import { usePreferences } from "./preferences";

/** One selectable command with its own copy button and feedback. */
export function CommandBlock({ command, secondary = false }: { command: string; secondary?: boolean }) {
	const { theme, t } = usePreferences();
	const c = theme.colors;
	const [feedback, setFeedback] = useState<"copied" | "failed" | null>(null);
	useEffect(() => {
		if (!feedback) return;
		const timer = setTimeout(() => setFeedback(null), 2000);
		return () => clearTimeout(timer);
	}, [feedback]);
	const copy = () => void clipboard.writeText(command).then(() => setFeedback("copied"), () => setFeedback("failed"));
	return (
		<View style={{ backgroundColor: c.surfaceRaised, borderColor: c.border, borderWidth: 1, borderRadius: theme.radius.medium, padding: theme.spacing(3), gap: theme.spacing(2) }}>
			<Text selectable style={{ color: c.text, fontFamily: theme.font.mono, fontSize: secondary ? 13 : 14, lineHeight: secondary ? 18 : 20 }}>{command}</Text>
			<Pressable
				onPress={copy}
				accessibilityRole="button"
				accessibilityLabel={`${t.home.copyCommand}: ${command}`}
				style={({ pressed }) => ({ alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: theme.spacing(2), minHeight: theme.touch, minWidth: theme.touch, paddingHorizontal: theme.spacing(3), borderRadius: theme.radius.medium, borderWidth: 1, borderColor: c.accentText, opacity: pressed ? 0.85 : 1 })}
			>
				<Ionicons name={feedback === "copied" ? "checkmark-outline" : "copy-outline"} size={18} color={c.accentText} />
				<Text style={{ color: c.accentText, fontWeight: "700" }}>{feedback === "copied" ? t.home.copied : t.home.copy}</Text>
			</Pressable>
			{feedback === "failed" ? <Text accessibilityLiveRegion="polite" style={{ color: c.danger, fontSize: 14 }}>{t.home.copyFailed}</Text> : null}
		</View>
	);
}

/** Step 1: the global install, the same on every system; pnpm recommended, npm as the alternative. */
function InstallStep() {
	const { theme, t } = usePreferences();
	const c = theme.colors;
	return (
		<View style={{ gap: theme.spacing(3) }}>
			<Text style={{ color: c.text, fontSize: 16 }}>{t.home.install}</Text>
			<View style={{ gap: theme.spacing(2) }}>
				<Text style={{ color: c.textMuted, fontSize: 14, fontWeight: "700" }}>{t.home.recommended}</Text>
				<CommandBlock command={installCommands.recommended} />
			</View>
			<View style={{ gap: theme.spacing(2) }}>
				<Text style={{ color: c.textMuted, fontSize: 14 }}>{t.home.usingNpm}</Text>
				<CommandBlock command={installCommands.npm} secondary />
			</View>
		</View>
	);
}

/** Shared numbered instructions, including the final scan step. */
export function InstallSteps() {
	const { theme, t } = usePreferences();
	const steps: ReactNode[] = [
		<InstallStep key="install" />,
		<Text key="setup" style={{ color: theme.colors.text, fontSize: 16 }}>{t.home.run} <Text style={{ fontFamily: theme.font.mono }}>mars-ram install</Text></Text>,
		<Text key="pair" style={{ color: theme.colors.text, fontSize: 16 }}>{t.home.run} <Text style={{ fontFamily: theme.font.mono }}>mars-ram pair</Text></Text>,
		<Text key="scan" style={{ color: theme.colors.text, fontSize: 16 }}>{t.home.scanStep}</Text>,
	];
	return (
		<View style={{ padding: theme.spacing(4), gap: theme.spacing(4) }}>
			{steps.map((step, index) => (
				<View key={index} style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing(3) }}>
					<Text style={{ color: theme.colors.textMuted, fontSize: 18, fontWeight: "700", lineHeight: 22 }}>{index + 1}</Text>
					<View style={{ flex: 1, paddingTop: 1 }}>{step}</View>
				</View>
			))}
		</View>
	);
}
