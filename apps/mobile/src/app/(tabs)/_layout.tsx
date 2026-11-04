import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePreferences } from "../../ui/preferences";

type IconName = keyof typeof Ionicons.glyphMap;

export default function TabsLayout() {
	const { theme, t } = usePreferences();
	const insets = useSafeAreaInsets();
	// The selected tab's icon uses the accent, the others the muted text color.
	const icon = (name: IconName) =>
		function TabIcon({ focused, size }: { focused: boolean; size: number }) {
			return <Ionicons name={name} color={focused ? theme.colors.tabActiveIcon : theme.colors.textMuted} size={size} />;
		};
	return (
		<Tabs
			screenOptions={{
				headerShown: false,
				tabBarActiveTintColor: theme.colors.tabActive,
				tabBarInactiveTintColor: theme.colors.textMuted,
				tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, height: 64 + insets.bottom, paddingBottom: 8 + insets.bottom },
				tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
				sceneStyle: { backgroundColor: theme.colors.background },
			}}
		>
			<Tabs.Screen name="index" options={{ title: t.tabs.home, tabBarIcon: icon("home-outline") }} />
			<Tabs.Screen name="computers" options={{ title: t.tabs.computers, tabBarIcon: icon("desktop-outline") }} />
			<Tabs.Screen name="files" options={{ title: t.tabs.files, tabBarIcon: icon("document-attach-outline") }} />
			<Tabs.Screen name="settings" options={{ title: t.tabs.settings, tabBarIcon: icon("settings-outline") }} />
		</Tabs>
	);
}
