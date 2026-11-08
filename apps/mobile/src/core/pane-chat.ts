// R2/R7: bind chat only to live bridge evidence on this computer.
import type { HerdrSnapshot } from "./herdr-switcher";
import type { SessionSummary } from "./session-list";

/** undefined: pane metadata unavailable (legacy CLI); null: known but ambiguous/empty focus. */
export type FocusedHerdrPane = string | null | undefined;

export function focusedHerdrPane(snapshot: HerdrSnapshot): FocusedHerdrPane {
 if (!snapshot.workspaces.some(w => w.tabs.some(t => t.panes !== undefined))) return undefined;
 const workspaces = snapshot.workspaces.filter(w => w.focused);
 const tabs = workspaces.length === 1 ? workspaces[0].tabs.filter(t => t.focused) : [];
 const panes = tabs.length === 1 ? tabs[0].panes : undefined;
 const focused = panes?.filter(p => p.focused) ?? [];
 if (focused.length === 1) return focused[0].id;
 return focused.length === 0 && panes?.length === 1 ? panes[0].id : null;
}

export function chatSessionForPane(hostId: string, pane: string | undefined, sessions: readonly SessionSummary[]): SessionSummary | undefined {
 if (!pane) return undefined;
 return sessions.find(s => s.hostId === hostId && s.terminalPane === pane);
}

export function terminalChatSession(hostId: string, routeKey: string | undefined, pane: FocusedHerdrPane, sessions: readonly SessionSummary[]): string | undefined {
 // Unavailable metadata keeps legacy route binding. Ambiguity is not absence.
 if (pane === undefined) return routeKey;
 const matched = chatSessionForPane(hostId, pane ?? undefined, sessions);
 if (matched) return matched.key;
 // A live route session whose older bridge reports no pane cannot be placed; keep it as today.
 const route = sessions.find(s => s.key === routeKey && s.hostId === hostId);
 return route && route.terminalPane === undefined ? route.key : undefined;
}

export type PaneChatBinding = {
 hostId: string;
 routeKey: string | undefined;
 key: string | undefined;
 session?: SessionSummary;
};

/** Never expose a previous route's cached session while its replacement is loading. */
export function currentPaneChatBinding(binding: PaneChatBinding | null, hostId: string, routeKey: string | undefined): Pick<PaneChatBinding, "key" | "session"> {
 return binding?.hostId === hostId && binding.routeKey === routeKey ? binding : { key: routeKey };
}

/** Route metadata belongs only to its original session, not to another mapped pane. */
export function fullChatMetadata(key: string, routeKey: string | undefined, session: SessionSummary | undefined, route: { project?: string; cwd?: string }): { project?: string; cwd?: string } {
 if (key === routeKey) return { project: route.project, cwd: route.cwd };
 return session?.key === key ? { project: session.project, cwd: session.cwd } : {};
}
