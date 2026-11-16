// What the terminal screen runs for its route. No platform dependencies.
export type TerminalRoute = { id: string; standalone?: string; shell?: string; focusWorkspace?: string; focusTab?: string };
export type TerminalScreenPlan = {
 hostId: string;
 routeSessionKey: string | undefined;
 shell: boolean;
 /** Herdr pane and Pi session discovery for the floating chat. */
 paneChat: boolean;
 routeFocus: { workspace: string; tab: string | undefined } | null;
 /** A plain shell cannot be kept like a Herdr session: leaving the screen ends it. */
 closeOnBlur: boolean;
};

export function terminalScreenPlan(route: TerminalRoute): TerminalScreenPlan {
 const standalone = route.standalone === "1";
 const shell = standalone && route.shell === "1";
 return {
  hostId: standalone ? route.id : route.id.split("/")[0],
  routeSessionKey: standalone ? undefined : route.id,
  shell,
  paneChat: !shell,
  routeFocus: !shell && route.focusWorkspace ? { workspace: route.focusWorkspace, tab: route.focusTab } : null,
  closeOnBlur: shell,
 };
}
