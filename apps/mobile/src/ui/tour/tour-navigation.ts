// Which screen each tour step shows, decided from the current route. Pure; the tour host performs it.
import type { TourPresentation, TourSession, TourStep } from "../../core/tour";

type TabRoute = NonNullable<TourStep["route"]>;
export const TAB_ROUTES: readonly string[] = ["/", "/computers", "/files", "/settings"] satisfies TabRoute[];
const TERMINAL = "/session/terminal/";

/** leave: a screen above the tabs (a computer, the terminal) is open and goes away first. */
export type TourNavigation = { kind: "stay" } | { kind: "tab"; route: TabRoute; leave: boolean } | { kind: "terminal"; session: TourSession };

export function tourNavigation(presentation: TourPresentation | null, pathname: string, session: TourSession | null): TourNavigation {
 if (!presentation) return { kind: "stay" };
 // Explain-only steps open nothing and show Inicio. Always navigate: the tab tapped on the step
 // before may not have reached the pathname yet, and going to the current tab does nothing.
 if (presentation.mode === "explain") return { kind: "tab", route: "/", leave: !TAB_ROUTES.includes(pathname) };
 if (presentation.screen === "terminal") return session && !pathname.startsWith(TERMINAL) ? { kind: "terminal", session } : { kind: "stay" };
 const route = presentation.step.route;
 if (!route || pathname === route) return { kind: "stay" };
 return { kind: "tab", route, leave: !TAB_ROUTES.includes(pathname) };
}

/** When the tour ends («Saltar recorrido», back, «Empezar»): back to Inicio only from the terminal the tour itself opened. */
export function tourEndNavigation(openedTerminal: boolean, pathname: string): TourNavigation {
 return openedTerminal && pathname.startsWith(TERMINAL) ? { kind: "tab", route: "/", leave: true } : { kind: "stay" };
}

/** The same route params as opening the terminal from the session screen. */
export const terminalParams = (session: TourSession) => ({ id: session.key, project: session.project, cwd: session.cwd, computer: session.computer });
