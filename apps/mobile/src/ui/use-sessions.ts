// The live sessions of every saved computer, refreshed every few seconds while the screen is in view.
// Gaining focus refreshes in the background (the current list stays), unless the last refresh finished
// less than ~10 s ago; never two listings at once (claude-codex L19).
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import type { HostUpdate } from '../core/host-update';
import { latestRequestGate } from "../core/latest-request";
import type { SavedHost } from "../core/host-catalog";
import type { ComputerSessions } from "../core/session-list";
import { SessionRefresh } from "../core/session-refresh";
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
		if (!active.current || !gate.isLatest(ticket)) return false;
		setData({ ...result, updatedAt: Date.now() });
		return true;
	}, [gate]);
	// One per screen; `load` reads only refs, so the first one stays valid.
	const runner = useRef<SessionRefresh | null>(null);
	runner.current ??= new SessionRefresh({ load, clock: Date.now });
	const refresher = runner.current;

	useFocusEffect(
		useCallback(() => {
			active.current = true;
			void refresher.request("focus").catch(() => {});
			const timer = setInterval(() => void refresher.request("interval").catch(() => {}), REFRESH_MS);
			return () => {
				active.current = false;
				clearInterval(timer);
			};
		}, [refresher]),
	);

	const refresh = useCallback(() => {
		// A refresh by hand may ask to unlock again after a cancel.
		sessions.allowUnlockAgain();
		setRefreshing(true);
		void refresher.request("manual").catch(() => {}).finally(() => setRefreshing(false));
	}, [refresher]);

	return { data, refreshing, refresh };
}
