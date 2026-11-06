// Any unknown link lands here instead of Expo Router's English debug page.
import { router } from "expo-router";
import { EmptyState, PrimaryButton, Screen } from "../ui/components";
import { usePreferences } from "../ui/preferences";

export default function NotFoundScreen() {
	const { t } = usePreferences();
	return (
		<Screen footer={<PrimaryButton label={t.notFound.home} onPress={() => router.replace("/")} />}>
			<EmptyState message={t.notFound.title} />
		</Screen>
	);
}
