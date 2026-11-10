import { useRouter } from "expo-router";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { PrimaryButton, Screen } from "./components";
import { InstallSteps } from "./install-help";
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

/** The welcome's steps and actions; «Guiame paso a paso» opens the connection wizard. */
export function WelcomeSteps({ heading = true }: { heading?: boolean }) {
	const router = useRouter();
	const { theme, t } = usePreferences();
	return (
		<ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: theme.spacing(3) }}>
			{heading ? <HomeHeading welcome /> : null}
			<InstallSteps />
			<Text style={{ color: theme.colors.textMuted, fontSize: 14, paddingHorizontal: theme.spacing(4), paddingBottom: theme.spacing(3) }}>{t.home.windowsPair}</Text>
			<View style={{ flex: 1 }} />
			<PrimaryButton label={t.home.scan} onPress={() => router.push("/add-computer/scan")} />
			<Pressable accessibilityRole="button" onPress={() => router.push("/add-computer")} style={{ minHeight: theme.touch, alignItems: "center", justifyContent: "center", paddingHorizontal: theme.spacing(4) }}>
				<Text style={{ color: theme.colors.accentText, fontSize: 16, fontWeight: "600", textAlign: "center" }}>{t.home.guide}</Text>
			</Pressable>
			<Pressable accessibilityRole="button" onPress={() => router.push("/add-computer/manual")} style={{ minHeight: theme.touch, alignItems: "center", justifyContent: "center", paddingHorizontal: theme.spacing(4) }}>
				<Text style={{ color: theme.colors.textMuted, fontSize: 16, textAlign: "center" }}>{t.home.manual}</Text>
			</Pressable>
		</ScrollView>
	);
}

export function HomeWelcome() {
	return <Screen><WelcomeSteps /></Screen>;
}
