import { isValidElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { GiftThemeData, UnlockedGift } from "../src/core/gift-themes";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

// Minimal hook slots so a component can be called as a function and called again to re-render.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
 ...(await original<typeof import("react")>()),
 useState: (initial: unknown) => {
  const slot = hooks.index++;
  if (!(slot in hooks.slots)) hooks.slots[slot] = typeof initial === "function" ? (initial as () => unknown)() : initial;
  return [hooks.slots[slot], (next: unknown) => { hooks.slots[slot] = typeof next === "function" ? (next as (value: unknown) => unknown)(hooks.slots[slot]) : next; }];
 },
}));
const share = vi.hoisted(() => vi.fn(async (_content: { message: string }) => ({ action: "sharedAction" })));
const router = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn() }));
const prefs = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("expo-router", () => ({ useRouter: () => router }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock("react-native", () => ({ Alert: { alert: vi.fn() }, Share: { share }, Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" }));
vi.mock("../src/ui/terminal-font-settings", () => ({ TerminalFontSettings: "TerminalFontSettings" }));
vi.mock("../src/ui/terminal-keys-entry", () => ({ TerminalKeysEntry: "TerminalKeysEntry" }));
vi.mock("../src/ui/components", () => ({ Card: "Card", Screen: "Screen", Segmented: "Segmented" }));
vi.mock("../src/ui/preferences", () => ({ usePreferences: () => prefs.value }));

const { default: PersonalizationScreen } = await import("../src/app/personalization");
const { GiftShareButton } = await import("../src/ui/gift-share");

type Node = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Node[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
const texts = (nodes: Node[]) => nodes.filter(n => n.type === "Text").flatMap(n => [n.props.children].flat()).filter(value => typeof value === "string");
function render<P>(component: (props: P) => unknown, props: P): Node[] { hooks.index = 0; return elements(component(props)); }

// Invented gifts: never the real names or codes.
const giftData = (id: string, label: string): GiftThemeData => ({
 id, label,
 greeting: { es: { title: "Hola", body: "Tuyo." }, en: { title: "Hi", body: "Yours." } },
 colors: {} as GiftThemeData["colors"], primaryFill: {},
});
const first: UnlockedGift = { code: "TEST2345", theme: giftData("sample-one", "Sample ◐") };
const second: UnlockedGift = { code: "FAKE6789", theme: giftData("sample-two", "Sample ◑") };
const theme = (name: string) => ({ name, spacing: (n: number) => n * 4, touch: 48, radius: { small: 6, medium: 8, large: 16 }, font: { mono: "monospace" }, colors: {} });
const screen = () => render(PersonalizationScreen, undefined as never);
const shareButton = (gifts: UnlockedGift[]) => render(GiftShareButton, { gifts });
const pressable = (nodes: Node[], label: string) => nodes.find(n => n.type === "Pressable" && n.props.accessibilityLabel === label);

beforeEach(() => { hooks.slots = []; share.mockClear(); router.push.mockClear(); router.back.mockClear(); prefs.value = { t: es, theme: theme("verde-profundo"), gifts: [], setTheme: vi.fn() }; });

it("shows the theme selector, the terminal font size and the key bar entry under «Personalización»", () => {
 const view = screen();
 expect(view.find(n => n.type === "Text" && n.props.accessibilityRole === "header")!.props.children).toBe(es.settings.personalization);
 const selector = view.find(n => n.type === "Segmented")!;
 expect(selector.props.options.map((o: { value: string }) => o.value)).toEqual(["verde-profundo", "oro-y-verde"]);
 expect(selector.props.compact).toBe(false);
 expect(selector.props.onChange).toBe(prefs.value.setTheme);
 expect(texts(view)).toContain(es.settings.theme);
 // The share icon sits next to «Tema».
 const label = view.find(n => n.type === "View" && elements(n.props.children).some(c => c.type === "Text" && c.props.children === es.settings.theme))!;
 expect(elements(label.props.children).find(n => n.type === GiftShareButton)!.props.gifts).toEqual([]);
 const font = view.find(n => n.type === "TerminalFontSettings")!;
 const keys = elements(font.props.children).find(n => n.type === "TerminalKeysEntry")!;
 keys.props.open();
 expect(router.push).toHaveBeenCalledWith("/terminal-keys");
 pressable(view, es.settings.back)!.props.onPress();
 expect(router.back).toHaveBeenCalledTimes(1);
});

it("lists unlocked gifts by label in a compact selector and hands them to the share icon", () => {
 prefs.value = { ...prefs.value, t: en, gifts: [first, second] };
 const view = screen();
 expect(view.find(n => n.type === "Text" && n.props.accessibilityRole === "header")!.props.children).toBe("Personalization");
 const selector = view.find(n => n.type === "Segmented")!;
 expect(selector.props.options.slice(2)).toEqual([{ value: "sample-one", label: "Sample ◐" }, { value: "sample-two", label: "Sample ◑" }]);
 expect(selector.props.compact).toBe(true);
 expect(view.find(n => n.type === GiftShareButton)!.props.gifts).toEqual([first, second]);
});

it("hides the share icon while no gift is unlocked", () => {
 expect(shareButton([])).toEqual([]);
});

it("shares the only unlocked gift directly", () => {
 const view = shareButton([first]);
 const button = pressable(view, es.gifts.share)!;
 expect(button.props.accessibilityRole).toBe("button");
 expect(button.props.style({ pressed: false })).toMatchObject({ width: 48, height: 48 });
 expect(view.find(n => n.type === "Ionicons")!.props.name).toBe("share-social-outline");
 button.props.onPress();
 expect(share).toHaveBeenCalledWith({ message: "Te paso mi tema secreto de mars-ram 🌸 En Ajustes, tocá 7 veces la versión y escribí: TEST-2345" });
 expect(shareButton([first]).find(n => n.type === "Modal")!.props.visible).toBe(false);
});

it("with several gifts opens a picker, shares the chosen one, and «Cancelar» closes it", () => {
 let view = shareButton([first, second]);
 expect(view.find(n => n.type === "Modal")!.props).toMatchObject({ visible: false, transparent: true });
 pressable(view, es.gifts.share)!.props.onPress();
 expect(share).not.toHaveBeenCalled();
 view = shareButton([first, second]);
 const modal = view.find(n => n.type === "Modal")!;
 expect(modal.props.visible).toBe(true);
 const sheet = elements(modal.props.children);
 expect(texts(sheet)).toEqual([es.gifts.sharePick, "Sample ◐", "Sample ◑", es.gifts.cancel]);
 pressable(sheet, "Sample ◑")!.props.onPress();
 expect(share).toHaveBeenCalledTimes(1);
 expect(share).toHaveBeenCalledWith({ message: "Te paso mi tema secreto de mars-ram 🌸 En Ajustes, tocá 7 veces la versión y escribí: FAKE-6789" });
 expect(shareButton([first, second]).find(n => n.type === "Modal")!.props.visible).toBe(false);

 pressable(shareButton([first, second]), es.gifts.share)!.props.onPress();
 view = shareButton([first, second]);
 expect(view.find(n => n.type === "Modal")!.props.visible).toBe(true);
 const cancel = view.filter(n => n.type === "Pressable" && n.props.accessibilityLabel === es.gifts.cancel);
 expect(cancel.length).toBeGreaterThan(0);
 cancel.at(-1)!.props.onPress();
 expect(shareButton([first, second]).find(n => n.type === "Modal")!.props.visible).toBe(false);
 view.find(n => n.type === "Modal")!.props.onRequestClose();
 expect(share).toHaveBeenCalledTimes(1);
});
