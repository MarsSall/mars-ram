import { readFileSync } from "node:fs";
import { isValidElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { es } from "../src/ui/i18n/es";

const state = vi.hoisted(() => ({ sessions: null as unknown, links: null as unknown }));

vi.mock("react", async (original) => ({
 ...(await original<typeof import("react")>()),
 useState: (value: unknown) => [typeof value === "function" ? (value as () => unknown)() : value, () => {}],
 useRef: (value: unknown) => ({ current: value }),
 useEffect: () => {},
 useCallback: (fn: unknown) => fn,
}));
const Tabs = Object.assign(() => null, { Screen: "Tabs.Screen" });
vi.mock("expo-router", () => ({ Tabs, useRouter: () => ({ push: vi.fn() }), useFocusEffect: () => {} }));
vi.mock("expo-router/js-tabs", () => ({ BottomTabBar: "BottomTabBar" }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock("react-native", () => ({ ActivityIndicator: "ActivityIndicator", Alert: {}, Modal: "Modal", Pressable: "Pressable", RefreshControl: "RefreshControl", ScrollView: "ScrollView", Text: "Text", View: "View" }));
vi.mock("../src/ui/components", () => ({ Card: "Card", EmptyState: "EmptyState", PrimaryButton: "PrimaryButton", Screen: "Screen", SectionTitle: "SectionTitle", StatusPill: "StatusPill" }));
vi.mock("../src/ui/tour/anchors", () => ({ TourAnchor: "TourAnchor" }));
vi.mock("../src/ui/tour/scroll", () => ({ useTourScroll: () => ({ props: { onScroll: "remeasure" }, place: (id: string) => `place:${id}` }) }));
vi.mock("../src/ui/preferences", async () => {
 const { es } = await import("../src/ui/i18n/es");
 return { usePreferences: () => ({ t: es, theme: { spacing: (n: number) => n * 4, touch: 48, radius: { small: 4, medium: 8, large: 16 }, font: { mono: "mono" }, colors: {} } }) };
});
vi.mock("../src/ui/use-sessions", () => ({ useSessions: () => ({ data: state.sessions, refreshing: false, refresh: vi.fn() }) }));
vi.mock("../src/ui/use-phone-network-state", () => ({ usePhoneNetworkState: () => null }));
vi.mock("../src/ui/network-hint", () => ({ networkHintText: () => null }));
vi.mock("../src/ui/home-welcome", () => ({ HomeHeading: "HomeHeading", HomeWelcome: "HomeWelcome" }));
vi.mock("../src/ui/format", () => ({ formatTime: () => "12:00", formatDateTime: () => "", timeAgo: () => ({ unit: "now", n: 0 }) }));
vi.mock("../src/ui/shortcuts", () => ({ ShortcutsSection: "ShortcutsSection" }));
vi.mock("../src/ui/host-update-notice", () => ({ HostUpdateNotice: "HostUpdateNotice" }));
vi.mock("../src/ui/app-update-notice", () => ({ AppUpdateNotice: "AppUpdateNotice" }));
vi.mock("../src/ui/terminal-launcher", () => ({ TerminalLauncher: "TerminalLauncher" }));
vi.mock("../src/ui/use-hosts", () => ({ useHosts: () => ({ rows: [] }) }));
vi.mock("../src/ui/private-links", () => ({ linkDisplayName: (n: string) => n, linkRow: () => ({}), linkSize: () => "" }));
vi.mock("../src/ui/use-private-links", () => ({ usePrivateLinks: () => state.links }));

const { default: TabsLayout } = await import("../src/app/(tabs)/_layout");
const { default: HomeScreen } = await import("../src/app/(tabs)/index");
const { default: ComputersScreen } = await import("../src/app/(tabs)/computers");
const { default: FilesScreen } = await import("../src/app/(tabs)/files");

type Node = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Node[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
const anchor = (nodes: Node[], id: string) => nodes.find(n => n.type === "TourAnchor" && n.props.id === id);

const host = { id: "mini", name: "devbox", user: "mars", address: "100.64.0.1" };
beforeEach(() => {
 state.sessions = { hosts: [host], computers: [{ hostId: "mini", state: "ok", sessions: [] }], updates: {}, updatedAt: 0 };
 state.links = { hosts: [host], selected: "mini", groups: [], candidates: [], busy: null, refreshing: false, error: null, copied: false, now: 0, reload: vi.fn() };
});

it("marks the whole tab bar, keeping the real tab bar inside so tabs still navigate", () => {
 const tabs = elements(TabsLayout()).find(n => n.type === Tabs)!;
 const props = { state: {}, navigation: {} };
 const bar = elements(tabs.props.tabBar(props));
 expect(bar[0]).toMatchObject({ type: "TourAnchor", props: { id: "tabs.bar" } });
 expect(bar.find(n => n.type === "BottomTabBar")!.props).toMatchObject(props);
});

it("marks Inicio's sessions area, also when there are no sessions yet", () => {
 const area = anchor(elements(HomeScreen()), "home.sessions")!;
 expect(area).toBeDefined();
 const inside = elements(area.props.children);
 expect(inside.find(n => n.type === "SectionTitle")!.props.children).toBe(es.home.activeSessions);
 expect(inside.find(n => n.type === "EmptyState")!.props.message).toBe(es.home.empty);
});

it("keeps the sessions area marked while Inicio loads, and remeasures it when scrolled", () => {
 state.sessions = null;
 const view = elements(HomeScreen());
 const area = anchor(view, "home.sessions")!;
 expect(elements(area.props.children).find(n => n.type === "EmptyState")!.props.message).toBe(es.sessions.loading);
 expect(view.find(n => n.type === "ScrollView")!.props.onScroll).toBe("remeasure");
});

it("marks «+ Agregar computadora» in Computadoras", () => {
 const screen = elements(ComputersScreen()).find(n => n.type === "Screen")!;
 const add = anchor(elements(screen.props.headerRight), "computers.add")!;
 expect(elements(add.props.children).find(n => n.type === "Pressable")!.props.accessibilityLabel).toBe(es.computers.add);
});

it("marks «Crear link» in Archivos", () => {
 const view = elements(FilesScreen());
 const create = anchor(view, "files.createLink")!;
 expect(elements(create.props.children).find(n => n.type === "PrimaryButton")!.props.label).toBe(es.files.create);
 expect(view.find(n => n.type === "ScrollView")!.props.onScroll).toBe("remeasure");
});

it("marks the terminal's «Archivos y Git del proyecto» button and the session selector header", () => {
 const screen = readFileSync(new URL("../src/app/session/terminal/[id].tsx", import.meta.url), "utf8");
 expect(screen).toMatch(/<TourAnchor id="terminal\.project"[^>]*>\s*<Pressable[^\n]*accessibilityLabel=\{t\.project\.open\}/);
 expect(screen).toMatch(/<TourAnchor id="terminal\.selector"[^>]*>\s*<Pressable[^\n]*accessibilityLabel=\{`\$\{computerName\} · \$\{s\.switchSession\}`\}/);
});
