// Follows one session while its screen is open.
import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { AppState } from "react-native";
import type { ActionResult, LiveSession, LiveView } from "../core/live-session";
import type { Attachment } from "../core/attachment-draft";
import type { UploadProgress } from "../core/attachment-uploads";
import { sessions } from "../services";

export function useLiveSession(key: string | undefined): { view: LiveView | null; send: (text: string, attachments?: readonly Attachment[], progress?: UploadProgress) => Promise<ActionResult>; stop: () => Promise<ActionResult> } {
	const [view, setView] = useState<LiveView | null>(null);
	const live = useRef<LiveSession | null>(null);

	// Chat and terminal release their stream on blur, so stacked screens never
	// compete for the same bridge. Foregrounding always obtains a fresh snapshot.
	useFocusEffect(useCallback(() => {
		const activate = (active: boolean) => {
			if (!active) {
				live.current?.dispose();
				live.current = null;
				setView(null);
			} else if (key && !live.current) {
				const session = sessions.follow(key);
				live.current = session;
				session.subscribe(setView);
				session.start();
			}
		};
		activate(AppState.currentState === "active");
		const subscription = AppState.addEventListener("change", state => activate(state === "active"));
		return () => { subscription.remove(); activate(false); };
	}, [key]));

	const notReady: ActionResult = { ok: false, message: "The session is not connected." };
	return {
		view,
		send: (text, attachments, progress) => live.current?.send(text, attachments, progress) ?? Promise.resolve(notReady),
		stop: () => live.current?.requestStop() ?? Promise.resolve(notReady),
	};
}
