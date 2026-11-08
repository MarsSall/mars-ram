import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Screen } from "../../ui/components";
import { WelcomeSteps } from "../../ui/home-welcome";
import { usePreferences } from "../../ui/preferences";

export default function AddComputerScreen() {
	const router = useRouter();
	const { theme, t } = usePreferences();
	const c = theme.colors;
	return (
		<Screen>
			<View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: theme.spacing(2), paddingVertical: theme.spacing(2) }}>
				<Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t.session.back} style={{ width: theme.touch, height: theme.touch, alignItems: "center", justifyContent: "center" }}>
					<Ionicons name="chevron-back" size={26} color={c.accentText} />
				</Pressable>
				<View>
					<Text style={{ color: c.textMuted, fontSize: 13 }}>{t.computers.title}</Text>
					<Text accessibilityRole="header" style={{ color: c.text, fontSize: 19, fontWeight: "700" }}>{t.add.title}</Text>
				</View>
			</View>
			<WelcomeSteps heading={false} />
		</Screen>
	);
}
