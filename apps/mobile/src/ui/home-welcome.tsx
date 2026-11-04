import { router } from "expo-router";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
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

export function HomeWelcome() {
	const { theme, t } = usePreferences();
	const steps = [t.home.install, <Text key="command">{t.home.run} <Text style={{ fontFamily: "monospace" }}>mars-ram pair</Text></Text>, t.home.scanStep];
	return (
		<Screen>
			<ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: theme.spacing(3) }}>
				<HomeHeading welcome />
				<View style={{ padding: theme.spacing(4), gap: theme.spacing(4) }}>
					{steps.map((step, index) => (
						<View key={index} style={{ flexDirection: "row", alignItems: "baseline", gap: theme.spacing(3) }}>
							<Text style={{ color: theme.colors.textMuted, fontSize: 18, fontWeight: "700" }}>{index + 1}</Text>
							<Text style={{ flex: 1, color: theme.colors.text, fontSize: 16 }}>{step}</Text>
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
