import { Stack } from "expo-router";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { setUnlockTitle } from "../services";
import { PreferencesProvider, usePreferences } from "../ui/preferences";

function RootStack() {
	const { theme, t } = usePreferences();
	// The system unlock prompt speaks the app's language.
	useEffect(() => setUnlockTitle(t.add.unlockTitle), [t]);
	return (
		<>
			<StatusBar style="light" />
			<Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }} />
		</>
	);
}

export default function RootLayout() {
	return (
		<SafeAreaProvider>
			<PreferencesProvider>
				<RootStack />
			</PreferencesProvider>
		</SafeAreaProvider>
	);
}
