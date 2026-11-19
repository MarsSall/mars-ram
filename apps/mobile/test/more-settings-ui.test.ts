import { isValidElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

// Ajustes › «Más ajustes» (S9): the rarely touched settings moved out of Ajustes.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
 ...(await original<typeof import("react")>()),
 useState: (initial: unknown) => {
  const slot = hooks.index++;
  if (!(slot in hooks.slots)) hooks.slots[slot] = initial;
  return [hooks.slots[slot], (next: unknown) => { hooks.slots[slot] = next; }];
 },
}));
const router = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn() }));
const alert = vi.hoisted(() => vi.fn());
const openURL = vi.hoisted(() => vi.fn(async () => true));
const prefs = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const security = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const dev = vi.hoisted(() => ({ on: false }));
Object.defineProperty(globalThis, "__DEV__", { configurable: true, get: () => dev.on });
vi.mock("expo-router", () => ({ useRouter: () => router }));
vi.mock("expo-localization", () => ({ getLocales: () => [] }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
vi.mock("react-native", () => ({ Alert: { alert }, Linking: { openURL }, Pressable: "Pressable", ScrollView: "ScrollView", Switch: "Switch", Text: "Text", View: "View" }));
vi.mock("../src/services", () => ({ appBuild: { version: "1.0.0", build: 7 } }));
vi.mock("../src/ui/dictation-settings", () => ({ DictationSettings: "DictationSettings" }));
vi.mock("../src/ui/secret-files-setting", () => ({ SecretFilesSetting: "SecretFilesSetting" }));
vi.mock("../src/ui/use-key-security", () => ({ useKeySecurity: () => security.value }));
vi.mock("../src/ui/components", () => ({ Card: "Card", Screen: "Screen", SectionTitle: "SectionTitle", Segmented: "Segmented" }));
vi.mock("../src/ui/preferences", () => ({ usePreferences: () => prefs.value }));

const { default: MoreSettingsScreen } = await import("../src/app/more-settings");
const { SOURCE_URL } = await import("../src/core/about");

type Node = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Node[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
const texts = (nodes: Node[]) => nodes.filter(n => n.type === "Text").flatMap(n => [n.props.children].flat()).filter(value => typeof value === "string");
const titles = (nodes: Node[]) => nodes.filter(n => n.type === "SectionTitle").map(n => n.props.children);
const screen = () => { hooks.index = 0; return elements(MoreSettingsScreen()); };
const theme = { name: "verde-profundo", spacing: (n: number) => n * 4, touch: 48, radius: { small: 6, medium: 8 }, colors: {} };
const done = { requireUnlock: true, perComputer: [{ hostId: "a", name: "Desk", phase: "done" }] };

beforeEach(() => {
 hooks.slots = []; dev.on = false; router.push.mockClear(); router.back.mockClear(); alert.mockClear(); openURL.mockClear();
 prefs.value = { t: es, theme, language: "es", retention: 7, setRetention: vi.fn(async () => {}), showEmpty: false, setShowEmpty: vi.fn() };
 security.value = { status: done, error: null, stale: false, busy: false, change: vi.fn(async () => {}), refresh: vi.fn(async () => {}), resume: vi.fn(async () => {}) };
});

it("has a «Más ajustes» header with a back arrow to Ajustes", () => {
 for (const [t, title] of [[es, "Más ajustes"], [en, "More settings"]] as const) {
  prefs.value = { ...prefs.value, t };
  const view = screen();
  expect(view.find(n => n.type === "Text" && n.props.accessibilityRole === "header")!.props.children).toBe(title);
  view.find(n => n.type === "Pressable" && n.props.accessibilityLabel === t.settings.back)!.props.onPress();
 }
 expect(router.back).toHaveBeenCalledTimes(2);
});

it("holds attachments, secret files, dictation, security and the build with privacy and source links, in that order", () => {
 const view = screen();
 const order = ["SectionTitle:" + es.attachments.title, "SecretFilesSetting", "DictationSettings", "SectionTitle:" + es.settings.security, "SectionTitle:" + es.settings.about];
 const seen = view.filter(n => ["SectionTitle", "SecretFilesSetting", "DictationSettings"].includes(n.type as string)).map(n => n.type === "SectionTitle" ? `SectionTitle:${n.props.children}` : String(n.type));
 expect(seen).toEqual(order);
 const all = texts(view);
 for (const text of [es.attachments.retention, es.attachments.location, es.keySecurity.label, es.settings.build, "7", es.settings.privacy, es.settings.source]) expect(all).toContain(text);
 expect(titles(view)).toEqual([es.attachments.title, es.settings.security, es.settings.about]);
 expect(all).not.toContain(es.settings.showEmpty);
 const links = view.filter(n => n.type === "Pressable" && n.props.accessibilityRole === "link");
 links[1].props.onPress();
 expect(openURL).toHaveBeenCalledWith(SOURCE_URL);
});

it("saves the attachment retention and says so when it fails", async () => {
 const setRetention = vi.fn(async () => { throw new Error("disk"); });
 prefs.value = { ...prefs.value, setRetention };
 const selector = screen().find(n => n.type === "Segmented")!;
 expect(selector.props.value).toBe(7);
 expect(selector.props.options.map((o: { value: unknown }) => o.value)).toEqual([1, 7, 30, "never"]);
 selector.props.onChange(30);
 expect(setRetention).toHaveBeenCalledWith(30);
 await vi.waitFor(() => expect(texts(screen())).toContain(es.attachments.preferenceFailed));
});

it("keeps the SSH key unlock switch with its warning before turning it off", () => {
 const view = screen();
 const toggle = view.find(n => n.type === "Switch" && n.props.accessibilityLabel === es.keySecurity.label)!;
 expect(toggle.props).toMatchObject({ value: true, disabled: false });
 expect(texts(view).join("")).toContain(`Desk: ${es.keySecurity.done}`);
 toggle.props.onValueChange(false);
 expect(alert).toHaveBeenCalledTimes(1);
 expect(security.value.change).not.toHaveBeenCalled();
 alert.mock.calls[0][2][1].onPress();
 expect(security.value.change).toHaveBeenCalledWith(false);
 toggle.props.onValueChange(true);
 expect(security.value.change).toHaveBeenCalledWith(true);
});

it("shows per-computer pending status and retries, locking the switch meanwhile", () => {
 security.value = { ...security.value, status: { requireUnlock: false, perComputer: [{ hostId: "a", name: "Desk", phase: "pending", lastError: { code: "TIMEOUT", message: "x" } }] } };
 const view = screen();
 expect(view.find(n => n.type === "Switch")!.props).toMatchObject({ value: false, disabled: true });
 expect(texts(view)).toContain(es.keySecurity.rotationPending);
 view.find(n => n.type === "Pressable" && n.props.accessibilityLabel === es.keySecurity.retry)!.props.onPress();
 expect(security.value.resume).toHaveBeenCalledTimes(1);
 security.value = { ...security.value, status: null, error: null };
 expect(texts(screen())).toContain(es.keySecurity.loading);
 expect(screen().some(n => n.props.accessibilityLabel === es.keySecurity.retry)).toBe(false);
});

it("adds the prototype and developer sections only in development", () => {
 dev.on = true;
 const view = screen();
 expect(titles(view).slice(-2)).toEqual([es.settings.prototype, es.settings.developer]);
 expect(texts(view)).toEqual(expect.arrayContaining([es.settings.showEmpty, es.settings.sshProbe]));
 view.find(n => n.type === "Card" && n.props.onPress)!.props.onPress();
 expect(router.push).toHaveBeenCalledWith("/dev/ssh-probe");
});
