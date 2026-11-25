import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../src/core/session-list";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

// claude-codex-support T3b: agent badges and pending approvals on Home cards (S5, S7).
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
vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }), useFocusEffect: () => {} }));
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
vi.mock("../src/ui/use-sessions", () => ({ useSessions: () => ({ data: h.data, refreshing: false, refresh: vi.fn() }) }));
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

const session = (id: string, extra: Partial<SessionSummary> = {}): SessionSummary => ({
	key: `box/${id}`, hostId: "box", bridgeInstanceId: id, project: `proj-${id}`, cwd: `/work/${id}`, status: "working", lastActivityAt: Date.now(), lastMessage: null, ...extra,
});
const show = (...sessions: SessionSummary[]) => {
	h.data = { hosts: [{ id: "box", name: "workbench", user: "dev", address: "100.64.0.9" }], computers: [{ hostId: "box", state: "ok", sessions }], updates: {}, updatedAt: 0 };
};
const cards = (view: Node[]) => view.filter((n) => n.type === "Card");
const ask = { id: "a1", kind: "command" as const, title: "Run tests", detail: "pnpm test", choices: ["accept" as const, "decline" as const] };

beforeEach(() => {
	h.slots = []; h.deps = []; h.t = undefined; h.mode = "session"; h.style = undefined; h.push = () => {};
});

describe("agents on Home", () => {
	it("keeps a Pi card as before: no badge and no approvals line (S5)", () => {
		show(session("pi"));
		const view = render();
		expect(texts(view).some((t) => t.includes("Claude Code") || t.includes("Codex") || t.includes("aprobaci"))).toBe(false);
		expect(view.some((n) => n.props.accessibilityLabel?.startsWith?.("Agente:"))).toBe(false);
	});

	it("labels Claude Code and Codex cards with a text badge", () => {
		show(session("c", { agent: "claude-code" }), session("x", { agent: "codex", status: "done" }));
		const view = render();
		expect(texts(view)).toEqual(expect.arrayContaining(["Claude Code", "Codex"]));
		expect(view.filter((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Agente:")).map((n) => n.props.accessibilityLabel)).toEqual(["Agente: Claude Code", "Agente: Codex"]);
	});

	it("puts a session with a pending approval in «Te necesitan» with its count", () => {
		show(session("c", { agent: "claude-code", status: "attention", approvals: [ask] }), session("pi"));
		const view = render();
		expect(view.filter((n) => n.type === "SectionTitle").map((n) => textOf(n.props.children))).toContain("Te necesitan");
		const first = cards(view)[0]!;
		const inside = elements(first.props.children);
		expect(inside.find((n) => n.type === "StatusPill")!.props.status).toBe("attention");
		expect(texts(inside)).toContain("1 aprobación pendiente");
		h.t = en; h.slots = []; h.deps = [];
		show(session("c", { agent: "claude-code", status: "attention", approvals: [ask, { ...ask, id: "a2" }] }));
		expect(texts(render())).toContain("2 approvals waiting");
	});

	it("opens a non-Pi session with its agent, and a Pi session exactly as before", () => {
		const routes: unknown[] = [];
		h.push = (route) => routes.push(route);
		show(session("c", { agent: "codex" }), session("pi"));
		for (const card of cards(render())) card.props.onPress();
		expect(routes).toEqual([
			{ pathname: "/session/[id]", params: { id: "box/c", project: "proj-c", cwd: "/work/c", computer: "workbench", agent: "codex" } },
			{ pathname: "/session/[id]", params: { id: "box/pi", project: "proj-pi", cwd: "/work/pi", computer: "workbench" } },
		]);
	});
});
