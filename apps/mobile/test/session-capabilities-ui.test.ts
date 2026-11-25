import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, type StateResponse } from "@workspace/protocol";
import { fromSnapshot } from "../src/core/conversation";
import { AGENT_ASKING_MESSAGE, type LiveView } from "../src/core/live-session";
import { APPROVAL_LIST_MAX_HEIGHT } from "../src/ui/approvals";
import { readFileSync } from "node:fs";

// claude-codex-support T3b: the chat screen shows only the controls the session's agent supports (S5, S6, S7).
const h = vi.hoisted(() => ({
	slots: [] as unknown[],
	i: 0,
	focused: false,
	terminal: true,
	params: {} as Record<string, string>,
	live: null as unknown,
	answer: (() => Promise.resolve({ ok: true })) as (id: string, decision: string) => Promise<unknown>,
	draft: "hello",
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (init: unknown) => {
		const i = h.i++;
		if (!(i in h.slots)) h.slots[i] = typeof init === "function" ? (init as () => unknown)() : init;
		return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === "function" ? (next as (prev: unknown) => unknown)(h.slots[i]) : next; }];
	},
	useRef: (init: unknown) => { const i = h.i++; if (!(i in h.slots)) h.slots[i] = { current: init }; return h.slots[i]; },
	useCallback: (fn: unknown) => fn,
	useMemo: (fn: () => unknown) => fn(),
}));
vi.mock("expo-router", () => ({
	useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
	useLocalSearchParams: () => h.params,
	// Runs once, like a first focus.
	useFocusEffect: (effect: () => void) => { if (!h.focused) { h.focused = true; effect(); } },
}));
vi.mock("react-native", () => ({
	ActivityIndicator: "ActivityIndicator", FlatList: "FlatList", Image: "Image", KeyboardAvoidingView: "KeyboardAvoidingView",
	PanResponder: { create: () => ({ panHandlers: {} }) }, Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View",
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
vi.mock("../src/core/dictation", () => ({ appendDictation: (a: string, b: string) => a + b }));
vi.mock("../src/ui/dictation", () => ({ DictationMic: "DictationMic", DictationModelSheet: "DictationModelSheet", DictationStatus: "DictationStatus", dictationVisible: () => false, useDictation: () => ({ needsModel: false, closeModel: () => {} }) }));
vi.mock("../src/ui/message-attachments", () => ({ UserMessage: "UserMessage" }));
vi.mock("../src/ui/attachment-composer", () => ({ AttachmentButton: "AttachmentButton", AttachmentCards: "AttachmentCards" }));
vi.mock("../src/ui/attachment-messages", () => ({ attachmentError: (m: string) => m, withheldNotice: () => null }));
vi.mock("../src/ui/use-composer-draft", () => ({ useComposerDraft: () => ({ text: h.draft, setText: () => {}, attachments: [], sending: false, sourceBusy: false, sourceError: null, remove: () => {}, select: () => {} }) }));
vi.mock("../src/core/composer-drafts", () => ({ composerDrafts: {} }));
// Sends the current draft through the screen's callback, like the shared draft store.
vi.mock("../src/core/send-composer-draft", () => ({ sendComposerDraft: (_store: unknown, _key: string, send: (draft: { text: string; attachments: [] }) => Promise<unknown>) => send({ text: h.draft, attachments: [] }) }));
vi.mock("../src/ui/components", () => ({ StatusPill: "StatusPill" }));
vi.mock("../src/services", () => ({ sessions: { terminalAvailable: async () => h.terminal } }));
vi.mock("../src/ui/use-live-session", () => ({ useLiveSession: () => h.live }));
vi.mock("../src/app/session/open/[id]", () => ({ default: "OpenSession" }));
vi.mock("../src/ui/chat-handle", () => ({ ChatHandle: "ChatHandle" }));
vi.mock("../src/ui/tour/anchors", () => ({ useTourAnchor: () => ({}), TourAnchor: "TourAnchor" }));
vi.mock("../src/ui/tour/tips", () => ({ useFirstVisitTip: () => {} }));
vi.mock("../src/ui/preferences", async () => {
	const { es } = await import("../src/ui/i18n/es");
	return {
		usePreferences: () => ({
			t: es,
			theme: {
				spacing: (n: number) => n * 4, touch: 48, radius: { small: 6, medium: 10, large: 16 }, font: { mono: "mono" },
				colors: { text: "text", textMuted: "muted", accent: "accentBg", onAccent: "onAccent", accentText: "accent", attention: "attention", surface: "surface", surfaceRaised: "raised", border: "border", danger: "danger", background: "bg", working: "working" },
			},
		}),
	};
});

const { default: SessionScreen } = await import("../src/app/session/[id]");
const { FloatingSessionChat } = await import("../src/ui/floating-session-chat");

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
const texts = (nodes: Node[]) => nodes.filter((n) => n.type === "Text").map((n) => textOf(n.props.children));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const state = (extra: Record<string, unknown> = {}): StateResponse => ({
	protocolVersion: PROTOCOL_VERSION, bridgeInstanceId: "b", sessionId: "s", idle: false, pendingMessages: false, pendingPrompt: null,
	model: null, lastSeq: 10, oldestSeq: 1, lastActivityAt: 1000, ...extra,
}) as StateResponse;
function follow(snapshot: StateResponse | null) {
	const view: LiveView = { phase: snapshot ? "live" : "connecting", conversation: snapshot ? fromSnapshot(snapshot, []) : null, missedEvents: false, stopSlow: false };
	h.live = { view, send: vi.fn(), stop: vi.fn(), answer: (id: string, decision: string) => h.answer(id, decision) };
}
async function render(): Promise<Node[]> {
	h.i = 0;
	elements(SessionScreen());
	await flush();
	h.i = 0;
	return elements(SessionScreen());
}
const labelled = (view: Node[], label: string) => view.filter((n) => n.props.accessibilityLabel === label);
const has = (view: Node[], type: string) => view.some((n) => n.type === type);

const claude = { agent: "claude-code", capabilities: { message: true, steer: false, abort: true, attachments: false, terminal: true, approvals: true } };
const ask = { id: "a1", kind: "command", title: "Run tests", detail: "pnpm test", choices: ["accept", "acceptForSession", "decline", "cancel"] };

beforeEach(() => {
	h.slots = []; h.focused = false; h.terminal = true; h.params = { id: "box/b", chat: "1", project: "web", cwd: "/work/web", computer: "box" };
	h.answer = () => Promise.resolve({ ok: true }); h.draft = "hello";
});

describe("the chat screen per agent", () => {
	it("keeps every control for a legacy Pi session, with no badge or approvals (S5)", async () => {
		follow(state());
		const view = await render();
		expect(has(view, "TextInput") && has(view, "AttachmentButton")).toBe(true);
		expect(labelled(view, "Detener")).toHaveLength(1);
		expect(labelled(view, "Terminal")).toHaveLength(1);
		expect(labelled(view, "Enviar")[0]!.props.disabled).toBe(false);
		expect(view.find((n) => n.type === "TextInput")!.props.placeholder).toBe("Escribile a Pi…");
		expect(texts(view).some((t) => t.includes("Claude") || t.includes("aprobación"))).toBe(false);
	});

	it("follows Claude Code: no attachments, no steering while it works, a badge, and approvals with buttons", async () => {
		follow(state({ ...claude, approvals: [ask] }));
		const view = await render();
		expect(has(view, "TextInput")).toBe(true);
		expect(has(view, "AttachmentButton")).toBe(false);
		expect(view.find((n) => n.type === "TextInput")!.props.placeholder).toBe("Escribile a Claude Code…");
		// Running without steer: send waits for the agent instead of being refused.
		expect(labelled(view, "Enviar")[0]!.props.disabled).toBe(true);
		expect(labelled(view, "Detener")).toHaveLength(1);
		expect(labelled(view, "Agente: Claude Code")).toHaveLength(1);
		expect(["Aprobar", "Aprobar para la sesión", "Rechazar", "Cancelar"].every((label) => labelled(view, label).length === 1)).toBe(true);
	});

	it("posts the pressed approval through the live session", async () => {
		follow(state({ ...claude, approvals: [ask] }));
		const answered: string[] = [];
		h.answer = async (id, decision) => { answered.push(`${id}:${decision}`); return { ok: true }; };
		labelled(await render(), "Rechazar")[0]!.props.onPress();
		expect(answered).toEqual(["a1:decline"]);
	});

	it("hides composer, stop and terminal for an agent that declares none of them, and says so", async () => {
		follow(state({ agent: "codex", capabilities: { approvals: true }, approvals: [ask] }));
		const view = await render();
		expect(has(view, "TextInput") || has(view, "AttachmentButton")).toBe(false);
		expect(labelled(view, "Enviar")).toEqual([]);
		expect(labelled(view, "Detener")).toEqual([]);
		expect(labelled(view, "Terminal")).toEqual([]);
		expect(texts(view)).toContain("Esta sesión no recibe mensajes desde el teléfono.");
		expect(labelled(view, "Agente: Codex")).toHaveLength(1);
		expect(labelled(view, "Aprobar")).toHaveLength(1);
	});

	it("points to Terminal when the session takes no chat messages but has a terminal", async () => {
		follow(state({ agent: "codex", capabilities: { terminal: true } }));
		const view = await render();
		expect(labelled(view, "Terminal")).toHaveLength(1);
		expect(texts(view)).toContain("Esta sesión no recibe mensajes desde el chat. Abrí Terminal para escribirle.");
	});

	it("shows approvals without buttons when the bridge cannot answer them", async () => {
		follow(state({ agent: "codex", capabilities: { message: true }, approvals: [ask] }));
		const view = await render();
		expect(labelled(view, "Aprobar")).toEqual([]);
		expect(texts(view)).toContain("Contestala en la terminal de la sesión.");
	});

	it("does not flash Pi controls for a Codex session before its snapshot arrives", async () => {
		h.params = { ...h.params, agent: "codex" };
		follow(null);
		const view = await render();
		expect(has(view, "TextInput")).toBe(false);
		expect(labelled(view, "Agente: Codex")).toHaveLength(1);
		h.params = { ...h.params, agent: "" }; h.slots = []; h.focused = false;
		expect(has(await render(), "TextInput")).toBe(true);
	});
});

// L11 follow-up: a bridge that answers approvals also raises pendingPrompt for old apps; 1.9 shows one UI.
describe("the pending prompt next to approvals", () => {
	const waiting = (agent: string) => `${agent} te está esperando una respuesta o aprobación.`;
	const banners = (view: Node[]) => texts(view).filter((t) => t.includes(" te está esperando una respuesta o aprobación."));

	it("shows only the approval card when an approvals-capable session also sets pendingPrompt", async () => {
		follow(state({ ...claude, approvals: [ask], pendingPrompt: { kind: "confirm", title: "Run tests" } }));
		const view = await render();
		expect(banners(view)).toEqual([]);
		expect(labelled(view, "Aprobar")).toHaveLength(1);
		expect(view.filter((n) => n.type === "StatusPill").map((n) => n.props.status)).toEqual(["attention"]);
	});

	it("keeps the banner for a Pi session with a pending prompt (S5)", async () => {
		follow(state({ pendingPrompt: { kind: "confirm", title: "Delete?" } }));
		expect(banners(await render())).toEqual([`${waiting("Pi")} Delete?`]);
	});

	it("keeps the banner when an approvals-capable session has a prompt but no approvals", async () => {
		follow(state({ ...claude, pendingPrompt: { kind: "input" } }));
		const view = await render();
		expect(banners(view)).toEqual([waiting("Claude Code")]);
		expect(labelled(view, "Aprobar")).toEqual([]);
	});

	it("keeps the banner next to approvals from a bridge that cannot answer them", async () => {
		follow(state({ agent: "codex", capabilities: { message: true }, approvals: [ask], pendingPrompt: { kind: "confirm" } }));
		expect(banners(await render())).toEqual([waiting("Codex")]);
	});
});

describe("the terminal's floating chat per agent", () => {
	const floating = () => { h.i = 0; return elements(FloatingSessionChat({ sessionKey: "box/b", live: h.live as never, close: () => {}, expand: () => {} })); };

	it("keeps the Pi composer with attachments (S5)", () => {
		follow(state());
		const view = floating();
		expect(has(view, "TextInput") && has(view, "AttachmentButton")).toBe(true);
	});

	it("drops attachments for Claude Code and the whole composer for an agent without messages", () => {
		follow(state(claude));
		let view = floating();
		expect(has(view, "TextInput")).toBe(true);
		expect(has(view, "AttachmentButton")).toBe(false);
		expect(view.find((n) => n.type === "TextInput")!.props.placeholder).toBe("Escribile a Claude Code…");
		follow(state({ agent: "codex" }));
		h.slots = [];
		view = floating();
		expect(has(view, "TextInput") || labelled(view, "Enviar").length > 0).toBe(false);
		expect(texts(view)).toContain("Esta sesión no recibe mensajes del chat. Escribile en la terminal.");
	});
});

// claude-codex-support L18: the closed-session banner and the slow-stop notice name the session's agent, not always Pi.
describe("session texts name the session's agent", () => {
	const codex = { agent: "codex", capabilities: { message: true, steer: false, abort: true, attachments: false, terminal: true, approvals: true } };
	function view(phase: LiveView["phase"], snapshot: StateResponse | null, stopSlow = false) {
		h.live = { view: { phase, conversation: snapshot ? fromSnapshot(snapshot, []) : null, missedEvents: false, stopSlow }, send: vi.fn(), stop: vi.fn(), answer: vi.fn() };
	}
	// A fresh component: its hooks never share the chat screen's slots rendered just before.
	const floatingPi = () => { h.i = 0; h.slots = []; return elements(FloatingSessionChat({ sessionKey: "box/b", live: h.live as never, close: () => {}, expand: () => {}, agent: "pi" })); };
	const floating = (agent?: "claude-code" | "codex") => { h.i = 0; h.slots = []; return elements(FloatingSessionChat({ sessionKey: "box/b", live: h.live as never, close: () => {}, expand: () => {}, ...(agent ? { agent } : {}) })); };

	it.each([
		[claude, "Claude Code"],
		[codex, "Codex"],
		[{}, "Pi"],
	])("%#: the closed banner and slow stop say %s", async (agent, name) => {
		view("ended", state(agent), true);
		const shown = texts(await render());
		expect(shown).toContain(`Esta sesión de ${name} ya no está abierta en la computadora.`);
		expect(shown).toContain(`${name} no se detiene. Probá desde la computadora.`);
		expect(texts(floating())).toContain(`Esta sesión de ${name} ya no está abierta en la computadora.`);
	});

	it("uses the Home card's agent before any snapshot, and a neutral text for an unknown agent", async () => {
		view("ended", null, true);
		h.params = { ...h.params, agent: "claude-code" };
		const shown = texts(await render());
		expect(shown).toContain("Esta sesión de Claude Code ya no está abierta en la computadora.");
		expect(shown.some((t) => t.includes("Pi"))).toBe(false);
		expect(texts(floating("codex"))).toContain("Esta sesión de Codex ya no está abierta en la computadora.");

		h.slots = []; h.focused = false;
		h.params = { ...h.params, agent: "unknown" };
		const unknown = texts(await render());
		expect(unknown).toContain("Esta sesión ya no está abierta en la computadora.");
		expect(unknown).toContain("La sesión no se detiene. Probá desde la computadora.");
	});

	// claude-codex L19 leftovers: waiting, returned and the placeholder fallback said Pi for every agent.
	it.each([
		[claude, "Claude Code"],
		[codex, "Codex"],
		[{}, "Pi"],
	])("%#: the waiting banner and a returned message name %s", async (agent, name) => {
		view("live", state({ ...agent, pendingPrompt: { kind: "input" } }));
		expect(texts(await render())).toContain(`${name} te está esperando una respuesta o aprobación.`);
		const live = h.live as { view: LiveView };
		live.view = { ...live.view, conversation: { ...live.view.conversation!, outgoing: [{ key: "o1", text: "hola", state: "returned" }] } };
		expect(texts(floating())).toContain(`${name} lo devolvió a su editor en la computadora. · hola`);
	});

	it("the placeholder before a snapshot names the Home card's agent, or no agent at all", async () => {
		view("connecting", null);
		const placeholder = (nodes: Node[]) => nodes.find((n) => n.type === "TextInput")?.props.placeholder;
		expect(placeholder(floating("claude-code"))).toBe("Escribile a Claude Code…");
		expect(placeholder(floatingPi())).toBe("Escribile a Pi…");
		expect(placeholder(floating())).toBe("Escribí un mensaje…");
		h.params = { ...h.params, agent: "" };
		expect(placeholder(await render())).toBe("Escribí un mensaje…");
	});

	it("the floating chat shows which session it writes to", () => {
		view("live", state(claude));
		h.i = 0;
		const shown = texts(elements(FloatingSessionChat({ sessionKey: "box/b", live: h.live as never, close: () => {}, expand: () => {}, agent: "claude-code", project: "mars-ram" })));
		expect(shown).toContain("Claude Code · mars-ram");
	});
});

describe("the empty Home names every supported agent", () => {
	it("in es and en", async () => {
		const { es } = await import("../src/ui/i18n/es");
		const { en } = await import("../src/ui/i18n/en");
		for (const hint of [es.home.emptyHint, en.home.emptyHint]) for (const agent of ["Pi", "Claude Code", "Codex"]) expect(hint).toContain(agent);
	});
});

// Build 15 phone check of the approval card (Samsung S24, «Abrir chat completo»).
describe("the approval card next to the message list and the composer", () => {
	const asking = { ...claude, idle: true, approvals: [ask] };
	/** The node whose style makes it the shrinking message area: it holds the list (or the empty text). */
	const listArea = (view: Node[]) => view.find((n) => n.type === "View" && n.props.style?.flex === 1 && n.props.style?.overflow === "hidden")!;
	const approvalArea = (view: Node[]) => view.find((n) => n.type === "View" && n.props.style?.maxHeight === APPROVAL_LIST_MAX_HEIGHT)!;

	for (const items of ["no messages", "messages"] as const) it(`keeps the approval area outside the shrinking message list, above the composer (${items})`, async () => {
		follow(state(asking));
		if (items === "messages") { const live = h.live as { view: LiveView }; live.view = { ...live.view, conversation: { ...live.view.conversation!, items: [{ kind: "assistant", key: "m1", text: "hola", streaming: false }] } }; }
		const view = await render();
		const list = listArea(view);
		expect(list.props.style).toMatchObject({ flex: 1, minHeight: 0, overflow: "hidden" });
		expect(has(elements(list.props.children), "FlatList")).toBe(items === "messages");
		if (items === "messages") expect(elements(list.props.children).find((n) => n.type === "FlatList")!.props.style).toMatchObject({ flex: 1 });
		// The card is not inside the list area, and comes after it (drawn over it, never under a bubble) and before the composer.
		expect(elements(list.props.children).some((n) => n.type === "Pressable")).toBe(false);
		const approvals = approvalArea(view);
		expect(view.indexOf(approvals)).toBeGreaterThan(view.indexOf(list));
		expect(view.indexOf(approvals)).toBeLessThan(view.findIndex((n) => n.type === "TextInput"));
		expect(approvals.props.style.minHeight).toBeGreaterThan(0);
		expect(labelled(elements(approvals.props.children), "Rechazar")).toHaveLength(1);
	});

	async function refuse(message = AGENT_ASKING_MESSAGE) {
		follow(state(asking));
		(h.live as { send: unknown }).send = vi.fn(async () => ({ ok: false, message }));
		await labelled(await render(), "Enviar")[0]!.props.onPress();
		await flush();
	}
	const rerender = () => { h.i = 0; return elements(SessionScreen()); };
	const showing = (view: Node[], text: string) => texts(view).includes(text);
	const answered = (approvals: unknown[]) => { (h.live as { view: LiveView }).view = { ...(h.live as { view: LiveView }).view, conversation: fromSnapshot(state({ ...asking, approvals }), []) }; };

	it("drops the agent-asking error once the approval is answered or replaced (phone check 3)", async () => {
		await refuse();
		expect(showing(rerender(), AGENT_ASKING_MESSAGE)).toBe(true);
		answered([]);
		expect(showing(rerender(), AGENT_ASKING_MESSAGE)).toBe(false);
		await refuse();
		answered([{ ...ask, id: "a2" }]);
		expect(showing(rerender(), AGENT_ASKING_MESSAGE)).toBe(false);
	});

	it("drops the agent-asking error when the draft is edited", async () => {
		await refuse();
		h.draft = "hello again";
		expect(showing(rerender(), AGENT_ASKING_MESSAGE)).toBe(false);
	});

	it("keeps any other send error through answered approvals and draft edits", async () => {
		await refuse("Connection reset");
		answered([]);
		h.draft = "hello again";
		expect(showing(rerender(), "Connection reset")).toBe(true);
	});

	it("does the same in the terminal's floating chat", async () => {
		const floating = () => { h.i = 0; return elements(FloatingSessionChat({ sessionKey: "box/b", live: h.live as never, close: () => {}, expand: () => {} })); };
		for (const [message, edit, stays] of [[AGENT_ASKING_MESSAGE, "answer", false], [AGENT_ASKING_MESSAGE, "draft", false], ["Connection reset", "answer", true], ["Connection reset", "draft", true]] as const) {
			h.slots = []; h.draft = "hello";
			follow(state(asking));
			(h.live as { send: unknown }).send = vi.fn(async () => ({ ok: false, message }));
			labelled(floating(), "Enviar")[0]!.props.onPress();
			await flush();
			const alert = (view: Node[]) => view.filter((n) => n.props.accessibilityRole === "alert").map((n) => textOf(n.props.children));
			expect(alert(floating())).toEqual([message]);
			if (edit === "answer") answered([]); else h.draft = "hello again";
			expect(alert(floating())).toEqual(stays ? [message] : []);
		}
	});

	it("keeps the terminal's approval area between the shrinking terminal and the floating chat", () => {
		const screen = readFileSync(new URL("../src/app/session/terminal/[id].tsx", import.meta.url), "utf8");
		const terminal = screen.indexOf(`<View style={{ flex: 1, backgroundColor: c.terminalBackground, overflow: "hidden" }}`);
		expect(terminal).toBeGreaterThan(-1);
		expect(screen.indexOf("<ApprovalList anchor={screenFocused}")).toBeGreaterThan(terminal);
		expect(screen.indexOf("<FloatingSessionChat")).toBeGreaterThan(screen.indexOf("<ApprovalList anchor={screenFocused}"));
	});
});
