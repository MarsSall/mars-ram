import { readFileSync } from "node:fs";
import { isValidElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("react", async (original) => ({
 ...(await original<typeof import("react")>()),
 useCallback: (fn: unknown) => fn,
 useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("react-native", () => ({ View: "View", Keyboard: { addListener: () => ({ remove() {} }) } }));
vi.mock("../src/ui/tour/coach-mark", () => ({ CoachMark: "CoachMark" }));
vi.mock("../src/services", async () => {
 const { AppTour } = await import("../src/core/tour");
 const writes: unknown[] = [];
 return { writes, appTour: new AppTour({ store: { read: async () => ({ kind: "none" }), write: async (flags: unknown) => { writes.push(structuredClone(flags)); } } }) };
});

const { appTour, writes } = await import("../src/services") as unknown as { appTour: import("../src/core/tour").AppTour; writes: unknown[] };
const { TipLayer } = await import("../src/ui/tour/tips");
const { MODAL_TIPS, ROOT_TIPS, terminalTips } = await import("../src/ui/tour/tip-gate");

type Node = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Node[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

afterEach(() => { for (const id of ["terminal", "chatFloating", "projectSheet", "sessionSelector"] as const) appTour.releaseTip(id); });

it("shows the tip that was claimed with «Entendido» over the screens, and «Entendido» records it", async () => {
 expect(TipLayer({ tips: ROOT_TIPS })).toBeNull();
 expect(await appTour.claimTip("projectSheet")).toBe("shown");
 const mark = elements(TipLayer({ tips: ROOT_TIPS })).find(n => n.type === "CoachMark")!;
 expect(mark.props).toMatchObject({ variant: "tip", tip: "projectSheet" });
 await mark.props.onDone();
 expect(appTour.shownTip()).toBeNull();
 expect(writes.at(-1)).toEqual({ tourSeen: false, tips: ["projectSheet"] });
 expect(TipLayer({ tips: ROOT_TIPS })).toBeNull();
});

it("shows the session selector's tip inside its drawer, not under it", async () => {
 expect(MODAL_TIPS).toEqual(["sessionSelector"]);
 expect(await appTour.claimTip("sessionSelector")).toBe("shown");
 expect(TipLayer({ tips: ROOT_TIPS })).toBeNull();
 expect(elements(TipLayer({ tips: MODAL_TIPS })).find(n => n.type === "CoachMark")!.props).toMatchObject({ tip: "sessionSelector" });
});

it("the terminal's own tip waits while the selector, the project sheet, the chat or a server is open", () => {
 const free = { focused: true, chatOpen: false, switcherOpen: false, sheetOpen: false, serverOpen: false, modelOpen: false };
 expect(terminalTips(free)).toEqual({ terminal: true, chatFloating: false, projectSheet: false });
 for (const open of ["switcherOpen", "sheetOpen", "chatOpen", "serverOpen", "modelOpen"] as const) expect(terminalTips({ ...free, [open]: true }).terminal, open).toBe(false);
 expect(terminalTips({ ...free, focused: false })).toEqual({ terminal: false, chatFloating: false, projectSheet: false });
 expect(terminalTips({ ...free, chatOpen: true })).toEqual({ terminal: false, chatFloating: true, projectSheet: false });
 expect(terminalTips({ ...free, chatOpen: true, switcherOpen: true }).chatFloating).toBe(false);
 expect(terminalTips({ ...free, chatOpen: true, sheetOpen: true })).toEqual({ terminal: false, chatFloating: false, projectSheet: true });
 expect(terminalTips({ ...free, sheetOpen: true, switcherOpen: true }).projectSheet).toBe(false);
});

it("marks the chat handle and PREFIX in the terminal and asks for its three tips", () => {
 const screen = source("app/session/terminal/[id].tsx");
 expect(screen).toMatch(/<TourAnchor id="terminal\.chatHandle">\s*<ChatHandle state="closed"/);
 expect(screen).toMatch(/<TourAnchor id="terminal\.prefix"[^>]*>\s*<Pressable[^\n]*accessibilityLabel=\{prefixWaiting \? s\.prefixWaiting : "PREFIX"\}/);
 expect(screen).toMatch(/terminalTips\(\{ focused: screenFocused, chatOpen: chatOpen && Boolean\(sessionKey\), switcherOpen, sheetOpen: project !== null, serverOpen: serverSelection !== null, modelOpen: dictating\.needsModel \}\)/);
 for (const tip of ["terminal", "chatFloating", "projectSheet"]) expect(screen).toContain(`useFirstVisitTip("${tip}", tips.${tip})`);
});

it("marks the floating chat's box, the project sheet's tabs and the selector's first session", () => {
 expect(source("ui/floating-session-chat.tsx")).toMatch(/return <View \{\.\.\.composerAnchor\} style=\{\{ marginHorizontal: 10/);
 expect(source("ui/floating-session-chat.tsx")).toContain(`const composerAnchor = useTourAnchor("chat.composer")`);
 const sheet = source("ui/project-sheet.tsx");
 expect(sheet).toContain(`const tabsAnchor = useTourAnchor("projectSheet.tabs")`);
 expect(sheet).toMatch(/<View \{\.\.\.tabsAnchor\} accessibilityRole="tablist"/);
 const drawer = source("ui/herdr-switcher.tsx");
 expect(drawer).toContain(`useFirstVisitTip("sessionSelector", visible)`);
 expect(drawer).toContain(`workspaces.map((w, i) => card(computer, w, i === 0))`);
 expect(drawer).toContain(`{anchor ? <TourAnchor id="selector.list">{head}</TourAnchor> : head}`);
 expect(drawer).toMatch(/<TipLayer tips=\{MODAL_TIPS\} \/>\s*<\/View>\s*<\/Modal>/);
});
