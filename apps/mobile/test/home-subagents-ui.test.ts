import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubagentItem } from "@workspace/protocol";
import type { SessionSummary } from "../src/core/session-list";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

// Home's subagents counter and bottom sheet (design/subagentes-inicio/02-hoja-inferior.html, S4–S6).
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
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }), useFocusEffect: () => {} }));
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
const { SubagentsCounter, SubagentsSheet, SubagentsSummary, sheetSession } = await import("../src/ui/subagents");

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

const MIN = 60_000;
const item = (id: string, extra: Partial<SubagentItem> = {}): SubagentItem => ({ id, agent: "explore", label: `Task ${id}`, status: "running", question: false, since: Date.now() - 4 * MIN, ...extra });
const session = (id: string, extra: Partial<SessionSummary> = {}): SessionSummary => ({
	key: `box/${id}`, hostId: "box", bridgeInstanceId: id, project: `pi · ${id}`, cwd: `/work/${id}`, status: "working", lastActivityAt: Date.now(), lastMessage: null, ...extra,
});
const show = (...sessions: SessionSummary[]) => {
	h.data = { hosts: [{ id: "box", name: "workbench", user: "dev", address: "100.64.0.9" }], computers: [{ hostId: "box", state: "ok", sessions }], updates: {}, updatedAt: 0 };
};
const counters = (view: Node[]) => view.filter((n) => n.type === "Pressable" && n.props.accessibilityRole === "button" && /subagent/.test(n.props.accessibilityLabel ?? "") && !/ses(ión|iones|sion)/.test(n.props.accessibilityLabel ?? ""));
const summaries = (view: Node[]) => view.filter((n) => n.type === "Pressable" && n.props.accessibilityRole === "button" && /subagent.* (en|in) \d+ ses/.test(n.props.accessibilityLabel ?? ""));
const modal = (view: Node[]) => view.find((n) => n.type === "Modal")!;

beforeEach(() => {
	h.slots = []; h.deps = []; h.t = undefined; h.mode = "session"; h.style = undefined;
});

describe("the subagents counter", () => {
	it("is not on a card without subagents, so Home looks as before (S6)", () => {
		show(session("plain"), session("other", { status: "done" }));
		const view = render();
		expect(counters(view)).toEqual([]);
		expect(texts(view).some((t) => t.includes("⑂"))).toBe(false);
		expect(modal(view).props.visible).toBe(false);
	});

	it("counts in singular and plural, in the accent color, as a touch-sized button with a full label", () => {
		const one = elements(SubagentsCounter({ items: [item("a")], onOpen: () => {} }));
		expect(texts(one)[0]).toBe("⑂ 1 subagente");
		const button = one.find((n) => n.type === "Pressable")!;
		expect(button.props.accessibilityRole).toBe("button");
		expect(button.props.accessibilityLabel).toBe("1 subagente. Muestra la lista.");
		expect(styleOf(button).minHeight).toBe(48);
		expect(one.find((n) => n.type === "Text")!.props.style.color).toBe("accent");

		const three = elements(SubagentsCounter({ items: [item("a"), item("b"), item("c", { status: "queued" })], onOpen: () => {} }));
		expect(texts(three)[0]).toBe("⑂ 3 subagentes");
		expect(three.some((n) => n.type === "Text" && n.props.style.color === "attention")).toBe(false);
	});

	it("adds «· N te pregunta algo» in the attention color when some ask", () => {
		const view = elements(SubagentsCounter({ items: [item("a", { status: "waiting", question: true }), item("b"), item("c")], onOpen: () => {} }));
		expect(texts(view)[0]).toBe("⑂ 3 subagentes · 1 te pregunta algo");
		const asking = view.find((n) => n.type === "Text" && n.props.style.color === "attention")!;
		expect(textOf(asking.props.children)).toBe(" · 1 te pregunta algo");
		expect(view.find((n) => n.type === "Pressable")!.props.accessibilityLabel).toBe("3 subagentes, 1 te pregunta algo. Muestra la lista.");
	});

	it("uses the Spanish plural when several ask", () => {
		const view = elements(SubagentsCounter({ items: [item("a", { status: "waiting", question: true }), item("b", { status: "waiting", question: true }), item("c")], onOpen: () => {} }));
		expect(texts(view)[0]).toBe("⑂ 3 subagentes · 2 te preguntan algo");
		expect(view.find((n) => n.type === "Pressable")!.props.accessibilityLabel).toBe("3 subagentes, 2 te preguntan algo. Muestra la lista.");
	});

	it("reads in English too", () => {
		h.t = en;
		expect(texts(elements(SubagentsCounter({ items: [item("a")], onOpen: () => {} })))[0]).toBe("⑂ 1 subagent");
		const two = elements(SubagentsCounter({ items: [item("a", { question: true }), item("b", { question: true })], onOpen: () => {} }));
		expect(texts(two)[0]).toBe("⑂ 2 subagents · 2 asking you something");
	});
});

