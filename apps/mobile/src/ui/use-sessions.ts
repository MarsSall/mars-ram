// The live sessions of every saved computer, refreshed every few seconds while the screen is in view.
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import type { SavedHost } from "../core/host-catalog";
import type { ComputerSessions } from "../core/session-list";
import { sessions } from "../services";

const REFRESH_MS = 10_000;

export type SessionsData = { hosts: SavedHost[]; computers: ComputerSessions[]; updatedAt: number };

export function useSessions(): { data: SessionsData | null; refreshing: boolean; refresh: () => void } {
	const [data, setData] = useState<SessionsData | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const active = useRef(false);

	const load = useCallback(async () => {
		const result = await sessions.list();
		if (active.current) setData({ ...result, updatedAt: Date.now() });
	}, []);

	useFocusEffect(
		useCallback(() => {
			active.current = true;
			void load();
			const timer = setInterval(() => void load(), REFRESH_MS);
			return () => {
				active.current = false;
				clearInterval(timer);
			};
		}, [load]),
	);

	const refresh = useCallback(() => {
		// A refresh by hand may ask to unlock again after a cancel.
		sessions.allowUnlockAgain();
		setRefreshing(true);
		void load().finally(() => setRefreshing(false));
	}, [load]);

	return { data, refreshing, refresh };
}
