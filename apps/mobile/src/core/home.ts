import type { SavedHost } from "./host-catalog";
import type { SessionGroups } from "./session-list";

/** Home adds presentation sections without changing the live session queue or its reserved slots. */
export function buildHome(hosts: Pick<SavedHost, "id" | "name">[], groups: SessionGroups) {
	const names = new Map(hosts.map(host => [host.id, host.name]));
	return {
		kind: hosts.length === 0 ? "welcome" as const : "dashboard" as const,
		needsYou: groups.needsYou.map(session => ({ ...session, computerName: names.get(session.hostId) ?? "" })),
		computers: groups.computers.map(computer => ({
			...computer,
			name: names.get(computer.hostId) ?? "",
			status: computer.state === "ok" || computer.state === "no-pi" ? "responding" as const : computer.state,
		})),
		emptySessions: groups.needsYou.length === 0 && groups.computers.every(computer => computer.sessions.length === 0),
	};
}