describe("the subagents sheet", () => {
	const items = [
		item("ask", { agent: "worker", label: "Settings screen", status: "waiting", question: true, since: Date.now() - 2 * MIN }),
		item("run", { agent: "explore", label: "Map the themes", status: "running", since: Date.now() - 4 * MIN }),
		item("new", { agent: "explore", label: "Just started", status: "running", since: Date.now() - 10_000 }),
		item("wait", { agent: "verify", label: "Check the crypto", status: "waiting", since: Date.now() - 7 * MIN }),
		item("later", { agent: "verify", label: "Run the suite", status: "queued" }),
	];

	it("lists each subagent with its tag, label, and state in its color", () => {
		const view = elements(SubagentsSheet({ title: "pi · shop", items, visible: true, onClose: () => {}, now: Date.now() }));
		expect(texts(view)).toEqual([
			"Subagentes de pi · shop",
			"worker", "Settings screen", "Necesita tu atención · hace 2 min",
			"explore", "Map the themes", "Trabajando · hace 4 min",
			"explore", "Just started", "Trabajando · recién",
			"verify", "Check the crypto", "Esperando · hace 7 min",
			"verify", "Run the suite", "En cola",
			"Listo",
		]);
		const color = (text: string) => view.find((n) => n.type === "Text" && textOf(n.props.children) === text)!.props.style.color;
		expect(color("Necesita tu atención · hace 2 min")).toBe("attention");
		expect(color("Trabajando · hace 4 min")).toBe("working");
		expect(color("Esperando · hace 7 min")).toBe("muted");
		expect(color("En cola")).toBe("muted");
		expect(modal(view).props).toMatchObject({ transparent: true, visible: true });
	});

	it("reads in English too", () => {
		h.t = en;
		const view = elements(SubagentsSheet({ title: "pi · shop", items, visible: true, onClose: () => {}, now: Date.now() }));
		expect(texts(view)).toEqual(expect.arrayContaining(["Subagents of pi · shop", "Needs your attention · 2 min ago", "Working · 4 min ago", "Working · just now", "Waiting · 7 min ago", "Queued", "Done"]));
	});

	it("closes with «Listo», the scrim, and the hardware back button", () => {
		const onClose = vi.fn();
		const view = elements(SubagentsSheet({ title: "pi · shop", items, visible: true, onClose, now: Date.now() }));
		const done = view.find((n) => n.type === "Pressable" && texts(elements(n.props.children)).join("") === "Listo")!;
		expect(styleOf(done).minHeight).toBe(48);
		done.props.onPress();
		modal(view).props.onRequestClose();
		view.find((n) => n.type === "Pressable" && n.props.accessibilityLabel === "Listo")!.props.onPress();
		expect(onClose).toHaveBeenCalledTimes(3);
	});

	it("follows the latest refresh, and has nothing to show once the subagents are gone", () => {
		const with2 = session("a", { subagents: [item("x")] });
		expect(sheetSession([with2], "box/a")).toBe(with2);
		expect(sheetSession([session("a")], "box/a")).toBeNull();
		expect(sheetSession([session("b", { subagents: [item("x")] })], "box/a")).toBeNull();
		expect(sheetSession([with2], null)).toBeNull();
	});
});

