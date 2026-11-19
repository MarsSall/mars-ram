import { createElement, isValidElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { SubagentsMode } from "../src/core/subagents-mode";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";

// The «Preview» of the subagents mode in Personalización (design/subagentes-preview/01-miniatura-bajo-el-selector.html, S10).
const h = vi.hoisted(() => ({ slots: [] as unknown[], i: 0, t: undefined as unknown }));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (init: unknown) => {
		const i = h.i++;
		if (!(i in h.slots)) h.slots[i] = typeof init === "function" ? (init as () => unknown)() : init;
		return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === "function" ? (next as (prev: unknown) => unknown)(h.slots[i]) : next; }];
	},
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
vi.mock("react-native", () => ({ Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" }));
vi.mock("../src/ui/components", () => ({ Card: "Card", StatusPill: "StatusPill" }));
vi.mock("../src/ui/preferences", async () => {
	const { es } = await import("../src/ui/i18n/es");
	return {
		usePreferences: () => ({
			t: h.t ?? es,
			theme: {
				spacing: (n: number) => n * 4, touch: 48, radius: { small: 6, medium: 10, large: 16 }, font: { mono: "mono" },
				colors: { text: "text", textMuted: "muted", accentText: "accent", attention: "attention", working: "working", surface: "surface", surfaceRaised: "raised", border: "border", card: "card" },
			},
		}),
	};
});

const { SubagentsPreview } = await import("../src/ui/subagents-preview");
const { SubagentsCount, SubagentsCounter, SubagentsSummary } = await import("../src/ui/subagents");

type Node = { type: unknown; props: Record<string, any> };
/** The rendered tree; function components inside the preview are expanded but stay listed by type. */
function elements(node: unknown): Node[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!isValidElement<Record<string, any>>(node)) return [];
	if (typeof node.type === "function") return [{ type: node.type, props: node.props }, ...elements((node.type as (props: unknown) => unknown)(node.props))];
	return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
const textOf = (node: unknown): string => {
	if (Array.isArray(node)) return node.map(textOf).join("");
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (isValidElement<Record<string, any>>(node)) return textOf(node.props.children);
	return "";
};
const render = (mode: SubagentsMode) => { h.i = 0; return elements(createElement(SubagentsPreview, { mode })); };
const toggle = (view: Node[]) => view.find((n) => n.type === "Pressable" && n.props.accessibilityState?.expanded !== undefined)!;
const box = (view: Node[]) => view.find((n) => n.type === "View" && n.props.pointerEvents === "none");
const allText = (nodes: Node[]) => nodes.filter((n) => n.type === "Text").map((n) => textOf(n.props.children));
const open = (mode: SubagentsMode) => { toggle(render(mode)).props.onPress(); return render(mode); };

beforeEach(() => { h.slots = []; h.t = undefined; });

it("starts collapsed: only the «Preview» button and the mode's line", () => {
	const view = render("session");
	expect(box(view)).toBeUndefined();
	const button = toggle(view);
	expect(button.props).toMatchObject({ accessibilityRole: "button", accessibilityLabel: "Mostrar la vista previa", accessibilityState: { expanded: false } });
	expect(button.props.style({ pressed: false }).minHeight).toBe(48);
	expect(textOf(button.props.children)).toBe("Preview");
	expect(view.find((n) => n.type === "Ionicons")!.props.name).toBe("chevron-down");
	expect(allText(view)).toContain(es.settings.subagentsPreview.hints.session);
	expect(view.some((n) => n.type === "Card")).toBe(false);
});

it("pressing «Preview» shows the box and the button then hides it", () => {
	let view = open("session");
	expect(box(view)).toBeDefined();
	expect(toggle(view).props).toMatchObject({ accessibilityLabel: "Ocultar la vista previa", accessibilityState: { expanded: true } });
	expect(view.find((n) => n.type === "Ionicons")!.props.name).toBe("chevron-up");
	toggle(view).props.onPress();
	view = render("session");
	expect(box(view)).toBeUndefined();
	expect(toggle(view).props.accessibilityLabel).toBe("Mostrar la vista previa");
});

it("«Por sesión» shows each sample card with its own counter, as one non-interactive summary", () => {
	const view = open("session");
	const preview = box(view)!;
	expect(preview.props).toMatchObject({ accessible: true, accessibilityLabel: "Vista previa de Inicio con «Por sesión», con dos sesiones de ejemplo.", style: expect.objectContaining({ borderStyle: "dashed" }) });
	const inside = elements(preview.props.children);
	expect(inside.filter((n) => n.type === "Card")).toHaveLength(2);
	expect(inside.filter((n) => n.type === "StatusPill").map((n) => n.props.status)).toEqual(["attention", "working"]);
	const counters = inside.filter((n) => n.type === SubagentsCounter);
	expect(counters.map((n) => n.props.items.length)).toEqual([2, 1]);
	expect(allText(inside)).toEqual(expect.arrayContaining(["Vista previa", "pi · proyecto", "pi · api", "⑂ 2 subagentes · 1 te pregunta algo", "⑂ 1 subagente"]));
	expect(inside.some((n) => n.type === SubagentsSummary || n.type === SubagentsCount)).toBe(false);
	// Pressing anything inside opens nothing: no sheet exists here.
	for (const counter of counters) expect(counter.props.onOpen()).toBeUndefined();
	expect(view.some((n) => n.type === "Modal")).toBe(false);
	expect(allText(view).at(-1)).toBe(es.settings.subagentsPreview.hints.session);
});

it("«Arriba» shows the summary row and small card text", () => {
	const inside = elements(box(open("top"))!.props.children);
	const summary = inside.find((n) => n.type === SubagentsSummary)!;
	expect(summary.props.groups.map((g: { title: string }) => g.title)).toEqual(["pi · proyecto", "pi · api"]);
	expect(allText(inside)).toContain("⑂ 3 subagentes en 2 sesiones · 1 te pregunta algo");
	expect(inside.filter((n) => n.type === SubagentsCount).map((n) => n.props.items.length)).toEqual([2, 1]);
	expect(inside.some((n) => n.type === SubagentsCounter)).toBe(false);
	const view = render("top");
	expect(box(view)!.props.accessibilityLabel).toBe("Vista previa de Inicio con «Arriba», con dos sesiones de ejemplo.");
	expect(allText(view).at(-1)).toBe("Una fila arriba suma todo y abre la lista agrupada por sesión.");
});

it("«Ocultos» shows plain cards with no subagent UI", () => {
	const view = open("hidden");
	const inside = elements(box(view)!.props.children);
	expect(inside.filter((n) => n.type === "Card")).toHaveLength(2);
	expect(inside.some((n) => n.type === SubagentsCounter || n.type === SubagentsCount || n.type === SubagentsSummary)).toBe(false);
	expect(allText(inside).some((text) => text.includes("⑂"))).toBe(false);
	expect(inside.filter((n) => n.type === "StatusPill").map((n) => n.props.status)).toEqual(["attention", "working"]);
	expect(allText(view).at(-1)).toBe("No se muestran subagentes; si uno te pregunta algo, la sesión igual avisa.");
});

it("follows the selected mode while it stays open", () => {
	open("session");
	expect(elements(box(render("session"))!.props.children).some((n) => n.type === SubagentsCounter)).toBe(true);
	const top = render("top");
	expect(box(top)).toBeDefined();
	expect(elements(box(top)!.props.children).some((n) => n.type === SubagentsSummary)).toBe(true);
	const hidden = render("hidden");
	expect(elements(box(hidden)!.props.children).some((n) => n.type === SubagentsSummary || n.type === SubagentsCounter)).toBe(false);
});

it("reads in English, keeping «Preview» as the button text", () => {
	h.t = en;
	let view = render("top");
	expect(textOf(toggle(view).props.children)).toBe("Preview");
	expect(toggle(view).props.accessibilityLabel).toBe("Show the preview");
	toggle(view).props.onPress();
	view = render("top");
	expect(toggle(view).props.accessibilityLabel).toBe("Hide the preview");
	expect(box(view)!.props.accessibilityLabel).toBe("Preview of Home with «On top», using two sample sessions.");
	expect(allText(view)).toEqual(expect.arrayContaining(["pi · project", "pi · api", "One row on top adds everything up and opens the list grouped by session."]));
	expect(allText(render("session")).at(-1)).toBe("Each session shows its counter; tap it to see its subagents.");
	expect(allText(render("hidden")).at(-1)).toBe("No subagents are shown; if one asks you something, the session still lets you know.");
});

it("uses only the two invented sessions, never Home's data", async () => {
	const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("../src/ui/subagents-preview.tsx", import.meta.url), "utf8"));
	expect(source).not.toMatch(/useSessions|use-sessions|bridge|adapters/);
	const inside = elements(box(open("session"))!.props.children);
	expect(inside.filter((n) => n.type === "Card").map((n) => n.props.children[0].props.children)).toEqual(["pi · proyecto", "pi · api"]);
});
