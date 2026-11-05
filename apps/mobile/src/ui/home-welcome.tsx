import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { installCommand, type InstallSystem } from "../core/install-command";
import { clipboard } from "../services";
import { PrimaryButton, Screen } from "./components";
import { usePreferences } from "./preferences";

/** Decorative mark: the adjacent heading supplies its accessible name. Screen owns the glow. */
export function HomeHeading({ welcome = false }: { welcome?: boolean }) {
	const { theme, t } = usePreferences();
	return (
		<View style={{ alignItems: "center", padding: theme.spacing(4), gap: theme.spacing(2) }}>
			<Image source={require("../../assets/brand/carnero.png")} accessible={false} resizeMode="contain" style={{ width: welcome ? 250 : 120, height: welcome ? 198 : 95 }} />
			<Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: 30, fontWeight: "700", textAlign: "center" }}>{welcome ? t.home.brand : t.home.title}</Text>
			{welcome ? <Text style={{ color: theme.colors.textMuted, fontSize: 16, textAlign: "center" }}>{t.home.tagline}</Text> : null}
		</View>
	);
}

/** Step 1: the one-line install for the computer's system, selectable and with a copy button. */
function InstallStep() {
	const { theme, t } = usePreferences();
	const c = theme.colors;
	const [system, setSystem] = useState<InstallSystem>("unix");
	const [feedback, setFeedback] = useState<"copied" | "failed" | null>(null);
	useEffect(() => {
		if (!feedback) return;
		const timer = setTimeout(() => setFeedback(null), 2000);
		return () => clearTimeout(timer);
	}, [feedback]);
	const command = installCommand(system);
	const copy = () => void clipboard.writeText(command).then(() => setFeedback("copied"), () => setFeedback("failed"));
	const systems: { value: InstallSystem; label: string }[] = [{ value: "unix", label: t.home.systemUnix }, { value: "windows", label: t.home.systemWindows }];
	return (
		<View style={{ gap: theme.spacing(3) }}>
			<Text style={{ color: c.text, fontSize: 16 }}>{t.home.install}</Text>
			<View accessibilityRole="tablist" style={{ flexDirection: "row", backgroundColor: c.surfaceRaised, borderRadius: theme.radius.medium, padding: 3 }}>
				{systems.map((option) => {
					const selected = option.value === system;
					return (
						<Pressable
							key={option.value}
							onPress={() => { setSystem(option.value); setFeedback(null); }}
							accessibilityRole="tab"
							accessibilityState={{ selected }}
							style={{ flex: 1, minHeight: theme.touch, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.small, backgroundColor: selected ? c.accent : "transparent" }}
						>
							<Text style={{ color: selected ? c.onAccent : c.textMuted, fontWeight: "700" }}>{option.label}</Text>
						</Pressable>
					);
				})}
			</View>
			<View style={{ backgroundColor: c.surfaceRaised, borderColor: c.border, borderWidth: 1, borderRadius: theme.radius.medium, padding: theme.spacing(3), gap: theme.spacing(2) }}>
				<Text selectable style={{ color: c.text, fontFamily: theme.font.mono, fontSize: 14, lineHeight: 20 }}>{command}</Text>
				<Pressable
					onPress={copy}
					accessibilityRole="button"
					accessibilityLabel={t.home.copyCommand}
					style={({ pressed }) => ({ alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: theme.spacing(2), minHeight: theme.touch, minWidth: theme.touch, paddingHorizontal: theme.spacing(3), borderRadius: theme.radius.medium, borderWidth: 1, borderColor: c.accentText, opacity: pressed ? 0.85 : 1 })}
				>
					<Ionicons name={feedback === "copied" ? "checkmark-outline" : "copy-outline"} size={18} color={c.accentText} />
					<Text style={{ color: c.accentText, fontWeight: "700" }}>{feedback === "copied" ? t.home.copied : t.home.copy}</Text>
				</Pressable>
				{feedback === "failed" ? <Text accessibilityLiveRegion="polite" style={{ color: c.danger, fontSize: 14 }}>{t.home.copyFailed}</Text> : null}
			</View>
		</View>
	);
}

export function HomeWelcome() {
	const { theme, t } = usePreferences();
	const steps: ReactNode[] = [
		<InstallStep key="install" />,
		<Text key="command" style={{ color: theme.colors.text, fontSize: 16 }}>{t.home.run} <Text style={{ fontFamily: theme.font.mono }}>mars-ram pair</Text></Text>,
		<Text key="scan" style={{ color: theme.colors.text, fontSize: 16 }}>{t.home.scanStep}</Text>,
	];
	return (
		<Screen>
			<ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: theme.spacing(3) }}>
				<HomeHeading welcome />
				<View style={{ padding: theme.spacing(4), gap: theme.spacing(4) }}>
					{steps.map((step, index) => (
						<View key={index} style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing(3) }}>
							<Text style={{ color: theme.colors.textMuted, fontSize: 18, fontWeight: "700", lineHeight: 22 }}>{index + 1}</Text>
							<View style={{ flex: 1, paddingTop: 1 }}>{step}</View>
						</View>
					))}
				</View>
				<View style={{ flex: 1 }} />
				<PrimaryButton label={t.home.scan} onPress={() => router.push("/add-computer")} />
				<Pressable accessibilityRole="button" onPress={() => router.push("/add-computer/manual")} style={{ minHeight: theme.touch, alignItems: "center", justifyContent: "center", paddingHorizontal: theme.spacing(4) }}>
					<Text style={{ color: theme.colors.textMuted, fontSize: 16, textAlign: "center" }}>{t.home.manual}</Text>
				</Pressable>
			</ScrollView>
		</Screen>
	);
}