describe("Home with subagents", () => {
	it("opens the sheet from the card, updates it with each refresh, and «Listo» closes it", () => {
		show(session("shop", { subagents: [item("a"), item("b", { status: "queued" })] }), session("plain"));
		let view = render();
		expect(counters(view)).toHaveLength(1);
		expect(modal(view).props.visible).toBe(false);

		counters(view)[0]!.props.onPress();
		view = render();
		expect(modal(view).props.visible).toBe(true);
		expect(texts(elements(modal(view).props.children))).toEqual(expect.arrayContaining(["Subagentes de pi · shop", "Task a", "Trabajando · hace 4 min", "Task b", "En cola"]));

		// The next Home refresh: one more subagent, now asking. The card needs attention (S5) and the sheet shows it.
		show(session("shop", { status: "attention", subagents: [item("c", { status: "waiting", question: true, since: Date.now() - MIN }), item("a")] }), session("plain"));
		view = render();
		const sheet = texts(elements(modal(view).props.children));
		expect(sheet).toEqual(expect.arrayContaining(["Task c", "Necesita tu atención · hace 1 min", "Task a"]));
		expect(sheet).not.toContain("Task b");
		expect(texts(view)).toContain("⑂ 2 subagentes · 1 te pregunta algo");

		const done = elements(modal(view).props.children).find((n) => n.type === "Pressable" && n.props.accessibilityRole === "button")!;
		done.props.onPress();
		view = render();
		expect(modal(view).props.visible).toBe(false);
	});

	it("closes the open sheet when the session's subagents finish", () => {
		show(session("shop", { subagents: [item("a")] }));
		let view = render();
		counters(view)[0]!.props.onPress();
		view = render();
		expect(modal(view).props.visible).toBe(true);

		show(session("shop"));
		view = render();
		expect(modal(view).props.visible).toBe(false);
		expect(counters(view)).toEqual([]);

		// The subagents come back later: the sheet stays closed until tapped again.
		show(session("shop", { subagents: [item("b")] }));
		view = render();
		expect(modal(view).props.visible).toBe(false);
	});
});

describe("Home with subagents «Arriba» (S3)", () => {
	const asking = { status: "waiting" as const, question: true };
	it("sums every session's subagents in one row below the heading, and each card only counts its own", () => {
		h.mode = "top";
		show(session("shop", { subagents: [item("a"), item("b", asking), item("c", { status: "queued" })] }), session("mail", { subagents: [item("d")] }), session("plain"));
		const view = render();
		expect(counters(view)).toEqual([]);
		const [summary, ...more] = summaries(view);
		expect(more).toEqual([]);
		expect(texts(elements(summary!.props.children))[0]).toBe("⑂ 4 subagentes en 2 sesiones · 1 te pregunta algo");
		expect(summary!.props.accessibilityLabel).toBe("4 subagentes en 2 sesiones, 1 te pregunta algo. Muestra la lista.");
		expect(styleOf(summary!).minHeight).toBe(48);
		expect(styleOf(summary!).borderColor).toBe("attention");
		const askingText = elements(summary!.props.children).find((n) => n.type === "Text" && n.props.style.color === "attention")!;
		expect(textOf(askingText.props.children)).toBe(" · 1 te pregunta algo");
		// Below the heading, before the sessions.
		const heading = view.findIndex((n) => n.type === "HomeHeading");
		const at = view.indexOf(summary!);
		expect(at).toBeGreaterThan(heading);
		expect(at).toBeLessThan(view.findIndex((n) => n.type === "Card"));
		// Cards: a small muted count, no button.
		const muted = view.filter((n) => n.type === "Text" && n.props.style?.color === "muted" && textOf(n.props.children).startsWith("⑂"));
		expect(muted.map((n) => textOf(n.props.children))).toEqual(expect.arrayContaining(["⑂ 3 subagentes", "⑂ 1 subagente"]));
		expect(muted).toHaveLength(2);
	});

	it("uses the singular for one subagent in one session, and the plural when several ask", () => {
		h.mode = "top";
		show(session("shop", { subagents: [item("a")] }));
		expect(texts(elements(summaries(render())[0]!.props.children))[0]).toBe("⑂ 1 subagente en 1 sesión");
		h.slots = []; h.deps = [];
		show(session("shop", { subagents: [item("a", asking), item("b", asking)] }));
		const summary = summaries(render())[0]!;
		expect(texts(elements(summary.props.children))[0]).toBe("⑂ 2 subagentes en 1 sesión · 2 te preguntan algo");
		expect(styleOf(summary).borderColor).toBe("attention");
	});

	it("reads in English too", () => {
		h.mode = "top"; h.t = en;
		show(session("shop", { subagents: [item("a", asking)] }), session("mail", { subagents: [item("b"), item("c")] }));
		const summary = summaries(render())[0]!;
		expect(texts(elements(summary.props.children))[0]).toBe("⑂ 3 subagents in 2 sessions · 1 asking you something");
		expect(elements(SubagentsSummary({ groups: [{ key: "k", title: "t", items: [item("a")] }], onOpen: () => {} })).find((n) => n.type === "Pressable")!.props.accessibilityLabel).toBe("1 subagent in 1 session. Shows the list.");
	});

	it("is not shown when no session has subagents", () => {
		h.mode = "top";
		show(session("plain"), session("other", { status: "done" }));
		const view = render();
		expect(summaries(view)).toEqual([]);
		expect(texts(view).some((t) => t.includes("⑂"))).toBe(false);
		expect(modal(view).props.visible).toBe(false);
	});

	it("opens one sheet grouped by session, follows the refresh, «Listo» closes it, and it closes when none remain", () => {
		h.mode = "top";
		show(session("shop", { subagents: [item("a"), item("b", { status: "queued" })] }), session("mail", { subagents: [item("c")] }), session("plain"));
		let view = render();
		expect(view.filter((n) => n.type === "Modal")).toHaveLength(1);
		expect(modal(view).props.visible).toBe(false);
		summaries(view)[0]!.props.onPress();
		view = render();
		expect(modal(view).props.visible).toBe(true);
		expect(texts(elements(modal(view).props.children))).toEqual([
			"Subagentes",
			"pi · shop", "explore", "Task a", "Trabajando · hace 4 min", "explore", "Task b", "En cola",
			"pi · mail", "explore", "Task c", "Trabajando · hace 4 min",
			"Listo",
		]);

		// The next refresh: «mail» finished, «shop» now asks.
		show(session("shop", { status: "attention", subagents: [item("a", { ...asking, since: Date.now() - MIN })] }), session("mail"), session("plain"));
		view = render();
		const sheet = texts(elements(modal(view).props.children));
		expect(sheet).toEqual(["Subagentes", "pi · shop", "explore", "Task a", "Necesita tu atención · hace 1 min", "Listo"]);

		const done = elements(modal(view).props.children).find((n) => n.type === "Pressable" && n.props.accessibilityRole === "button")!;
		done.props.onPress();
		view = render();
		expect(modal(view).props.visible).toBe(false);

		summaries(view)[0]!.props.onPress();
		view = render();
		expect(modal(view).props.visible).toBe(true);
		show(session("shop"), session("plain"));
		view = render();
		expect(modal(view).props.visible).toBe(false);
		expect(summaries(view)).toEqual([]);
		// They come back: the sheet stays closed until tapped again.
		show(session("shop", { subagents: [item("z")] }));
		view = render();
		expect(modal(view).props.visible).toBe(false);
		expect(summaries(view)).toHaveLength(1);
	});
});

