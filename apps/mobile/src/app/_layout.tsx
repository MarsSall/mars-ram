import { Stack } from "expo-router";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { appUpdates, notifications, notificationSystem, setUnlockTitle } from "../services";
import { AppState } from "react-native";
import { PreferencesProvider, usePreferences } from "../ui/preferences";
import { WhatsNewGate } from "../ui/whats-new";

function RootStack() {
	const { theme, t, locale } = usePreferences();
	// The system unlock prompt speaks the app's language.
	useEffect(() => setUnlockTitle(t.add.unlockTitle), [t]);
	useEffect(() => { void notificationSystem.setLanguage(locale).catch(() => {}); }, [locale]);
	// Asks Google Play at most once per start and once a day; silent without Play.
	useEffect(() => { void appUpdates.start(); }, []);
	useEffect(() => {
		// Arm while visible, before Android's background-start restriction applies.
		void notifications.ensureWatching();
		const subscription = AppState.addEventListener("change", state => {
			if (state === "active") void notifications.ensureWatching();
		});
		return () => subscription.remove();
	}, []);
	return (
		<>
			<StatusBar style="light" />
			<Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }} />
			<WhatsNewGate />
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
