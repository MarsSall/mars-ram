import { isValidElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

// Ajustes ordered with the frequent things on top (S9).
const push = vi.hoisted(() => vi.fn());
const prefs = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
(globalThis as { __DEV__?: boolean }).__DEV__ = true;

vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), useState: (value: unknown) => [value, () => {}] }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push }) }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.0.0" } } }));
vi.mock("react-native", () => ({ Alert: {}, Linking: {}, Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", Switch: "Switch", Text: "Text", TextInput: "TextInput", View: "View" }));
vi.mock("../src/services", () => ({ appBuild: { version: "1.0.0", build: 7 }, startTour: vi.fn() }));
vi.mock("../src/ui/app-update-notice", () => ({ AppUpdateNotice: "AppUpdateNotice" }));
vi.mock("../src/ui/gift-code-dialog", () => ({ GiftCodeDialog: "GiftCodeDialog" }));
vi.mock("../src/ui/notification-settings", () => ({ NotificationSettingsCard: "NotificationSettingsCard" }));
vi.mock("../src/ui/components", () => ({ Card: "Card", Screen: "Screen", SectionTitle: "SectionTitle", Segmented: "Segmented" }));
vi.mock("../src/ui/tour/anchors", () => ({ TourAnchor: "TourAnchor" }));
vi.mock("../src/ui/tour/scroll", () => ({ useTourScroll: () => ({ props: {}, place: (id: string) => `place:${id}` }) }));
vi.mock("../src/ui/preferences", () => ({ usePreferences: () => prefs.value }));

const { default: SettingsScreen } = await import("../src/app/(tabs)/settings");

type Node = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Node[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
const texts = (nodes: Node[]) => nodes.filter(n => n.type === "Text").flatMap(n => [n.props.children].flat()).filter(value => typeof value === "string");
const theme = { name: "verde-profundo", spacing: (n: number) => n * 4, touch: 48, radius: { small: 6, medium: 8 }, colors: {} };

beforeEach(() => { push.mockClear(); prefs.value = { t: es, theme, language: "es" }; });

// The top-level blocks of the scroll view, in order, each named by what identifies it.
function blocks(t: typeof es) {
 prefs.value = { ...prefs.value, t };
 const view = elements(SettingsScreen());
 const scroll = view.find(n => n.type === "ScrollView")!;
 return [scroll.props.children].flat().filter(isValidElement).map(child => {
  const node = child as unknown as Node;
  if (node.type === "TourAnchor") return `anchor:${node.props.id}`;
  if (node.type === "Card") return `card:${texts(elements(node.props.children))[0]}`;
  if (node.type === "SectionTitle") return `title:${node.props.children}`;
  return String(node.type);
 });
}

it("shows exactly Personalización, Notificaciones, Más ajustes and a compact Acerca de, in that order", () => {
 expect(blocks(es)).toEqual([
  "card:Personalización", "anchor:settings.notifications", "card:Más ajustes",
  "title:Acerca de", "AppUpdateNotice", "anchor:settings.about", "GiftCodeDialog",
 ]);
 expect(blocks(en)).toEqual([
  "card:Personalization", "anchor:settings.notifications", "card:More settings",
  "title:About", "AppUpdateNotice", "anchor:settings.about", "GiftCodeDialog",
 ]);
});

it("summarizes what each row opens, in both languages", () => {
 for (const [t, personal, more] of [[es, "Tema, idioma, letra, teclas", "Adjuntos, dictado, seguridad"], [en, "Theme, language, font, keys", "Attachments, dictation, security"]] as const) {
  prefs.value = { ...prefs.value, t };
  const cards = elements(SettingsScreen()).filter(n => n.type === "Card" && n.props.onPress);
  expect(cards.map(card => texts(elements(card.props.children)))).toEqual([[t.settings.personalization, personal, "›"], [t.settings.more, more, "›"]]);
 }
});

it("«Más ajustes» opens its own screen", () => {
 const row = elements(SettingsScreen()).find(n => n.type === "Card" && texts(elements(n.props.children))[0] === es.settings.more)!;
 row.props.onPress();
 expect(push).toHaveBeenCalledWith("/more-settings");
});

it("keeps only version, Novedades and Ver tutorial in Acerca de; the moved parts are gone, even in development", () => {
 const view = elements(SettingsScreen());
 const about = view.find(n => n.type === "TourAnchor" && n.props.id === "settings.about")!;
 expect(about.props.onLayout).toBe("place:settings.about");
 expect(texts(elements(about.props.children))).toEqual([es.settings.version, "1.0.0", es.whatsNew.open, es.tour.open]);
 expect(view.find(n => n.type === "TourAnchor" && n.props.id === "settings.notifications")!.props.onLayout).toBe("place:settings.notifications");
 const all = texts(view);
 for (const gone of [es.settings.build, es.settings.privacy, es.settings.source, es.settings.language, es.settings.security, es.attachments.title, es.settings.prototype, es.settings.developer, es.keySecurity.label]) expect(all).not.toContain(gone);
 expect(view.some(n => n.type === "Segmented" || n.type === "Switch")).toBe(false);
 expect(view.filter(n => n.type === "SectionTitle").map(n => n.props.children)).toEqual([es.settings.about]);
 expect(view.some(n => typeof n.type === "function" && ["DictationSettings", "SecretFilesSetting"].includes((n.type as { name: string }).name))).toBe(false);
});
