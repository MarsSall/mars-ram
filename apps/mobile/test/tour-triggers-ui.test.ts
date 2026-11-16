import { isValidElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { es } from "../src/ui/i18n/es";

const state = vi.hoisted(() => ({ saved: 0, tourSeen: false, phase: null as unknown }));
const replace = vi.fn(), dismissTo = vi.fn(), startTour = vi.fn();
const pair = vi.fn(), confirm = vi.fn();

vi.mock("react", async (original) => ({
 ...(await original<typeof import("react")>()),
 // The manual screen opens on its confirm phase; everything else keeps its first value.
 useState: (value: unknown) => [typeof value === "object" && value !== null && (value as { kind?: string }).kind === "form" && state.phase ? state.phase : value, () => {}],
 useRef: (value: unknown) => ({ current: value }),
 useEffect: () => {},
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ replace, dismissTo, back: vi.fn() }) }));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
vi.mock("react-native", () => ({ ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View" }));
vi.mock("../src/ui/components", () => ({ Card: "Card", PrimaryButton: "PrimaryButton", Screen: "Screen", SectionTitle: "SectionTitle" }));
vi.mock("../src/ui/preferences", async () => {
 const { es } = await import("../src/ui/i18n/es");
 return { usePreferences: () => ({ t: es, theme: { spacing: (n: number) => n * 4, touch: 48, radius: { small: 4, medium: 8 }, font: { mono: "mono" }, colors: {} } }) };
});
vi.mock("../src/services", async () => {
 const { AppTour, pairAndCheckTour } = await import("../src/core/tour");
 const store = { read: async () => state.tourSeen ? { kind: "saved" as const, flags: { tourSeen: true, tips: [] } } : { kind: "none" as const }, write: async () => {} };
 return {
  pair: (...args: unknown[]) => pair(...args),
  manual: { confirm: (...args: unknown[]) => confirm(...args), discoverIdentity: vi.fn() },
  appKey: { ensure: vi.fn() },
  pairingTour: <R extends { ok: boolean }>(run: () => Promise<R>) => pairAndCheckTour({ savedHosts: async () => state.saved, tour: new AppTour({ store }) }, run),
  startTour: () => startTour(),
 };
});

const { TOUR_SETTLE_MS, pairThenTour } = await import("../src/ui/tour/start");
const { usePairingRunner } = await import("../src/ui/connect-wizard/pairing-runner");
const { default: ManualAddScreen } = await import("../src/app/add-computer/manual");

type Node = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Node[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}

beforeEach(() => { vi.useFakeTimers(); state.saved = 0; state.tourSeen = false; state.phase = null; });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

const host = { id: "mini", name: "devbox" };

it("starts the tour once the screen after the first pairing has opened, not before", async () => {
 const navigate = vi.fn();
 await pairThenTour(async () => ({ ok: true as const, host }), navigate);
 expect(navigate).toHaveBeenCalledWith({ ok: true, host });
 expect(startTour).not.toHaveBeenCalled();
 vi.advanceTimersByTime(TOUR_SETTLE_MS);
 expect(startTour).toHaveBeenCalledTimes(1);
});

it("does not start it after a second computer, a seen tour or a failed pairing", async () => {
 state.saved = 1;
 await pairThenTour(async () => ({ ok: true as const, host }), vi.fn());
 state.saved = 0; state.tourSeen = true;
 await pairThenTour(async () => ({ ok: true as const, host }), vi.fn());
 state.tourSeen = false;
 const navigate = vi.fn();
 await pairThenTour(async () => ({ ok: false as const }), navigate);
 vi.runAllTimers();
 expect(navigate).not.toHaveBeenCalled();
 expect(startTour).not.toHaveBeenCalled();
});

it("QR pairing: opens the computer and then starts the tour after the first one", async () => {
 pair.mockResolvedValue({ ok: true, host });
 await usePairingRunner().run("mars-ram://pair?x");
 expect(replace).toHaveBeenCalledWith({ pathname: "/computer/[id]", params: { id: "mini" } });
 vi.advanceTimersByTime(TOUR_SETTLE_MS);
 expect(startTour).toHaveBeenCalledTimes(1);

 state.saved = 1; startTour.mockClear();
 await usePairingRunner().run("mars-ram://pair?y");
 vi.runAllTimers();
 expect(startTour).not.toHaveBeenCalled();
});

it("QR pairing that fails starts nothing", async () => {
 pair.mockResolvedValue({ ok: false, step: "scan", code: "INVALID_QR", message: "bad" });
 await usePairingRunner().run("nope");
 vi.runAllTimers();
 expect(replace).not.toHaveBeenCalled();
 expect(startTour).not.toHaveBeenCalled();
});

async function confirmManual() {
 state.phase = { kind: "confirm", details: { name: "devbox", address: "100.64.0.1", user: "mars", sshPort: 22 }, fingerprint: "SHA256:x" };
 const itIsMine = elements(ManualAddScreen()).find(n => n.type === "PrimaryButton" && n.props.label === es.add.itIsMine)!;
 itIsMine.props.onPress();
 await flush();
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

it("manual add: opens the computer and then starts the tour after the first one", async () => {
 confirm.mockResolvedValue({ ok: true, host });
 await confirmManual();
 expect(dismissTo).toHaveBeenCalledWith({ pathname: "/computer/[id]", params: { id: "mini" } });
 expect(startTour).not.toHaveBeenCalled();
 vi.advanceTimersByTime(TOUR_SETTLE_MS);
 expect(startTour).toHaveBeenCalledTimes(1);
});

it("manual add of a second computer does not start it", async () => {
 state.saved = 2;
 confirm.mockResolvedValue({ ok: true, host });
 await confirmManual();
 expect(dismissTo).toHaveBeenCalled();
 vi.runAllTimers();
 expect(startTour).not.toHaveBeenCalled();
});
