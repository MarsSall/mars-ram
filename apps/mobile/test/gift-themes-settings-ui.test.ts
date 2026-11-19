import { isValidElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GiftThemeData, UnlockedGift } from "../src/core/gift-themes";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

// Minimal hook slots so a screen can be called as a function and called again to re-render.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
 ...(await original<typeof import("react")>()),
 useState: (initial: unknown) => {
  const slot = hooks.index++;
  if (!(slot in hooks.slots)) hooks.slots[slot] = typeof initial === "function" ? (initial as () => unknown)() : initial;
  return [hooks.slots[slot], (next: unknown) => { hooks.slots[slot] = typeof next === "function" ? (next as (value: unknown) => unknown)(hooks.slots[slot]) : next; }];
 },
 useRef: (initial: unknown) => { const slot = hooks.index++; if (!(slot in hooks.slots)) hooks.slots[slot] = { current: initial }; return hooks.slots[slot]; },
}));
const share = vi.hoisted(() => vi.fn(async () => ({ action: "sharedAction" })));
const prefs = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
(globalThis as { __DEV__?: boolean }).__DEV__ = false;
const router = vi.hoisted(() => ({ push: (() => {}) as (path: string) => void }));
vi.mock("expo-router", () => ({ useRouter: () => router }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.0.0" } } }));
vi.mock("expo-localization", () => ({ getLocales: () => [] }));
vi.mock("react-native", () => ({ Alert: { alert: vi.fn() }, Linking: {}, Share: { share }, KeyboardAvoidingView: "KeyboardAvoidingView", Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", StyleSheet: { hairlineWidth: 1 }, Switch: "Switch", Text: "Text", TextInput: "TextInput", View: "View" }));
vi.mock("../src/services", () => ({ appBuild: { version: "1.0.0", build: 7 }, startTour: vi.fn() }));
vi.mock("../src/ui/app-update-notice", () => ({ AppUpdateNotice: "AppUpdateNotice" }));
vi.mock("../src/ui/key-security", () => ({ securityRow: () => ({}) }));
vi.mock("../src/ui/dictation-settings", () => ({ DictationSettings: "DictationSettings" }));
vi.mock("../src/ui/notification-settings", () => ({ NotificationSettingsCard: "NotificationSettingsCard" }));
vi.mock("../src/ui/secret-files-setting", () => ({ SecretFilesSetting: "SecretFilesSetting" }));
vi.mock("../src/ui/terminal-font-settings", () => ({ TerminalFontSettings: "TerminalFontSettings" }));
vi.mock("../src/ui/terminal-keys-entry", () => ({ TerminalKeysEntry: "TerminalKeysEntry" }));
vi.mock("../src/ui/use-key-security", () => ({ useKeySecurity: () => ({ status: null, error: null, stale: false, busy: false }) }));
vi.mock("../src/ui/components", () => ({ Card: "Card", Screen: "Screen", SectionTitle: "SectionTitle", Segmented: "Segmented", PrimaryButton: "PrimaryButton" }));
vi.mock("../src/ui/tour/anchors", () => ({ TourAnchor: "TourAnchor" }));
vi.mock("../src/ui/tour/scroll", () => ({ useTourScroll: () => ({ props: {}, place: () => undefined }) }));
vi.mock("../src/ui/preferences", () => ({ usePreferences: () => prefs.value }));

const { default: SettingsScreen } = await import("../src/app/(tabs)/settings");
const { GiftCodeDialog } = await import("../src/ui/gift-code-dialog");

type Node = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Node[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
const texts = (nodes: Node[]) => nodes.filter(n => n.type === "Text").flatMap(n => [n.props.children].flat()).filter(value => typeof value === "string");
function render<P>(component: (props: P) => unknown, props: P): Node[] { hooks.index = 0; return elements(component(props)); }

const gift: GiftThemeData = {
 id: "sample-gift", label: "Sample ◐",
 greeting: { es: { title: "Hola Ana", body: "Este tema es tuyo." }, en: { title: "Hi Ana", body: "This theme is yours." } },
 colors: {} as GiftThemeData["colors"], primaryFill: {},
};
const unlocked: UnlockedGift = { code: "TEST2345", theme: gift };
const theme = (name: string) => ({ name, spacing: (n: number) => n * 4, touch: 48, radius: { small: 6, medium: 8, large: 16 }, font: { mono: "monospace" }, colors: {} });
const settings = () => render(SettingsScreen, undefined as never);

beforeEach(() => { hooks.slots = []; share.mockClear(); vi.useFakeTimers(); prefs.value = { t: es, locale: "es", theme: theme("verde-profundo"), gifts: [], language: "es", retention: 7, setTheme: vi.fn(), unlockGift: vi.fn() }; });
afterEach(() => vi.useRealTimers());

it("shows a «Personalización» row where the theme card was, and no theme, share or font settings (S16)", () => {
 const push = vi.fn();
 router.push = push;
 for (const gifts of [[], [unlocked]]) {
  prefs.value = { ...prefs.value, gifts };
  const view = settings();
  expect(view.some(n => n.type === "Segmented" && n.props.options.some((o: { value: string }) => o.value === "verde-profundo"))).toBe(false);
  expect(view.some(n => n.type === "TerminalFontSettings" || n.type === "TerminalKeysEntry")).toBe(false);
  expect(view.some(n => n.props.accessibilityLabel === es.gifts.share)).toBe(false);
  expect(texts(view)).not.toContain(es.settings.theme);
  // Right under «Apariencia», before the language card.
  const title = view.findIndex(n => n.type === "SectionTitle" && n.props.children === es.settings.appearance);
  const row = view.findIndex(n => n.type === "Card" && n.props.onPress);
  expect(row).toBe(title + 1);
  expect(texts(elements(view[row].props.children))).toEqual([es.settings.personalization, "›"]);
  expect(row).toBeLessThan(view.findIndex(n => n.type === "Segmented" && n.props.value === "es"));
  view[row].props.onPress();
 }
 expect(push).toHaveBeenCalledWith("/personalization");
 expect(settings().find(n => n.type === GiftCodeDialog)!.props.visible).toBe(false);
});

it("opens the code field on the seventh quick tap on the version, counting down from the fourth", () => {
 const tap = () => { settings().find(n => n.type === "Pressable" && String(n.props.accessibilityLabel).startsWith(es.settings.version))!.props.onPress(); vi.advanceTimersByTime(300); return settings(); };
 const hints: string[][] = [];
 let view: Node[] = [];
 for (let i = 0; i < 6; i++) { view = tap(); hints.push(texts(view).filter(text => text.startsWith("Falta"))); }
 expect(hints).toEqual([[], [], [], ["Faltan 3 toques"], ["Faltan 2 toques"], ["Falta 1 toque"]]);
 expect(view.find(n => n.type === GiftCodeDialog)!.props.visible).toBe(false);
 view = tap();
 expect(view.find(n => n.type === GiftCodeDialog)!.props.visible).toBe(true);
});

it("hides the countdown and starts over after a pause", () => {
 const press = () => settings().find(n => n.type === "Pressable" && String(n.props.accessibilityLabel).startsWith(es.settings.version))!.props.onPress();
 for (let i = 0; i < 5; i++) { press(); vi.advanceTimersByTime(200); }
 expect(texts(settings())).toContain("Faltan 2 toques");
 vi.advanceTimersByTime(2000);
 expect(texts(settings()).some(text => text.startsWith("Falta"))).toBe(false);
 press();
 expect(texts(settings()).some(text => text.startsWith("Falta"))).toBe(false);
});

it("says a wrong code does not work, with nothing else", async () => {
 const unlockGift = vi.fn(async () => null);
 prefs.value = { ...prefs.value, unlockGift };
 const onClose = vi.fn();
 let view = render(GiftCodeDialog, { visible: true, onClose });
 expect(texts(view)).toEqual([es.gifts.title, es.gifts.body, es.gifts.cancel]);
 const input = view.find(n => n.type === "TextInput")!;
 expect(input.props).toMatchObject({ autoCapitalize: "characters", autoCorrect: false });
 input.props.onChangeText("nope-0000");
 view = render(GiftCodeDialog, { visible: true, onClose });
 await view.find(n => n.type === "PrimaryButton")!.props.onPress();
 await vi.waitFor(() => expect(unlockGift).toHaveBeenCalledWith("nope-0000"));
 await Promise.resolve();
 view = render(GiftCodeDialog, { visible: true, onClose });
 expect(texts(view)).toEqual([es.gifts.title, es.gifts.body, "Ese código no funciona", es.gifts.cancel]);
});

it("greets on a right code and switches theme only when asked", async () => {
 const setTheme = vi.fn();
 prefs.value = { ...prefs.value, t: en, locale: "en", setTheme, unlockGift: vi.fn(async () => gift) };
 const onClose = vi.fn();
 let view = render(GiftCodeDialog, { visible: true, onClose });
 view.find(n => n.type === "TextInput")!.props.onChangeText("test 2345");
 view = render(GiftCodeDialog, { visible: true, onClose });
 view.find(n => n.type === "PrimaryButton")!.props.onPress();
 await vi.waitFor(() => expect(texts(render(GiftCodeDialog, { visible: true, onClose }))).toContain("Hi Ana"));
 view = render(GiftCodeDialog, { visible: true, onClose });
 expect(texts(view)).toEqual(["Hi Ana", "This theme is yours.", "Not now"]);
 expect(setTheme).not.toHaveBeenCalled();
 expect(view.find(n => n.type === "PrimaryButton")!.props.label).toBe("Use my theme");
 view.find(n => n.type === "PrimaryButton")!.props.onPress();
 expect(setTheme).toHaveBeenCalledWith("sample-gift");
 expect(onClose).toHaveBeenCalledTimes(1);
});

it("shows the gift's avatar in a glowing ring above the greeting only when the gift has one", async () => {
 const { GiftAvatar } = await import("../src/ui/gift-code-dialog");
 const { GiftMascot } = await import("../src/ui/gift-mascot");
 // Invented avatar: a tall 2 × 4 grid and made-up ring colors.
 const avatar = { image: { palette: { a: "#102030" }, rows: ["a.", ".a", "aa", "a."], pixel: { width: 1, height: 1 } }, ring: { color: "#AA11BB", glow: "#CC22DD" } };
 const greet = async (opened: GiftThemeData) => {
  hooks.slots = [];
  prefs.value = { ...prefs.value, unlockGift: vi.fn(async () => opened) };
  let view = render(GiftCodeDialog, { visible: true, onClose: vi.fn() });
  view.find(n => n.type === "TextInput")!.props.onChangeText("test 2345");
  view = render(GiftCodeDialog, { visible: true, onClose: vi.fn() });
  view.find(n => n.type === "PrimaryButton")!.props.onPress();
  await vi.waitFor(() => expect(texts(render(GiftCodeDialog, { visible: true, onClose: vi.fn() }))).toContain("Hola Ana"));
  return render(GiftCodeDialog, { visible: true, onClose: vi.fn() });
 };

 expect((await greet(gift)).some(n => n.type === GiftAvatar)).toBe(false);

 const view = await greet({ ...gift, colors: { surface: "#0A0B0C" } as GiftThemeData["colors"], avatar });
 const index = view.findIndex(n => n.type === GiftAvatar);
 expect(index).toBeGreaterThan(-1);
 expect(index).toBeLessThan(view.findIndex(n => n.type === "Text" && n.props.accessibilityRole === "header"));
 expect(texts(view)).toEqual(["Hola Ana", "Este tema es tuyo.", es.gifts.notNow]);
 const ringed = view[index].props;
 expect(ringed).toMatchObject({ avatar, background: "#0A0B0C" });

 const nodes = elements(GiftAvatar(ringed as Parameters<typeof GiftAvatar>[0]));
 const size = nodes[0].props.style.width;
 expect(size).toBeGreaterThanOrEqual(96);
 expect(size).toBeLessThanOrEqual(112);
 expect(nodes[0].props).toMatchObject({ accessible: false, importantForAccessibility: "no-hide-descendants" });
 expect(nodes[0].props.style).toMatchObject({ height: size, borderRadius: size / 2, backgroundColor: "#0A0B0C", borderWidth: 2, borderColor: "#AA11BB", shadowColor: "#CC22DD", shadowRadius: 14 });
 expect(nodes[0].props.style.shadowOpacity).toBeGreaterThan(0);
 expect(nodes[0].props.style.elevation).toBeGreaterThan(0);
 expect(nodes[1].props.style).toMatchObject({ borderRadius: size / 2, overflow: "hidden" });
 const art = nodes.find(n => n.type === GiftMascot)!;
 expect(art.props.mascot).toBe(avatar.image);
 // A tall grid is fit by its height so it stays inside the circle.
 expect(art.props.width * 2).toBeLessThan(size);

 const plain = elements(GiftAvatar({ ...(ringed as Parameters<typeof GiftAvatar>[0]), avatar: { image: avatar.image } }));
 expect(plain[0].props.style).not.toHaveProperty("borderWidth");
 expect(plain[0].props.style).not.toHaveProperty("shadowColor");
});
