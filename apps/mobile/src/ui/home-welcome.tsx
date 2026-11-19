import { useRouter } from "expo-router";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { PrimaryButton, Screen } from "./components";
import { GiftMascot } from "./gift-mascot";
import { GiftPhoto } from "./gift-photo";
import { InstallSteps } from "./install-help";
import { usePreferences } from "./preferences";

/** Decorative mark: the adjacent heading supplies its accessible name. Screen owns the glow. */
export function HomeHeading({ welcome = false }: { welcome?: boolean }) {
	const { theme, t } = usePreferences();
	// A gift photo or mascot is the hero: the same ram, only smaller, becomes a centered logo at the very top.
	// Faded too, so it never competes with the hero below it. A photo wins over a mascot.
	const hero = !!(theme.photo || theme.mascot);
	const logo = hero ? (welcome ? { width: 64, height: 51, opacity: 0.35 } : { width: 44, height: 35, opacity: 0.35 }) : (welcome ? { width: 250, height: 198 } : { width: 120, height: 95 });
	return (
		<View style={{ alignItems: "center", padding: theme.spacing(4), gap: theme.spacing(2), ...(hero ? { paddingTop: 0 } : {}) }}>
			<Image source={require("../../assets/brand/carnero.png")} accessible={false} resizeMode="contain" style={logo} />
			{theme.photo ? <GiftPhoto photo={theme.photo} size={welcome ? 200 : 128} captionColor={theme.colors.attention} />
				: theme.mascot ? <GiftMascot mascot={theme.mascot} width={welcome ? 250 : 160} captionColor={theme.colors.attention} /> : null}
			<Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: 30, fontWeight: "700", textAlign: "center" }}>{welcome ? t.home.brand : t.home.title}</Text>
			{welcome ? <Text style={{ color: theme.colors.textMuted, fontSize: 16, textAlign: "center" }}>{t.home.tagline}</Text> : null}
		</View>
	);
}

/**
 * The welcome's steps and actions; «Guiame paso a paso» opens the connection wizard.
 * «Escanear código» sits in a footer outside the scroll, so it is visible without scrolling.
 */
export function WelcomeSteps({ heading = true }: { heading?: boolean }) {
	const router = useRouter();
	const { theme, t } = usePreferences();
	return (
		<View style={{ flex: 1 }}>
			<ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingBottom: theme.spacing(3) }}>
				{heading ? <HomeHeading welcome /> : null}
				<InstallSteps />
				<Text style={{ color: theme.colors.textMuted, fontSize: 14, paddingHorizontal: theme.spacing(4), paddingBottom: theme.spacing(3) }}>{t.home.windowsPair}</Text>
				<View style={{ flex: 1 }} />
				<Pressable accessibilityRole="button" onPress={() => router.push("/add-computer")} style={{ minHeight: theme.touch, alignItems: "center", justifyContent: "center", paddingHorizontal: theme.spacing(4) }}>
					<Text style={{ color: theme.colors.accentText, fontSize: 16, fontWeight: "600", textAlign: "center" }}>{t.home.guide}</Text>
				</Pressable>
				<Pressable accessibilityRole="button" onPress={() => router.push("/add-computer/manual")} style={{ minHeight: theme.touch, alignItems: "center", justifyContent: "center", paddingHorizontal: theme.spacing(4) }}>
					<Text style={{ color: theme.colors.textMuted, fontSize: 16, textAlign: "center" }}>{t.home.manual}</Text>
				</Pressable>
			</ScrollView>
			<PrimaryButton label={t.home.scan} onPress={() => router.push("/add-computer/scan")} />
		</View>
	);
}

export function HomeWelcome() {
	return <Screen><WelcomeSteps /></Screen>;
}
