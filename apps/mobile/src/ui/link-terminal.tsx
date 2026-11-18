// release-0.1.8 S5: what a terminal opened from a notification or link shows before anything reaches the computer.
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { PrimaryButton, Screen } from "./components";
import type { Strings } from "./i18n/en";
import type { Theme } from "./theme";

export type LinkTerminalPhase = "loading" | "confirm" | "opening" | "gone" | "invalid";
type Props = { phase: LinkTerminalPhase; computer: string; t: Strings; theme: Theme; onOpen: () => void; onCancel: () => void; onHome: () => void };

export function LinkTerminalView({ phase, computer, t, theme, onOpen, onCancel, onHome }: Props) {
	const c = theme.colors; const l = t.linkTerminal;
	const secondary = (label: string, onPress: () => void) => (
		<Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ minHeight: theme.touch, alignItems: "center", justifyContent: "center", marginHorizontal: theme.spacing(4) }}>
			<Text style={{ color: c.accentText, fontSize: 16, fontWeight: "600" }}>{label}</Text>
		</Pressable>
	);
	let body; let footer;
	if (phase === "loading" || phase === "opening") {
		body = <View style={{ padding: theme.spacing(6), gap: theme.spacing(3) }}>
			<ActivityIndicator color={c.accentText} />
			{phase === "opening" ? <Text accessibilityLiveRegion="polite" style={{ color: c.text, fontSize: 16, textAlign: "center" }}>{l.opening(computer)}</Text> : null}
		</View>;
	} else if (phase === "gone" || phase === "invalid") {
		body = <View style={{ padding: theme.spacing(6) }}>
			<Text accessibilityRole="alert" style={{ color: c.text, fontSize: 16, textAlign: "center" }}>{phase === "gone" ? l.gone(computer) : l.invalid}</Text>
		</View>;
		footer = <PrimaryButton label={l.home} onPress={onHome} />;
	} else {
		body = <View style={{ padding: theme.spacing(6), gap: theme.spacing(4) }}>
			<Text accessibilityRole="header" style={{ color: c.text, fontSize: 22, fontWeight: "700" }}>{l.title}</Text>
			<View style={{ backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: theme.radius.medium, padding: theme.spacing(4), gap: theme.spacing(1) }}>
				<Text style={{ color: c.textMuted, fontSize: 13 }}>{l.computer}</Text>
				<Text style={{ color: c.text, fontSize: 17, fontWeight: "600" }}>{computer}</Text>
			</View>
			<Text style={{ color: c.textMuted, fontSize: 15 }}>{l.explain(computer)}</Text>
		</View>;
		// Nothing reaches the computer before «Abrir».
		footer = <View style={{ paddingBottom: theme.spacing(2) }}>
			<PrimaryButton label={l.open} onPress={onOpen} />
			{secondary(l.cancel, onCancel)}
		</View>;
	}
	return <Screen footer={footer}>{body}</Screen>;
}
