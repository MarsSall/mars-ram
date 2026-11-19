import { isValidElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { SavedHost } from "../src/core/host-catalog";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

// «Espacios» shows one card per workspace: name and computer, the branch on its own line, tabs as chips (S2).
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
const snapshot = vi.hoisted(() => ({ truncated: false, machines: ["mars-windows"], workspaces: [
	{ id: "w1", label: "mars-ram", focused: true, status: "working", branch: "feat/next-build-polish", tabs: [{ id: "w1:t1", label: "pi · orquestador", focused: false, status: "working", kind: "pi" }, { id: "w1:t2", label: "terminal", focused: true, status: "idle", kind: "shell" }] },
	{ id: "w2", label: "Fixes", focused: false, status: "done", branch: null, tabs: [{ id: "w2:t1", label: "tests", focused: false, status: "idle", kind: "shell" }] },
] }));
const hosts = vi.hoisted(() => [{ id: "a", name: "box-a" }, { id: "b", name: "box-b" }] as SavedHost[]);
vi.mock("../src/services", () => ({
	catalog: { list: async () => hosts },
	herdrSwitcher: { list: async (computer: SavedHost) => { h.list.push(computer.id); return { ok: true, value: snapshot }; } },
	servers: { list: () => new Promise(() => {}) },
	sessions: { allowUnlockAgain() {} },
}));
vi.mock("../src/ui/preferences", async () => {
	const { es } = await import("../src/ui/i18n/es");
	return { usePreferences: () => ({ t: es, theme: { font: { mono: "mono" }, colors: {}, radius: { small: 6, medium: 10, large: 16 }, touch: 48 } }) };
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
const chosen: [string, string, string | undefined][] = [];
function render(): Node[] {
	let view: Node[] = [];
	for (let pass = 0; pass < 10; pass++) {
		h.i = 0; h.dirty = false; h.pending = [];
		view = elements(HerdrSwitcherDrawer({ visible: true, hostId: "a", close: () => {}, choose: async (computer, workspace, tab) => { chosen.push([computer.id, workspace, tab]); return { ok: true, value: undefined }; }, chooseServer: () => {} }));
		for (const effect of h.pending) effect();
		if (!h.dirty) return view;
	}
	throw new Error("the drawer kept re-rendering");
}
const flush = async () => { for (let n = 0; n < 6; n++) await Promise.resolve(); };
async function spaces(): Promise<Node[]> {
	let view = render();
	await flush(); view = render();
	view.find((n) => n.type === "Pressable" && n.props.accessibilityRole === "tab" && textOf(n.props.children) === es.switcher.spaces)!.props.onPress();
	view = render(); await flush(); return render();
}
const buttons = (view: Node[]) => view.filter((n) => n.type === "Pressable" && n.props.accessibilityRole === "button");
const cardLabels = (view: Node[]) => buttons(view).map((n) => n.props.accessibilityLabel as string).filter((l) => l?.includes(", box-a"));
const search = (view: Node[], q: string) => view.find((n) => n.type === "TextInput")!.props.onChangeText(q);

beforeEach(() => { h.slots = []; h.deps = []; h.list = []; chosen.length = 0; });

it("shows each workspace as a card with its name, the computer and the branch line", async () => {
	const view = await spaces();
	const head = buttons(view).find((n) => n.props.accessibilityLabel === es.switcher.workspaceCard("mars-ram", "feat/next-build-polish", "box-a", es.switcher.working))!;
	expect(head).toBeDefined();
	expect(head.props.accessibilityLabel).toBe("mars-ram, rama feat/next-build-polish, box-a, Trabajando");
	const texts = elements(head.props.children).filter((n) => n.type === "Text").map((n) => textOf(n.props.children));
	expect(texts).toEqual(["mars-ram", "box-a", "⎇ feat/next-build-polish"]);
	const branch = elements(head.props.children).find((n) => textOf(n.props.children) === "⎇ feat/next-build-polish")!;
	expect(branch.props.style).toMatchObject({ fontFamily: "mono" });
	// The computer chips stay, and «Este Herdr también muestra» sits below the cards.
	expect(buttons(view).some((n) => textOf(n.props.children) === "● box-a")).toBe(true);
	const all = view.map((n) => n.type === "Text" ? textOf(n.props.children) : "");
	expect(all.lastIndexOf(es.switcher.alsoShows(["mars-windows"]))).toBeGreaterThan(all.lastIndexOf("tests"));
});

it("says «sin rama» in muted italic when the workspace has no branch", async () => {
	const view = await spaces();
	const head = buttons(view).find((n) => n.props.accessibilityLabel === "Fixes, sin rama, box-a, Listo")!;
	const none = elements(head.props.children).find((n) => textOf(n.props.children) === "sin rama")!;
	expect(none.props.style).toMatchObject({ fontStyle: "italic" });
	expect(elements(head.props.children).some((n) => textOf(n.props.children).startsWith("⎇"))).toBe(false);
	expect(es.switcher.noBranch).toBe("sin rama"); expect(en.switcher.noBranch).toBe("no branch");
	expect(en.switcher.workspaceCard("Fixes", null, "box-a")).toBe("Fixes, no branch, box-a");
});

it("focuses the right tab from its chip and the workspace from its card, with 48 dp targets", async () => {
	const view = await spaces();
	const chip = buttons(view).find((n) => n.props.accessibilityLabel === es.switcher.tabIn("tests", "Fixes"))!;
	expect(chip.props.style).toMatchObject({ minHeight: 48, minWidth: 48 });
	chip.props.onPress(); await flush();
	expect(chosen).toEqual([["a", "w2", "w2:t1"]]);
	const terminal = buttons(view).find((n) => n.props.accessibilityLabel === es.switcher.tabIn("terminal", "mars-ram"))!;
	expect(terminal.props.accessibilityState.selected).toBe(true);
	render(); terminal.props.onPress(); await flush();
	expect(chosen[1]).toEqual(["a", "w1", "w1:t2"]);
	const card = buttons(render()).find((n) => n.props.accessibilityLabel === "Fixes, sin rama, box-a, Listo")!;
	expect(card.props.style).toMatchObject({ minHeight: 48 });
	card.props.onPress(); await flush();
	expect(chosen[2]).toEqual(["a", "w2", undefined]);
});

it("still filters the cards by workspace name, branch and tab", async () => {
	let view = await spaces();
	expect(cardLabels(view)).toHaveLength(2);
	search(view, "fixes"); view = render();
	expect(cardLabels(view)).toEqual(["Fixes, sin rama, box-a, Listo"]);
	search(view, "next-build"); view = render();
	expect(cardLabels(view)).toEqual(["mars-ram, rama feat/next-build-polish, box-a, Trabajando"]);
	search(view, "orquest"); view = render();
	expect(cardLabels(view)).toEqual(["mars-ram, rama feat/next-build-polish, box-a, Trabajando"]);
	expect(buttons(view).map((n) => n.props.accessibilityLabel)).toContain(es.switcher.tabIn("pi · orquestador", "mars-ram"));
	expect(buttons(view).map((n) => n.props.accessibilityLabel)).not.toContain(es.switcher.tabIn("terminal", "mars-ram"));
	search(view, "nada"); view = render();
	expect(cardLabels(view)).toEqual([]);
	expect(view.some((n) => n.type === "Text" && textOf(n.props.children) === es.switcher.noMatches)).toBe(true);
});
