// The saved computers with whether each one answers, refreshed whenever the screen comes into view.
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import type { SavedHost } from "../core/host-catalog";
import type { Reachability } from "../core/reachability";
import { catalog, reachability, hostUpdates } from "../services";
import type { HostUpdate } from '../core/host-update';

export type HostRow = { host: SavedHost; status: Reachability | "checking"; update?: HostUpdate };

export function useHosts(): { rows: HostRow[] | null; reload: () => void } {
	const [rows, setRows] = useState<HostRow[] | null>(null);
	const [version, setVersion] = useState(0);
	useFocusEffect(
		useCallback(() => {
			let active = true;
			void catalog.list().then((hosts) => {
				if (!active) return;
				hostUpdates.retain(hosts.map(h => h.id));
				setRows(hosts.map((host) => ({ host, status: "checking", update: hostUpdates.cached(host.id) })));
				for (const host of hosts) {
					void reachability(host).then((status) => {
						if (active) setRows((current) => current?.map((row) => (row.host.id === host.id ? { ...row, status } : row)) ?? null);
						if (active && status === 'reachable') void hostUpdates.check(host).then(update => {
							if (active) setRows(current => current?.map(row => row.host.id === host.id ? { ...row, update } : row) ?? null);
						});
					});
				}
			});
			return () => {
				active = false;
			};
		}, [version]),
	);
	return { rows, reload: () => setVersion((v) => v + 1) };
}