describe("Home with subagents «Ocultos» (S3)", () => {
	it("shows no subagent UI at all, while a question still marks the session as needing attention", () => {
		h.mode = "hidden";
		show(session("shop", { status: "attention", subagents: [item("a", { status: "waiting", question: true })] }), session("mail", { subagents: [item("b")] }));
		const view = render();
		expect(counters(view)).toEqual([]);
		expect(summaries(view)).toEqual([]);
		expect(texts(view).some((t) => t.includes("⑂"))).toBe(false);
		expect(view.some((n) => n.type === "Modal")).toBe(false);
		expect(view.filter((n) => n.type === "StatusPill").map((n) => n.props.status)).toContain("attention");
		expect(view.some((n) => n.type === "SectionTitle" && n.props.children === es.home.needsYou)).toBe(true);
	});
});

it("has every subagents string in English and Spanish", () => {
	expect(Object.keys(es.subagents).sort()).toEqual(Object.keys(en.subagents).sort());
	expect(es.subagents.done).toBe("Listo");
	expect(en.subagents.done).toBe("Done");
});

describe("session titles with a gift theme's monospace titles", () => {
	const titleNodes = (view: Node[]) => view.filter((n) => n.type === "Text" && textOf(n.props.children) === "pi · plain");
	it("are set in monospace only when the theme asks for it", () => {
		show(session("plain"));
		expect(titleNodes(render()).every((n) => n.props.style.fontFamily === undefined)).toBe(true);
		h.slots = []; h.deps = [];
		h.style = { titles: "mono" };
		const titles = titleNodes(render());
		expect(titles.length).toBeGreaterThan(0);
		expect(titles.every((n) => n.props.style.fontFamily === "mono")).toBe(true);
	});
});
