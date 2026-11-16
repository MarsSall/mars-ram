import { isValidElement } from "react";
import { expect, it, vi } from "vitest";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

const startTour = vi.fn();
const push = vi.fn();
const language = vi.hoisted(() => ({ t: null as unknown }));
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), useState: (value: unknown) => [value, () => {}] }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push }) }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.0.0" } } }));
vi.mock("expo-localization", () => ({ getLocales: () => [] }));
vi.mock("react-native", () => ({ Alert: {}, Linking: {}, Pressable: "Pressable", ScrollView: "ScrollView", Switch: "Switch", Text: "Text", View: "View" }));
vi.mock("../src/services", () => ({ appBuild: { version: "1.0.0", build: 7 }, startTour: () => startTour() }));
vi.mock("../src/ui/app-update-notice", () => ({ AppUpdateNotice: "AppUpdateNotice" }));
vi.mock("../src/ui/key-security", () => ({ securityRow: () => ({}) }));
vi.mock("../src/ui/dictation-settings", () => ({ DictationSettings: "DictationSettings" }));
vi.mock("../src/ui/notification-settings", () => ({ NotificationSettingsCard: "NotificationSettingsCard" }));
vi.mock("../src/ui/secret-files-setting", () => ({ SecretFilesSetting: "SecretFilesSetting" }));
vi.mock("../src/ui/terminal-font-settings", () => ({ TerminalFontSettings: "TerminalFontSettings" }));
vi.mock("../src/ui/terminal-keys-entry", () => ({ TerminalKeysEntry: "TerminalKeysEntry" }));
vi.mock("../src/ui/use-key-security", () => ({ useKeySecurity: () => ({ status: null, error: null, stale: false, busy: false }) }));
vi.mock("../src/ui/components", () => ({ Card: "Card", Screen: "Screen", SectionTitle: "SectionTitle", Segmented: "Segmented" }));
vi.mock("../src/ui/tour/anchors", () => ({ TourAnchor: "TourAnchor" }));
vi.mock("../src/ui/tour/scroll", () => ({ useTourScroll: () => ({ props: { onScroll: "remeasure" }, place: (id: string) => `place:${id}` }) }));
vi.mock("../src/ui/preferences", () => ({
 usePreferences: () => ({ t: language.t, theme: { name: "verde-profundo", spacing: (n: number) => n * 4, touch: 48, radius: { medium: 8 }, colors: {} }, language: "es", retention: 7 }),
}));

const { default: SettingsScreen } = await import("../src/app/(tabs)/settings");

type Node = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Node[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
const anchor = (nodes: Node[], id: string) => nodes.find(n => n.type === "TourAnchor" && n.props.id === id);
const label = (node: Node) => elements(node.props.children).filter(n => n.type === "Text").map(n => n.props.children).join("");

function about(t: typeof es) {
 language.t = t;
 const view = elements(SettingsScreen());
 const card = anchor(view, "settings.about")!;
 return { view, card, links: elements(card.props.children).filter(n => n.type === "Pressable") };
}

it("puts «Ver tutorial» right after «Novedades» in Acerca de, styled the same", () => {
 const { links } = about(es);
 const names = links.map(label);
 expect(names.indexOf(es.tour.open)).toBe(names.indexOf(es.whatsNew.open) + 1);
 const [news, tutorial] = [links[names.indexOf(es.whatsNew.open)], links[names.indexOf(es.tour.open)]];
 expect(tutorial.props.accessibilityRole).toBe(news.props.accessibilityRole);
 expect(tutorial.props.style).toEqual(news.props.style);
 expect(elements(tutorial.props.children)[0].props.style).toEqual(elements(news.props.children)[0].props.style);
});

it("«Ver tutorial» always starts the tour", () => {
 const { links } = about(es);
 links.find(n => label(n) === es.tour.open)!.props.onPress();
 links.find(n => label(n) === es.tour.open)!.props.onPress();
 expect(startTour).toHaveBeenCalledTimes(2);
 expect(push).not.toHaveBeenCalled();
});

it("says «Show tutorial» in English", () => {
 expect(about(en).links.map(label)).toContain("Show tutorial");
 expect(es.tour.open).toBe("Ver tutorial");
});

it("marks the Notificaciones card and the Acerca de card, scrolling to them when their step comes", () => {
 const { view, card } = about(es);
 const notifications = anchor(view, "settings.notifications")!;
 expect(elements(notifications.props.children).some(n => n.type === "NotificationSettingsCard")).toBe(true);
 expect(notifications.props.onLayout).toBe("place:settings.notifications");
 expect(card.props.onLayout).toBe("place:settings.about");
 expect(view.find(n => n.type === "ScrollView")!.props.onScroll).toBe("remeasure");
});
