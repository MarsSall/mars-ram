import { isValidElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const router = { navigate: vi.fn(), push: vi.fn(), dismissAll: vi.fn(), canDismiss: vi.fn(() => true) };
const route = vi.hoisted(() => ({ path: "/" }));

vi.mock("react", async (original) => ({
 ...(await original<typeof import("react")>()),
 useEffect: (effect: () => void) => { effect(); },
 useCallback: (fn: unknown) => fn,
 useRef: (value: unknown) => ({ current: value }),
 useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("expo-router", () => ({ Stack: "Stack", useRouter: () => router, usePathname: () => route.path }));
vi.mock("expo-status-bar", () => ({ StatusBar: "StatusBar" }));
const back = vi.hoisted(() => ({ handlers: [] as (() => boolean)[] }));
vi.mock("react-native", () => ({
 AppState: { addEventListener: () => ({ remove() {} }) }, View: "View",
 BackHandler: { addEventListener: (_event: string, handler: () => boolean) => { back.handlers.push(handler); return { remove() { back.handlers.splice(back.handlers.indexOf(handler), 1); } }; } },
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaProvider: "SafeAreaProvider" }));
vi.mock("../src/ui/preferences", () => ({ PreferencesProvider: "PreferencesProvider", usePreferences: () => ({ t: { add: { unlockTitle: "" } }, theme: { colors: {} }, locale: "es" }) }));
vi.mock("../src/ui/whats-new", () => ({ WhatsNewGate: "WhatsNewGate" }));
vi.mock("../src/ui/tour/coach-mark", () => ({ CoachMark: "CoachMark" }));
vi.mock("../src/ui/tour/anchors", () => ({ TourAnchorsProvider: "TourAnchorsProvider" }));
vi.mock("../src/ui/tour/tips", () => ({ TipLayer: "TipLayer" }));
vi.mock("../src/services", async () => {
 const { AppTour } = await import("../src/core/tour");
 const done = () => Promise.resolve();
 return {
  appTour: new AppTour({ store: { read: async () => ({ kind: "none" }), write: done } }),
  appUpdates: { start: done }, notifications: { ensureWatching: done }, notificationSystem: { setLanguage: done }, setUnlockTitle: () => {},
 };
});

const { appTour } = await import("../src/services");
const { TourHost, tourAnchors } = await import("../src/ui/tour/tour-host");
const { default: RootLayout } = await import("../src/app/_layout");
const { ROOT_TIPS } = await import("../src/ui/tour/tip-gate");

type Node = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Node[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
const coach = () => elements(TourHost()).find(n => n.type === "CoachMark");
const session = { key: "mini/api", project: "api", cwd: "/home/alex/api", computer: "devbox" };

beforeEach(() => { vi.useFakeTimers(); route.path = "/"; back.handlers.length = 0; });
afterEach(async () => { await appTour.skip(); vi.clearAllMocks(); vi.useRealTimers(); });

it("shows nothing and moves nowhere while no tour runs", () => {
 expect(TourHost()).toBeNull();
 expect(router.navigate).not.toHaveBeenCalled();
});

it("shows the current step over the screens and goes to its tab, leaving the screen opened after pairing", () => {
 route.path = "/computer/mini";
 appTour.start({ hasSession: false });
 const mark = coach()!;
 expect(mark.props).toMatchObject({ variant: "tour", presentation: { number: 1 } });
 expect(router.dismissAll).toHaveBeenCalled();
 expect(router.navigate).toHaveBeenCalledWith("/");
});

it("opens the session's terminal for steps 3-4 and advances when the real control is tapped", async () => {
 await appTour.begin(async () => session);
 route.path = "/files";
 await appTour.advance(); await appTour.advance();
 const mark = coach()!;
 expect(mark.props.presentation).toMatchObject({ number: 3, anchor: "terminal.project" });
 expect(router.push).toHaveBeenCalledWith({ pathname: "/session/terminal/[id]", params: { id: "mini/api", project: "api", cwd: "/home/alex/api", computer: "devbox" } });
 mark.props.onTarget();
 expect(appTour.current()).toMatchObject({ number: 4 });
});

it("explains steps 3-4 on Inicio without opening anything when there is no session", async () => {
 await appTour.begin(async () => null);
 route.path = "/settings";
 await appTour.advance(); await appTour.advance();
 router.navigate.mockClear();
 expect(coach()!.props.presentation).toMatchObject({ number: 3, mode: "explain" });
 expect(router.push).not.toHaveBeenCalled();
 expect(router.navigate).toHaveBeenCalledWith("/");
});

it("adds Inicio's «Abrir terminal» step when its tile is registered as the tour starts", () => {
 const off = tourAnchors.register("home.openTerminal", done => done({ x: 10, y: 120, width: 340, height: 64 }));
 appTour.start({ hasSession: false });
 off();
 void appTour.advance();
 expect(coach()!.props.presentation).toMatchObject({ number: 2, total: 10, anchor: "home.openTerminal" });
});

it("measures the targets again once a screen has had time to settle", () => {
 const measure = vi.spyOn(tourAnchors, "measure");
 appTour.start({ hasSession: false });
 coach();
 vi.runAllTimers();
 expect(measure).toHaveBeenCalled();
});

it("«Saltar recorrido» ends it", async () => {
 appTour.start({ hasSession: false });
 coach()!.props.onSkip();
 await Promise.resolve();
 expect(appTour.isRunning()).toBe(false);
});

it("«Saltar recorrido» in the terminal the tour opened returns to Inicio", async () => {
 await appTour.begin(async () => session);
 await appTour.advance(); await appTour.advance();
 coach();
 route.path = "/session/terminal/mini%2Fapi";
 router.navigate.mockClear();
 await appTour.skip();
 expect(TourHost()).toBeNull();
 expect(router.dismissAll).toHaveBeenCalled();
 expect(router.navigate).toHaveBeenCalledWith("/");
});

it("«Saltar recorrido» elsewhere leaves the user where they are, also after the tour left its terminal", async () => {
 await appTour.begin(async () => session);
 await appTour.advance(); await appTour.advance();
 coach();
 route.path = "/files";
 await appTour.advance(); await appTour.advance(); await appTour.advance();
 coach();
 router.navigate.mockClear(); router.dismissAll.mockClear();
 await appTour.skip();
 TourHost();
 expect(router.navigate).not.toHaveBeenCalled();
 expect(router.dismissAll).not.toHaveBeenCalled();
});

it("finishing on step 9 stays in Inicio", async () => {
 appTour.start({ hasSession: false });
 for (let i = 0; i < 8; i++) await appTour.advance();
 coach();
 route.path = "/";
 router.navigate.mockClear(); router.dismissAll.mockClear();
 await appTour.advance();
 expect(appTour.isRunning()).toBe(false);
 TourHost();
 expect(router.navigate).not.toHaveBeenCalled();
 expect(router.dismissAll).not.toHaveBeenCalled();
});

it("Android back while the tour runs ends it like «Saltar recorrido» and is consumed", async () => {
 await appTour.begin(async () => session);
 await appTour.advance(); await appTour.advance();
 coach();
 route.path = "/session/terminal/mini%2Fapi";
 router.navigate.mockClear();
 expect(back.handlers.at(-1)!()).toBe(true);
 await Promise.resolve(); await Promise.resolve();
 expect(appTour.isRunning()).toBe(false);
 TourHost();
 expect(router.navigate).toHaveBeenCalledWith("/");
 // Once it ended, back goes back to the screens again.
 expect(back.handlers.map(handler => handler())).not.toContain(true);
});

it("mounts the tips over the screens, below the tour", () => {
 const root = elements(RootLayout());
 const provider = root.find(n => n.type === "TourAnchorsProvider")!;
 const stack = elements(provider.props.children).find(n => typeof n.type === "function")!;
 const inside = elements((stack.type as () => unknown)());
 const order = inside.map(n => n.type);
 const layer = inside.find(n => n.type === "TipLayer")!;
 expect(layer.props.tips).toBe(ROOT_TIPS);
 expect(ROOT_TIPS).toEqual(["terminal", "chatFloating", "projectSheet", "keyBarTab", "approval"]);
 expect(order.indexOf("TipLayer")).toBeGreaterThan(order.indexOf("Stack"));
 expect(order.indexOf("TipLayer")).toBeLessThan(order.indexOf(TourHost));
});

it("mounts the anchors around the whole app and the tour above every screen, outside any Modal", () => {
 const root = elements(RootLayout());
 const provider = root.find(n => n.type === "TourAnchorsProvider")!;
 expect(provider.props.registry).toBe(tourAnchors);
 const stack = elements(provider.props.children).find(n => typeof n.type === "function")!;
 const inside = elements((stack.type as () => unknown)());
 const order = inside.map(n => n.type);
 expect(order.indexOf(TourHost)).toBeGreaterThan(order.indexOf("Stack"));
 expect(order).not.toContain("Modal");
});
