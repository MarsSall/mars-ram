import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../src/core/session-list";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

// claude-codex L20: Home reordered its cards under the user's finger right after returning to it.
const h = vi.hoisted(() => ({
	slots: [] as unknown[],
	deps: [] as (unknown[] | undefined)[],
	pending: [] as (() => void)[],
	i: 0,
	dirty: false,
	data: null as unknown,
	t: undefined as unknown,
	mode: "session" as string,
	style: undefined as unknown,
	push: (() => {}) as (route: unknown) => void,
	focus: [] as (() => void | (() => void))[],
	refresh: (() => {}) as () => void,
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	// A one-component hook harness: state survives renders; effects run after a render when their deps change.
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
	useEffect: (effect: () => void, deps?: unknown[]) => {
		const i = h.i++;
		const previous = h.deps[i];
		if (!previous || !deps || deps.some((d, n) => !Object.is(d, previous[n]))) h.pending.push(effect);
		h.deps[i] = deps;
	},
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }), useFocusEffect: (effect: () => void | (() => void)) => { h.focus[0] = effect; } }));
vi.mock("react-native", () => ({ Modal: "Modal", Pressable: "Pressable", RefreshControl: "RefreshControl", ScrollView: "ScrollView", Text: "Text", View: "View" }));
vi.mock("../src/ui/components", () => ({ Card: "Card", EmptyState: "EmptyState", Screen: "Screen", SectionTitle: "SectionTitle", StatusPill: "StatusPill" }));
vi.mock("../src/ui/tour/anchors", () => ({ TourAnchor: "TourAnchor" }));
vi.mock("../src/ui/tour/scroll", () => ({ useTourScroll: () => ({ props: {}, place: () => undefined }) }));
vi.mock("../src/ui/preferences", async () => {
	const { es } = await import("../src/ui/i18n/es");
	return {
		usePreferences: () => ({
			t: h.t ?? es,
			subagentsMode: h.mode,
			theme: {
				...(h.style ? { style: h.style } : {}),
				spacing: (n: number) => n * 4, touch: 48, radius: { small: 6, medium: 10, large: 16 }, font: { mono: "mono" },
				colors: { text: "text", textMuted: "muted", accentText: "accent", attention: "attention", working: "working", surface: "surface", surfaceRaised: "raised", border: "border", card: "card", danger: "danger" },
			},
		}),
	};
});
vi.mock("../src/ui/use-sessions", () => ({ useSessions: () => ({ data: h.data, refreshing: false, refresh: () => h.refresh() }) }));
vi.mock("../src/ui/use-phone-network-state", () => ({ usePhoneNetworkState: () => null }));
vi.mock("../src/ui/network-hint", () => ({ networkHintText: () => null }));
vi.mock("../src/ui/home-welcome", () => ({ HomeHeading: "HomeHeading", HomeWelcome: "HomeWelcome" }));
vi.mock("../src/ui/shortcuts", () => ({ ShortcutsSection: "ShortcutsSection" }));
vi.mock("../src/ui/host-update-notice", () => ({ HostUpdateNotice: "HostUpdateNotice" }));
vi.mock("../src/ui/app-update-notice", () => ({ AppUpdateNotice: "AppUpdateNotice" }));

const { default: HomeScreen } = await import("../src/app/(tabs)/index");

type Node = { type: unknown; props: Record<string, any> };
/** The rendered tree, with this feature's function components expanded. */
function elements(node: unknown): Node[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!isValidElement<Record<string, any>>(node)) return [];
	if (typeof node.type === "function") return elements((node.type as (props: unknown) => unknown)(node.props));
	return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
const textOf = (node: unknown): string => {
	if (Array.isArray(node)) return node.map(textOf).join("");
	if (typeof node === "string" || typeof node === "number") return String(node);
	return isValidElement<Record<string, any>>(node) ? textOf(node.props.children) : "";
};
const texts = (nodes: Node[]) => nodes.filter((n) => n.type === "Text").map((n) => textOf(n.props.children));
const styleOf = (node: Node) => (typeof node.props.style === "function" ? node.props.style({ pressed: false }) : node.props.style);

function render(): Node[] {
	let view: Node[] = [];
	for (let pass = 0; pass < 10; pass++) {
		h.i = 0; h.dirty = false; h.pending = [];
		view = elements(HomeScreen());
		for (const effect of h.pending) effect();
		if (!h.dirty) return view;
	}
	throw new Error("Home kept re-rendering");
}

let blur: (() => void) | void;
function focus() { render(); blur = h.focus[0]!(); }
function leave() { if (typeof blur === "function") blur(); }
const session = (id: string, lastActivityAt: number, extra: Partial<SessionSummary> = {}): SessionSummary => ({
	key: `box/${id}`, hostId: "box", bridgeInstanceId: id, project: id, cwd: `/work/${id}`, status: "working", lastActivityAt, lastMessage: null, ...extra,
});
const show = (...sessions: SessionSummary[]) => {
	h.data = { hosts: [{ id: "box", name: "workbench", user: "dev", address: "100.64.0.9" }], computers: [{ hostId: "box", state: "ok", sessions }], updates: {}, updatedAt: 0 };
};
const order = (view: Node[]) => view.filter((n) => n.type === "Card").map((n) => texts(elements(n.props.children))[0]);

beforeEach(() => {
	h.slots = []; h.deps = []; h.t = undefined; h.mode = "session"; h.style = undefined; h.push = () => {}; h.focus = []; h.refresh = () => {}; blur = undefined;
});

describe("Home card order while the screen is in view", () => {
	it("keeps cards in place when a refresh after returning brings newer activity", () => {
		show(session("mars-ram", 100), session("LosNonosHQ", 50));
		focus();
		expect(order(render())).toEqual(["mars-ram", "LosNonosHQ"]);
		leave(); focus();
		// The focus refresh (or the next live update) arrives while the user aims at a card.
		show(session("mars-ram", 100), session("LosNonosHQ", 200));
		expect(order(render())).toEqual(["mars-ram", "LosNonosHQ"]);
		show(session("mars-ram", 300), session("LosNonosHQ", 400, { status: "done" }));
		expect(order(render())).toEqual(["mars-ram", "LosNonosHQ"]);
	});

	it("appends new sessions and drops closed ones without moving the others", () => {
		show(session("a", 300), session("b", 200), session("c", 100));
		focus(); render();
		show(session("new", 999), session("c", 500), session("a", 300));
		expect(order(render())).toEqual(["a", "c", "new"]);
	});

	it("applies the newest-first order on the next visit, already in place when Home shows again", () => {
		show(session("mars-ram", 100), session("LosNonosHQ", 50));
		focus(); render();
		show(session("mars-ram", 100), session("LosNonosHQ", 200));
		render();
		leave();
		expect(order(render())).toEqual(["LosNonosHQ", "mars-ram"]);
		focus();
		show(session("mars-ram", 100), session("LosNonosHQ", 200));
		expect(order(render())).toEqual(["LosNonosHQ", "mars-ram"]);
	});

	it("applies the newest-first order on pull-to-refresh", () => {
		show(session("mars-ram", 100), session("LosNonosHQ", 50));
		focus(); render();
		let pulled = false; h.refresh = () => { pulled = true; };
		render().find((n) => n.type === "RefreshControl" || n.props.refreshControl)!.props.refreshControl.props.onRefresh();
		expect(pulled).toBe(true);
		show(session("mars-ram", 100), session("LosNonosHQ", 200));
		expect(order(render())).toEqual(["LosNonosHQ", "mars-ram"]);
	});
});
