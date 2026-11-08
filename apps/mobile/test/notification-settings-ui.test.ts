import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { NotificationSettingsCard } from "../src/ui/notification-settings";
import { notificationCopy } from "../src/ui/notification-copy";

const f = vi.hoisted(() => ({
 effects: [] as (() => void | (() => void))[], writes: [] as unknown[],
 foreground: undefined as undefined | ((s: string) => void),
 batteryExempt: vi.fn(() => false), refreshStatus: vi.fn(), openBattery: vi.fn(async () => {}), openSettings: vi.fn(async () => {}),
 state: { mode: "always", busy: true, error: "NOTIFICATIONS_DENIED" as string | null, status: { state: "stopped" }, computers: [] as unknown[] },
}));
vi.mock("react", async importOriginal => ({
 ...await importOriginal<typeof import("react")>(),
 useEffect: (effect: () => void | (() => void)) => { f.effects.push(effect); },
 useState: (initial: unknown) => [initial, (next: unknown) => f.writes.push(next)],
 useSyncExternalStore: () => f.state,
}));
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View", Modal: "Modal", ScrollView: "ScrollView", AppState: { addEventListener: (_: string, fn: (s: string) => void) => { f.foreground = fn; return { remove: vi.fn() }; } } }));
vi.mock("../src/services", () => ({ notifications: { subscribe: vi.fn(), snapshot: vi.fn(), refreshStatus: f.refreshStatus }, notificationSystem: { batteryExempt: f.batteryExempt, openBattery: f.openBattery, openSettings: f.openSettings } }));
vi.mock("../src/ui/preferences", () => ({ usePreferences: () => ({ locale: "es", theme: { colors: {}, spacing: (n: number) => n * 4, radius: { medium: 12 }, touch: 48 } }) }));
vi.mock("../src/ui/components", () => ({ Card: "Card", SectionTitle: "SectionTitle", Segmented: "Segmented" }));
function elements(node: unknown, skipModal = false): { type: unknown; props: Record<string, any> }[] {
 if (Array.isArray(node)) return node.flatMap(child => elements(child, skipModal));
 if (!isValidElement<Record<string, any>>(node)) return [];
 if (skipModal && node.type === "Modal") return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.right, skipModal), ...elements(node.props.children, skipModal)];
}
const texts = (nodes: { type: unknown; props: Record<string, any> }[]) => nodes.filter(n => n.type === "Text").map(n => [n.props.children].flat().join("")).join("\n");
function split(node: unknown) {
 const modal = elements(node).find(n => n.type === "Modal");
 return { modal, inside: modal ? elements(modal.props.children) : [], inline: elements(node, true) };
}
const render = (mode: string, error: string | null = null) => { f.state = { ...f.state, mode, busy: false, error }; return split(NotificationSettingsCard()); };
afterEach(() => { f.state = { mode: "always", busy: true, error: "NOTIFICATIONS_DENIED", status: { state: "stopped" }, computers: [] }; f.effects.length = 0; f.writes.length = 0; vi.clearAllMocks(); vi.useRealTimers(); });
describe("notification system-settings actions", () => {
 it("keeps battery and notification settings enabled while preparation is busy", async () => {
  const nodes = elements(NotificationSettingsCard());
  for (const label of [notificationCopy.es.battery, notificationCopy.es.settings]) {
   const button = nodes.find(n => n.type === "Pressable" && n.props.accessibilityLabel === label)!;
   expect(button.props.disabled).toBe(false);
   expect(button.props.style.opacity).toBe(1);
   button.props.onPress();
  }
  expect(f.openBattery).toHaveBeenCalledOnce(); expect(f.openSettings).toHaveBeenCalledOnce();
  const retry = nodes.find(n => n.type === "Pressable" && n.props.accessibilityLabel === notificationCopy.es.retry)!;
  expect(retry.props.disabled).toBe(true);
 });
 it("refreshes the exemption on foreground return, independently of busy", () => {
  vi.useFakeTimers(); f.batteryExempt.mockReturnValue(false);
  NotificationSettingsCard(); const cleanup = f.effects[0]();
  expect(f.writes).toContain(false);
  f.batteryExempt.mockReturnValue(true); f.foreground?.("active");
  expect(f.writes.at(-1)).toBe(true); expect(f.refreshStatus).toHaveBeenCalledTimes(2);
  cleanup?.();
 });
});
describe("notification help behind a question mark", () => {
 const long = (t: typeof notificationCopy.es) => [t.offHelp, t.workingHelp, t.alwaysHelp, t.limits, t.consent, t.batteryHelp];
 it.each(["off", "while-working", "always"])("keeps the long explanations out of the inline card in %s", mode => {
  const { inline } = render(mode); const shown = texts(inline);
  for (const line of long(notificationCopy.es)) expect(shown).not.toContain(line);
 });
 it("shows only the selected mode's short line", () => {
  const t = notificationCopy.es;
  for (const [mode, line] of [["off", t.offShort], ["while-working", t.workingShort], ["always", t.alwaysShort]] as const) {
   const shown = texts(render(mode).inline);
   expect(shown).toContain(line);
   for (const other of [t.offShort, t.workingShort, t.alwaysShort].filter(l => l !== line)) expect(shown).not.toContain(other);
  }
 });
 it("has a labelled, 44 dp question-mark button that opens the help", () => {
  const { inline } = render("off");
  const help = inline.find(n => n.type === "Pressable" && n.props.accessibilityLabel === notificationCopy.es.help)!;
  expect(help).toBeDefined();
  expect(Math.min(help.props.style.minHeight, help.props.style.minWidth)).toBeGreaterThanOrEqual(44);
  expect(texts(elements(help.props.children))).toBe("?");
  help.props.onPress(); expect(f.writes).toContain(true);
 });
 it("the help view holds every S5 limit, in both languages, with a close button", () => {
  for (const locale of ["es", "en"] as const) {
   const t = notificationCopy[locale];
   expect(t.help).toMatch(locale === "es" ? /Ayuda de notificaciones/ : /Notifications help/);
   for (const line of long(t)) expect(line.length).toBeGreaterThan(0);
  }
  const { modal, inside } = render("off");
  expect(modal).toBeDefined();
  expect(inside.some(n => n.type === "ScrollView")).toBe(true);
  const shown = texts(inside);
  for (const line of long(notificationCopy.es)) expect(shown).toContain(line);
  const close = inside.find(n => n.type === "Pressable" && n.props.accessibilityLabel === notificationCopy.es.close)!;
  close.props.onPress(); expect(f.writes).toContain(false);
  modal!.props.onRequestClose(); expect(f.writes.filter(w => w === false)).toHaveLength(2);
 });
 it("shows the battery line and button only in Siempre atento", () => {
  const t = notificationCopy.es;
  for (const mode of ["off", "while-working"]) {
   const { inline } = render(mode);
   expect(inline.some(n => n.props.accessibilityLabel === t.battery)).toBe(false);
   expect(inline.some(n => n.props.testID === "battery-state")).toBe(false);
  }
  const { inline } = render("always");
  expect(inline.some(n => n.props.accessibilityLabel === t.battery)).toBe(true);
  expect(inline.some(n => n.props.testID === "battery-state")).toBe(true);
 });
 it("keeps the permission-denied explanation and settings button inline", () => {
  const { inline } = render("off", "NOTIFICATIONS_DENIED");
  expect(texts(inline)).toContain(notificationCopy.es.denied);
  expect(inline.some(n => n.type === "Pressable" && n.props.accessibilityLabel === notificationCopy.es.settings)).toBe(true);
 });
});
