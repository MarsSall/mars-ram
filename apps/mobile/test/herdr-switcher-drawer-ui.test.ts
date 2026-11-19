import { isValidElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { SavedHost } from "../src/core/host-catalog";
import { es } from "../src/ui/i18n/es";

// The terminal's switcher drawer opens on «Agentes», its first segment, every time (S1).
const h = vi.hoisted(() => ({
	slots: [] as unknown[],
	deps: [] as (unknown[] | undefined)[],
	pending: [] as (() => unknown)[],
	i: 0,
	dirty: false,
	list: [] as string[],
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (init: unknown) => {
		const i = h.i++;
		if (!(i in h.slots)) h.slots[i] = typeof init === "function" ? (init as () => unknown)() : init;
		return [h.slots[i], (next: unknown) => {
			const value = typeof next === "function" ? (next as (prev: unknown) => unknown)(h.slots[i]) : next;
			if (value !== h.slots[i]) { h.slots[i] = value; h.dirty = true; }
		}];
	},
	useRef: (init: unknown) => { const i = h.i++; if (!(i in h.slots)) h.slots[i] = { current: init }; return h.slots[i]; },
	useCallback: (fn: unknown) => fn,
	useEffect: (effect: () => unknown, deps?: unknown[]) => {
		const i = h.i++;
		const previous = h.deps[i];
		if (!previous || !deps || deps.some((d, n) => !Object.is(d, previous[n]))) h.pending.push(effect);
		h.deps[i] = deps;
	},
}));
vi.mock("react-native", () => ({
	AccessibilityInfo: { addEventListener: () => ({ remove() {} }), isReduceMotionEnabled: async () => true },
	AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
	Keyboard: { dismiss() {} },
	Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View",
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const hosts = vi.hoisted(() => [{ id: "a", name: "box-a" }, { id: "b", name: "box-b" }] as SavedHost[]);
vi.mock("../src/services", () => ({
	catalog: { list: async () => hosts },
	herdrSwitcher: { list: (computer: SavedHost) => { h.list.push(computer.id); return new Promise(() => {}); } },
	servers: { list: () => new Promise(() => {}) },
	sessions: { allowUnlockAgain() {} },
}));
vi.mock("../src/ui/preferences", async () => {
	const { es } = await import("../src/ui/i18n/es");
	return { usePreferences: () => ({ t: es, theme: { font: { mono: "mono" }, colors: {} } }) };
});
vi.mock("../src/ui/agent-icon", () => ({ AgentIcon: "AgentIcon" }));
vi.mock("../src/ui/tour/anchors", () => ({ TourAnchor: "TourAnchor" }));
vi.mock("../src/ui/tour/tips", () => ({ TipLayer: "TipLayer", useFirstVisitTip: () => {} }));

const { HerdrSwitcherDrawer } = await import("../src/ui/herdr-switcher");

type Node = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Node[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!isValidElement<Record<string, any>>(node)) return [];
	return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
const textOf = (node: unknown): string => {
	if (Array.isArray(node)) return node.map(textOf).join("");
	if (typeof node === "string" || typeof node === "number") return String(node);
	return isValidElement<Record<string, any>>(node) ? textOf(node.props.children) : "";
};
function render(visible: boolean): Node[] {
	let view: Node[] = [];
	for (let pass = 0; pass < 10; pass++) {
		h.i = 0; h.dirty = false; h.pending = [];
		view = elements(HerdrSwitcherDrawer({ visible, hostId: "a", close: () => {}, choose: async () => ({ ok: true, value: undefined }), chooseServer: () => {} }));
		for (const effect of h.pending) effect();
		if (!h.dirty) return view;
	}
	throw new Error("the drawer kept re-rendering");
}
const segments = (view: Node[]) => view.filter((n) => n.type === "Pressable" && n.props.accessibilityRole === "tab").map((n) => ({ label: textOf(n.props.children), selected: n.props.accessibilityState.selected, press: n.props.onPress as () => void }));
const selected = (view: Node[]) => segments(view).find((s) => s.selected)?.label;

beforeEach(() => { h.slots = []; h.deps = []; h.list = []; });

it("shows «Agentes» first and opens on it", () => {
	const view = render(true);
	expect(segments(view).map((s) => s.label)).toEqual([es.switcher.agents, es.switcher.spaces]);
	expect(selected(view)).toBe("Agentes");
	// No computer chips: those belong to «Espacios».
	expect(view.some((n) => n.type === "Pressable" && textOf(n.props.children).startsWith("● "))).toBe(false);
});

it("opens on «Agentes» again after the user left it on «Espacios»", () => {
	let view = render(true);
	segments(view)[1]!.press();
	view = render(true);
	expect(selected(view)).toBe("Espacios");
	render(false);
	view = render(true);
	expect(selected(view)).toBe("Agentes");
});

it("keeps «Agentes» reading every computer once the computers are known", async () => {
	render(true);
	await Promise.resolve(); await Promise.resolve();
	const view = render(true);
	expect(selected(view)).toBe("Agentes");
	expect([...h.list].sort()).toEqual(["a", "b"]);
});
