import { Stack } from "expo-router";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { appUpdates, notifications, notificationSystem, setUnlockTitle } from "../services";
import { AppState } from "react-native";
import { PreferencesProvider, usePreferences } from "../ui/preferences";
import { WhatsNewGate } from "../ui/whats-new";
import { TourAnchorsProvider } from "../ui/tour/anchors";
import { TourHost, tourAnchors } from "../ui/tour/tour-host";
import { TipLayer } from "../ui/tour/tips";
import { ROOT_TIPS } from "../ui/tour/tip-gate";

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
			{/* First-visit tips over the terminal and its sheets; the session selector shows its own inside its Modal. */}
			<TipLayer tips={ROOT_TIPS} />
			{/* Above every screen, tabs and terminal included; not a Modal, so a tab tap reaches the real tab. */}
			<TourHost />
		</>
	);
}

export default function RootLayout() {
	return (
		<SafeAreaProvider>
			<PreferencesProvider>
				<TourAnchorsProvider registry={tourAnchors}>
					<RootStack />
				</TourAnchorsProvider>
			</PreferencesProvider>
		</SafeAreaProvider>
	);
}
