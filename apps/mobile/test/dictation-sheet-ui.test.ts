import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { DICTATION_MODEL } from "../src/core/dictation";
import { es } from "../src/ui/i18n/es";
import { fakeDictationEngine } from "./fake-dictation-engine";

// The voice-model sheet and the Settings card over the system download: leaving never cancels,
// only «Cancelar descarga» does, and reopening shows the download that is still running.
const h = vi.hoisted(() => ({ slots: [] as unknown[], i: 0, mounted: false, effects: [] as (() => void | (() => void))[], cleanups: [] as (() => void)[] }));
vi.mock("react", async importOriginal => ({
 ...await importOriginal<typeof import("react")>(),
 // A one-component hook harness: state survives re-renders, effects run once at mount and clean up at unmount.
 useState: (init: unknown) => {
  const i = h.i++; if (!(i in h.slots)) h.slots[i] = typeof init === "function" ? (init as () => unknown)() : init;
  return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === "function" ? (next as (prev: unknown) => unknown)(h.slots[i]) : next; }];
 },
 useRef: (init: unknown) => { const i = h.i++; if (!(i in h.slots)) h.slots[i] = { current: init }; return h.slots[i]; },
 useCallback: (fn: unknown) => fn,
 useEffect: (effect: () => void | (() => void)) => { if (!h.mounted) h.effects.push(effect); },
 useSyncExternalStore: (subscribe: (listener: () => void) => () => void, snapshot: () => unknown) => { if (!h.mounted) h.cleanups.push(subscribe(() => {})); return snapshot(); },
}));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", Modal: "Modal", AppState: { addEventListener: () => ({ remove() {} }) }, Alert: { alert: vi.fn() } }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
vi.mock("../src/ui/components", () => ({ Card: "Card", SectionTitle: "SectionTitle" }));
const engine = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../src/services", () => ({ get dictation() { return engine.current; } }));
vi.mock("../src/ui/preferences", () => ({ usePreferences: () => ({ t: es, theme: {
 touch: 48, spacing: (n: number) => n * 4, radius: { medium: 12 }, font: { mono: "mono" },
 colors: { text: "white", textMuted: "gray", accent: "green", accentText: "green", onAccent: "black", surface: "s", surfaceRaised: "dark", border: "line", danger: "red" },
} }) }));

const fake = fakeDictationEngine(); engine.current = fake;
const { DictationModelSheet, modelDownload } = await import("../src/ui/dictation");
const { DictationSettings } = await import("../src/ui/dictation-settings");

type Node = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Node[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 if (typeof node.type === "function") return elements((node.type as (props: unknown) => unknown)(node.props));
 return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
function mount<P>(component: (props: P) => unknown, props: P) {
 h.slots = []; h.mounted = false; h.effects = []; h.cleanups = [];
 const render = () => { h.i = 0; return elements(component(props)); };
 render(); h.mounted = true;
 for (const effect of h.effects) { const cleanup = effect(); if (cleanup) h.cleanups.push(cleanup); }
 return { render, unmount: () => { for (const cleanup of h.cleanups.splice(0)) cleanup(); } };
}
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const texts = (nodes: Node[]) => nodes.filter(n => n.type === "Text").map(n => [n.props.children].flat().join("")).join("\n");
const pressable = (nodes: Node[], label: string) => nodes.find(n => n.type === "Pressable" && (n.props.accessibilityLabel === label || texts(elements(n.props.children)) === label));
const s = es.dictation; const mb = (n: number) => Math.round(n / 1e6);
let mounted: { unmount(): void } | null = null;
beforeEach(async () => {
 fake.status = { state: "none" }; fake.ready = false; fake.starts = 0; fake.cancels = 0; fake.calls = [];
 await modelDownload?.refresh();
});
afterEach(() => { mounted?.unmount(); mounted = null; });

async function downloadingSheet(close = vi.fn()) {
 const sheet = mount(DictationModelSheet, { visible: true, close }); mounted = sheet;
 await flush();
 pressable(sheet.render(), s.download(mb(DICTATION_MODEL.bytes)))!.props.onPress();
 await flush();
 return { sheet, close };
}

it("closing the sheet with the backdrop or Back does not cancel the download", async () => {
 const { sheet, close } = await downloadingSheet();
 const nodes = sheet.render();
 nodes.find(n => n.type === "Pressable" && n.props.style?.flex === 1)!.props.onPress();
 nodes.find(n => n.type === "Modal")!.props.onRequestClose();
 await flush();
 expect(close).toHaveBeenCalledTimes(2);
 expect(fake.cancels).toBe(0);
 expect(fake.status.state).toBe("downloading");
});

it("leaving the screen (the sheet unmounts) does not cancel the download", async () => {
 const { sheet } = await downloadingSheet();
 sheet.unmount(); mounted = null; await flush();
 expect(fake.cancels).toBe(0);
 expect(fake.status.state).toBe("downloading");
});

it("only «Cancelar descarga» cancels; it says the download goes on in the background", async () => {
 const { sheet, close } = await downloadingSheet();
 const nodes = sheet.render();
 expect(texts(nodes)).toContain(s.background);
 expect(pressable(nodes, s.cancel)).toBeUndefined();
 pressable(nodes, s.cancelDownload)!.props.onPress();
 await flush();
 expect(fake.cancels).toBe(1);
 expect(close).toHaveBeenCalled();
});

it("without a download its button just closes", async () => {
 const close = vi.fn();
 const sheet = mount(DictationModelSheet, { visible: true, close }); mounted = sheet; await flush();
 pressable(sheet.render(), s.cancel)!.props.onPress(); await flush();
 expect(close).toHaveBeenCalled();
 expect(fake.cancels).toBe(0);
});

it("reopening the sheet shows the running download without starting another", async () => {
 fake.status = { state: "downloading", written: 50e6, total: DICTATION_MODEL.bytes, waiting: false };
 const sheet = mount(DictationModelSheet, { visible: true, close: vi.fn() }); mounted = sheet; await flush();
 const nodes = sheet.render();
 expect(texts(nodes)).toContain("Descargando… 50 de 356 MB");
 expect(pressable(nodes, s.download(mb(DICTATION_MODEL.bytes)))).toBeUndefined();
 expect(pressable(nodes, s.cancelDownload)).toBeDefined();
 expect(fake.starts).toBe(0);
});

it("the Settings card shows the running download's progress", async () => {
 fake.status = { state: "downloading", written: 120e6, total: DICTATION_MODEL.bytes, waiting: false };
 const card = mount(DictationSettings, undefined as never); mounted = card; await flush();
 expect(texts(card.render())).toContain("Descargando… 120 de 356 MB");
});

it("a failed download shows DOWNLOAD_FAILED and offers to download again", async () => {
 fake.status = { state: "failed" };
 const sheet = mount(DictationModelSheet, { visible: true, close: vi.fn() }); mounted = sheet; await flush();
 const nodes = sheet.render();
 expect(texts(nodes)).toContain(s.errors.DOWNLOAD_FAILED);
 expect(pressable(nodes, s.download(mb(DICTATION_MODEL.bytes)))).toBeDefined();
});
