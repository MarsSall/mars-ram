// The live sessions of every saved computer, refreshed every few seconds while the screen is in view.
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import type { HostUpdate } from '../core/host-update';
import { latestRequestGate } from "../core/latest-request";
import type { SavedHost } from "../core/host-catalog";
import type { ComputerSessions } from "../core/session-list";
import { sessions } from "../services";

const REFRESH_MS = 10_000;

export type SessionsData = { hosts: SavedHost[]; computers: ComputerSessions[]; updates: Record<string, HostUpdate>; updatedAt: number };

export function useSessions(): { data: SessionsData | null; refreshing: boolean; refresh: () => void } {
	const [data, setData] = useState<SessionsData | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const active = useRef(false);
	const gate = useRef(latestRequestGate()).current;

	const load = useCallback(async () => {
		const ticket = gate.begin();
		const result = await sessions.list();
		// A slower, older refresh must not overwrite a newer one (for example a computer now unreachable).
		if (active.current && gate.isLatest(ticket)) setData({ ...result, updatedAt: Date.now() });
	}, [gate]);

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
