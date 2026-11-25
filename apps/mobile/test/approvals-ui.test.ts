import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "@workspace/protocol";
import { en } from "../src/ui/i18n/en";

// claude-codex-support S7/T3b: the approval card, its buttons, and the agent badges.
const h = vi.hoisted(() => ({ slots: [] as unknown[], i: 0, t: undefined as unknown }));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (init: unknown) => {
		const i = h.i++;
		if (!(i in h.slots)) h.slots[i] = typeof init === "function" ? (init as () => unknown)() : init;
		return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === "function" ? (next as (prev: unknown) => unknown)(h.slots[i]) : next; }];
	},
}));
vi.mock("react-native", () => ({ Image: "Image", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" }));
vi.mock("../src/ui/tour/anchors", () => ({ TourAnchor: "TourAnchor" }));
vi.mock("../src/ui/preferences", async () => {
	const { es } = await import("../src/ui/i18n/es");
	return {
		usePreferences: () => ({
			t: h.t ?? es,
			theme: {
				spacing: (n: number) => n * 4, touch: 48, radius: { small: 6, medium: 10, large: 16 }, font: { mono: "mono" },
				colors: { text: "text", textMuted: "muted", accent: "accentBg", onAccent: "onAccent", accentText: "accent", attention: "attention", surface: "surface", surfaceRaised: "raised", border: "border", danger: "danger" },
			},
		}),
	};
});

const { ApprovalCard, ApprovalList, APPROVAL_BODY_MAX_HEIGHT, APPROVAL_BODY_MIN_HEIGHT, APPROVAL_LIST_MAX_HEIGHT, approvalCardMinHeight } = await import("../src/ui/approvals");
const { AgentBadge, AGENT_GLYPHS } = await import("../src/ui/agent-badge");
const { AgentIcon } = await import("../src/ui/agent-icon");

type Node = { type: unknown; props: Record<string, any> };
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
/** Every node with the host types of its ancestors, so a test can tell what sits inside a scroll area. */
function withAncestors(node: unknown, path: unknown[] = []): { type: unknown; props: Record<string, any>; path: unknown[] }[] {
	if (Array.isArray(node)) return node.flatMap((child) => withAncestors(child, path));
	if (!isValidElement<Record<string, any>>(node)) return [];
	if (typeof node.type === "function") return withAncestors((node.type as (props: unknown) => unknown)(node.props), path);
	return [{ type: node.type, props: node.props, path }, ...withAncestors(node.props.children, [...path, node.type])];
}
const texts = (nodes: Node[]) => nodes.filter((n) => n.type === "Text").map((n) => textOf(n.props.children));
const buttons = (nodes: Node[]) => nodes.filter((n) => n.type === "Pressable");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const request = (extra: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
	id: "a1", kind: "command", title: "Run the test suite", detail: "pnpm test --filter mobile", choices: ["accept", "acceptForSession", "decline", "cancel"], ...extra,
});
function card(props: Parameters<typeof ApprovalCard>[0]) {
	h.i = 0;
	return elements(ApprovalCard(props));
}

beforeEach(() => { h.slots = []; h.t = undefined; });

describe("the approval card", () => {
	it("shows kind, title and a bounded, scrollable, monospace command", () => {
		const view = card({ approval: request(), canAnswer: true, answer: vi.fn() });
		expect(texts(view)).toEqual(expect.arrayContaining(["Espera tu aprobación · Comando", "Run the test suite", "pnpm test --filter mobile"]));
		const scroll = view.find((n) => n.type === "ScrollView")!;
		expect(scroll.props.style.maxHeight).toBe(APPROVAL_BODY_MAX_HEIGHT);
		const detail = view.find((n) => n.type === "Text" && textOf(n.props.children) === "pnpm test --filter mobile")!;
		expect(detail.props.style.fontFamily).toBe("mono");
		expect(detail.props.selectable).toBe(true);
	});

	it("does not use monospace for a permission, and leaves out an empty detail", () => {
		const permission = card({ approval: request({ kind: "permission", detail: "Read ~/notes" }), canAnswer: true, answer: vi.fn() });
		expect(permission.find((n) => n.type === "Text" && textOf(n.props.children) === "Read ~/notes")!.props.style.fontFamily).toBeUndefined();
		const empty = card({ approval: request({ detail: "" }), canAnswer: true, answer: vi.fn() });
		expect(empty.some((n) => n.props.accessibilityLabel === "Detalle")).toBe(false);
		expect(texts(empty)).not.toContain("");
	});

	it("has one touch-sized button per offered choice, in order, in Spanish and English", () => {
		const view = card({ approval: request(), canAnswer: true, answer: vi.fn() });
		expect(buttons(view).map((b) => b.props.accessibilityLabel)).toEqual(["Aprobar", "Aprobar para la sesión", "Rechazar", "Cancelar"]);
		expect(buttons(view).every((b) => b.props.style.minHeight === 48 && b.props.accessibilityRole === "button")).toBe(true);
		expect(buttons(card({ approval: request({ choices: ["decline", "accept"] }), canAnswer: true, answer: vi.fn() })).map((b) => b.props.accessibilityLabel)).toEqual(["Rechazar", "Aprobar"]);
		h.t = en; h.slots = [];
		expect(texts(card({ approval: request(), canAnswer: true, answer: vi.fn() }))).toEqual(expect.arrayContaining(["Approve", "Approve for session", "Decline", "Cancel", "Waiting for your approval · Command"]));
	});

	it("sends the pressed decision, shows it busy and locks the other buttons until the card leaves", async () => {
		let finish!: (value: { ok: true }) => void;
		const answer = vi.fn(() => new Promise<{ ok: true }>((resolve) => (finish = resolve)));
		buttons(card({ approval: request(), canAnswer: true, answer }))[1]!.props.onPress();
		expect(answer).toHaveBeenCalledWith("a1", "acceptForSession");
		let view = card({ approval: request(), canAnswer: true, answer });
		expect(texts(view)).toContain("Enviando…");
		expect(buttons(view).every((b) => b.props.disabled === true)).toBe(true);
		buttons(view)[0]!.props.onPress();
		expect(answer).toHaveBeenCalledTimes(1);
		finish({ ok: true });
		await flush();
		view = card({ approval: request(), canAnswer: true, answer });
		expect(buttons(view).every((b) => b.props.disabled === true)).toBe(true);
		expect(view.some((n) => n.props.accessibilityRole === "alert")).toBe(false);
	});

	it("shows an error line and unlocks the buttons when the answer fails", async () => {
		const answer = vi.fn(async () => ({ ok: false as const, message: "Connection reset" }));
		buttons(card({ approval: request(), canAnswer: true, answer }))[2]!.props.onPress();
		await flush();
		const view = card({ approval: request(), canAnswer: true, answer });
		const alert = view.find((n) => n.props.accessibilityRole === "alert")!;
		expect(textOf(alert.props.children)).toBe("La respuesta no llegó a la computadora. Probá de nuevo.");
		expect(buttons(view).every((b) => b.props.disabled === false)).toBe(true);
		expect(texts(view)).not.toContain("Enviando…");
	});

	it("points to the terminal instead of buttons when the session cannot answer approvals", () => {
		const view = card({ approval: request(), canAnswer: false, answer: vi.fn() });
		expect(buttons(view)).toEqual([]);
		expect(texts(view)).toContain("Contestala en la terminal de la sesión.");
	});

	it("says plainly when the detail was cut, and makes approving the less prominent choice", () => {
		const full = card({ approval: request(), canAnswer: true, answer: vi.fn() });
		expect(texts(full).some((text) => /demasiado largo/.test(text))).toBe(false);
		expect(buttons(full)[0]!.props.style.backgroundColor).toBe("accentBg");

		const view = card({ approval: request({ detailTruncated: true }), canAnswer: true, answer: vi.fn() });
		const notice = view.find((n) => n.type === "Text" && textOf(n.props.children) === "Este comando es demasiado largo para mostrarlo completo. Revisalo en la terminal antes de permitirlo.");
		expect(notice).toBeDefined();
		expect(notice!.props.accessibilityRole).toBe("alert");
		expect(notice!.props.style.color).toBe("attention");
		// The notice comes before the cut detail, so it is read first.
		expect(view.indexOf(notice!)).toBeLessThan(view.findIndex((n) => n.type === "Text" && textOf(n.props.children) === "pnpm test --filter mobile"));
		expect(texts(view)).toContain("pnpm test --filter mobile");
		const [approve, forSession, decline] = buttons(view);
		expect(buttons(view).map((b) => b.props.accessibilityLabel)).toEqual(["Aprobar", "Aprobar para la sesión", "Rechazar", "Cancelar"]);
		for (const button of [approve!, forSession!]) {
			expect(button.props.style).toMatchObject({ backgroundColor: "transparent", borderWidth: 1, borderColor: "border" });
			expect(button.props.disabled).toBe(false);
		}
		expect(textOf(approve!.props.children)).toBe("Aprobar");
		expect(elements(approve!.props.children)[0]!.props.style.color).toBe("text");
		expect(decline!.props.style.borderColor).toBe("danger");

		h.t = en; h.slots = [];
		expect(texts(card({ approval: request({ detailTruncated: true }), canAnswer: true, answer: vi.fn() }))).toContain("This command is too long to show in full. Review it in the terminal before allowing it.");
		h.t = undefined; h.slots = [];
		// Without buttons, the notice still shows next to «answer in the terminal».
		expect(texts(card({ approval: request({ detailTruncated: true }), canAnswer: false, answer: vi.fn() }))).toEqual(expect.arrayContaining(["Este comando es demasiado largo para mostrarlo completo. Revisalo en la terminal antes de permitirlo.", "Contestala en la terminal de la sesión."]));
	});

	it("keeps the buttons as a fixed footer, outside the scrolling detail, however long the command (build 15 L5)", () => {
		const long = "pnpm exec vitest run " + "apps/mobile/test/a-very-long-path.test.ts ".repeat(40);
		for (const approval of [request({ detail: long }), request({ detail: long, detailTruncated: true }), request({ kind: "permission", title: "x ".repeat(200), detail: long })]) {
			h.i = 0;
			const view = withAncestors(ApprovalCard({ approval, canAnswer: true, answer: vi.fn() }));
			const pressables = view.filter((n) => n.type === "Pressable");
			expect(pressables).toHaveLength(4);
			expect(pressables.every((b) => !b.path.includes("ScrollView"))).toBe(true);
			// The card may shrink to the room it gets; only its body (title, notice, detail) gives way, never the footer.
			const root = view[0]!;
			expect(root.props.style.flexShrink).toBe(1);
			const body = view.find((n) => n.type === "ScrollView")!;
			expect(body.props.style).toMatchObject({ flexShrink: 1, maxHeight: APPROVAL_BODY_MAX_HEIGHT });
			const rows = view.filter((n) => n.type === "View" && n.props.style?.flexDirection === "row");
			expect(rows.length).toBeGreaterThan(0);
			expect(rows.every((row) => row.props.style.flexShrink === 0)).toBe(true);
			expect(texts(view.filter((n) => n.path.includes("ScrollView")))).toEqual(expect.arrayContaining([approval.title, long]));
		}
	});

	it("never lets the buttons shrink below a touch height: rows of at most two, each row and the footer with a fixed minimum (phone check 2)", () => {
		for (const choices of [["accept", "acceptForSession", "decline", "cancel"], ["accept", "decline"], ["decline"], ["accept", "acceptForSession", "decline"]] as ApprovalRequest["choices"][]) {
			h.i = 0; h.slots = [];
			const view = withAncestors(ApprovalCard({ approval: request({ choices }), canAnswer: true, answer: vi.fn() }));
			const pressables = view.filter((n) => n.type === "Pressable");
			expect(pressables.map((b) => b.props.accessibilityLabel)).toHaveLength(choices.length);
			for (const button of pressables) expect(button.props.style).toMatchObject({ minHeight: 48, flexShrink: 0 });
			const rows = view.filter((n) => n.type === "View" && n.props.style?.flexDirection === "row");
			expect(rows).toHaveLength(Math.ceil(choices.length / 2));
			for (const row of rows) {
				expect(row.props.style).toMatchObject({ flexShrink: 0, minHeight: 48 });
				expect(elements(row.props.children).filter((n) => n.type === "Pressable").length).toBeLessThanOrEqual(2);
			}
			// The footer holds the rows and keeps their whole height, whatever room the card gets.
			const footer = view.find((n) => n.props.accessibilityRole === "toolbar")!;
			expect(footer.props.style).toMatchObject({ flexShrink: 0, minHeight: rows.length * 48 + (rows.length - 1) * 8 });
		}
	});

	it("lets the body give way first, down to one visible title line, and holds the card at that minimum (phone check 1, 2)", () => {
		h.i = 0;
		const view = card({ approval: request(), canAnswer: true, answer: vi.fn() });
		const body = view.find((n) => n.type === "ScrollView")!;
		expect(body.props.style).toMatchObject({ flexShrink: 1, minHeight: APPROVAL_BODY_MIN_HEIGHT, maxHeight: APPROVAL_BODY_MAX_HEIGHT });
		const title = view.find((n) => n.type === "Text" && textOf(n.props.children) === "Run the test suite")!;
		expect(title.props.style.lineHeight).toBe(APPROVAL_BODY_MIN_HEIGHT);
		const header = view.find((n) => n.props.accessibilityRole === "header")!;
		expect(header.props.style).toMatchObject({ flexShrink: 0, lineHeight: 18 });
		// padding 12×2 + border 1×2 + header 18 + gap 8 + one title line + gap 8 + two button rows (48 + 8 + 48).
		const theme = { spacing: (n: number) => n * 4, touch: 48 };
		expect(approvalCardMinHeight(request(), true, theme)).toBe(24 + 2 + 18 + 8 + APPROVAL_BODY_MIN_HEIGHT + 8 + 104);
		expect(view[0]!.props.style).toMatchObject({ flexShrink: 1, minHeight: approvalCardMinHeight(request(), true, theme) });
		// Without a body there is nothing to give way; without buttons the terminal hint holds one line.
		expect(approvalCardMinHeight(request({ title: undefined, detail: "" }), true, theme)).toBe(24 + 2 + 18 + 8 + 104);
		expect(approvalCardMinHeight(request({ choices: ["decline"] }), true, theme)).toBe(24 + 2 + 18 + 8 + APPROVAL_BODY_MIN_HEIGHT + 8 + 48);
		expect(approvalCardMinHeight(request(), false, theme)).toBe(24 + 2 + 18 + 8 + APPROVAL_BODY_MIN_HEIGHT + 8 + 18);
		h.i = 0; h.slots = [];
		const hint = card({ approval: request(), canAnswer: false, answer: vi.fn() }).find((n) => n.type === "Text" && textOf(n.props.children) === "Contestala en la terminal de la sesión.")!;
		expect(hint.props.style).toMatchObject({ flexShrink: 0, lineHeight: 18 });
	});

	it("keeps the approval area at least as tall as the card's minimum, so the screen gives way instead of the card", () => {
		const theme = { spacing: (n: number) => n * 4, touch: 48 };
		const min = approvalCardMinHeight(request(), true, theme);
		h.i = 0;
		const one = withAncestors(ApprovalList({ approvals: [request()], canAnswer: true, answer: vi.fn() }));
		expect(one[0]!.props.style).toMatchObject({ flexShrink: 1, minHeight: min + 24 });
		expect(one.find((n) => n.type === "TourAnchor")!.props.style).toMatchObject({ flexShrink: 1, minHeight: min });
		h.i = 0; h.slots = [];
		const two = withAncestors(ApprovalList({ approvals: [request(), request({ id: "a2" })], canAnswer: true, answer: vi.fn() }));
		expect(two[0]!.props.style).toMatchObject({ flexShrink: 1, minHeight: min + 24 + 18 });
		expect(two.find((n) => n.type === "Text" && /más/.test(textOf(n.props.children)))!.props.style).toMatchObject({ flexShrink: 0, lineHeight: 18 });
		h.i = 0; h.slots = [];
		const withoutButtons = withAncestors(ApprovalList({ approvals: [request()], canAnswer: false, answer: vi.fn() }));
		expect(withoutButtons[0]!.props.style.minHeight).toBe(approvalCardMinHeight(request(), false, theme) + 24);
		expect(withoutButtons[0]!.props.style.maxHeight).toBeGreaterThanOrEqual(withoutButtons[0]!.props.style.minHeight);
	});

	it("lists nothing without approvals, and shows the oldest card with its buttons outside any scroll, the others counted", () => {
		expect(ApprovalList({ approvals: [], canAnswer: true, answer: vi.fn() })).toBeNull();
		h.i = 0;
		const one = withAncestors(ApprovalList({ approvals: [request()], canAnswer: true, answer: vi.fn(), anchor: true }));
		const wrapper = one[0]!;
		expect(wrapper.type).toBe("View");
		expect(wrapper.props.style).toMatchObject({ flexShrink: 1, maxHeight: APPROVAL_LIST_MAX_HEIGHT });
		const anchor = one.find((n) => n.type === "TourAnchor")!;
		expect(anchor.props).toMatchObject({ id: "approvals.first", enabled: true });
		expect(anchor.props.style).toMatchObject({ flexShrink: 1, marginHorizontal: 12, marginVertical: 12 });
		expect(one.filter((n) => n.type === "Pressable").every((b) => !b.path.includes("ScrollView"))).toBe(true);
		expect(one.filter((n) => n.type === "Pressable").map((b) => b.props.accessibilityLabel)).toEqual(["Aprobar", "Aprobar para la sesión", "Rechazar", "Cancelar"]);
		expect(texts(one).some((text) => /más/.test(text))).toBe(false);

		h.i = 0; h.slots = [];
		const three = withAncestors(ApprovalList({ approvals: [request(), request({ id: "a2", title: "Second" }), request({ id: "a3", title: "Third" })], canAnswer: true, answer: vi.fn(), anchor: false }));
		expect(three.filter((n) => n.type === "TourAnchor").map((n) => n.props.enabled)).toEqual([false]);
		expect(texts(three)).toContain("Run the test suite");
		expect(texts(three)).not.toContain("Second");
		expect(texts(three)).toContain("2 aprobaciones más esperan después de esta.");
		h.i = 0; h.slots = []; h.t = en;
		expect(texts(withAncestors(ApprovalList({ approvals: [request(), request({ id: "a2" })], canAnswer: true, answer: vi.fn() })))).toContain("1 more approval waits after this one.");
	});
});

describe("agent badges", () => {
	it("adds nothing for Pi or a session without an agent, so Pi looks as before (S5)", () => {
		expect(AgentBadge({ agent: "pi" })).toBeNull();
		expect(AgentBadge({})).toBeNull();
	});

	it("labels Claude Code and Codex with their own original glyphs", () => {
		const claude = elements(AgentBadge({ agent: "claude-code" }));
		expect(texts(claude)).toEqual([AGENT_GLYPHS["claude-code"], "Claude Code"]);
		expect(claude[0]!.props.accessibilityLabel).toBe("Agente: Claude Code");
		expect(texts(elements(AgentBadge({ agent: "codex" })))).toEqual([AGENT_GLYPHS.codex, "Codex"]);
		expect(texts(elements(AgentBadge({ agent: "unknown" })))[1]).toBe("Otro agente");
		expect(new Set(Object.values(AGENT_GLYPHS)).size).toBe(3);
	});

	it("draws the glyphs as shortcut icons, never an image", () => {
		for (const program of ["claude-code", "codex"] as const) {
			const icon = elements(AgentIcon({ program }));
			expect(icon.some((n) => n.type === "Image")).toBe(false);
			expect(texts(icon)).toEqual([AGENT_GLYPHS[program]]);
		}
	});
});
