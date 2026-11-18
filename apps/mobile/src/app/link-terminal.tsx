// `/link-terminal?h=…&b=…` comes only from `+native-intent` for a notice link (release-0.1.8 S5):
// any app can send one, so ask before connecting, opening a PTY or moving Herdr focus.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { BackHandler } from "react-native";
import { answerLinkTerminal, leaveToInicio, readLinkTerminalParams } from "../core/notification-routing";
import { catalog, sessions } from "../services";
import { LinkTerminalView, type LinkTerminalPhase } from "../ui/link-terminal";
import { usePreferences } from "../ui/preferences";

export default function LinkTerminalScreen() {
	const router = useRouter();
	const { t, theme } = usePreferences();
	const { h, b } = useLocalSearchParams<{ h?: string | string[]; b?: string | string[] }>();
	const target = useMemo(() => readLinkTerminalParams(h, b), [h, b]);
	const [phase, setPhase] = useState<LinkTerminalPhase>("loading");
	const [computer, setComputer] = useState("");
	const answered = useRef(false); const left = useRef(false);
	// Never back to the previous screen (L14): a plain shell underneath would open a fresh PTY on refocus.
	const home = () => { left.current = true; leaveToInicio(router); };
	// Android back is «Cancelar» while asking, and the same way to Inicio otherwise.
	const leave = () => { if (answered.current) home(); else answer("cancel"); };
	useEffect(() => { const subscription = BackHandler.addEventListener("hardwareBackPress", () => { leave(); return true; }); return () => subscription.remove(); });

	// The saved-computer list is local: showing the name sends nothing to the computer.
	useEffect(() => {
		let alive = true;
		if (!target) { setPhase("invalid"); return; }
		void catalog.list().then(hosts => {
			if (!alive) return;
			const host = hosts.find(item => item.id === target.hostId);
			if (!host) { setPhase("invalid"); return; }
			setComputer(host.name); setPhase("confirm");
		}).catch(() => { if (alive) setPhase("invalid"); });
		return () => { alive = false; };
	}, [target]);

	const answer = (choice: "open" | "cancel") => {
		if (answered.current) return;
		if (!target) { home(); return; }
		answered.current = true;
		if (choice === "open") setPhase("opening");
		void answerLinkTerminal(choice, target, {
			live: async () => { sessions.allowUnlockAgain(); return (await sessions.list()).computers.flatMap(c => c.sessions); },
			// The ordinary terminal-first open, exactly as a session tap inside the app.
			// Leaving while discovery runs cancels the open: nothing replaces Inicio afterwards.
			open: id => { if (!left.current) router.replace({ pathname: "/session/open/[id]", params: { id } }); },
			home,
		}).then(result => { if (result === "gone" && !left.current) setPhase("gone"); });
	};

	return <LinkTerminalView phase={phase} computer={computer} t={t} theme={theme}
		onOpen={() => answer("open")} onCancel={() => answer("cancel")} onHome={home} />;
}
