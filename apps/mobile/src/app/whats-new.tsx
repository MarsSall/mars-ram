// Ajustes → Acerca de → «Novedades»: every bundled release note, newest first.
import { useRouter } from "expo-router";
import { whatsNew } from "../services";
import { usePreferences } from "../ui/preferences";
import { WhatsNewView } from "../ui/whats-new";

export default function WhatsNewScreen() {
 const router = useRouter();
 const { t, theme, locale } = usePreferences();
 return <WhatsNewView notes={whatsNew.all()} locale={locale} t={t} theme={theme} onClose={() => router.back()} />;
}
