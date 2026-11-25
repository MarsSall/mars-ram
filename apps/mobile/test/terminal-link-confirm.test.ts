// release-0.1.8 S5: a link that opens a terminal asks first; only «Abrir» reaches the computer.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { answerLinkTerminal, leaveToInicio, linkConfirmationPath, readLinkTerminalParams } from "../src/core/notification-routing";
import { redirectSystemPath } from "../src/app/+native-intent";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";
import { LinkTerminalView } from "../src/ui/link-terminal";
import { TERMINAL_ROUTE } from "../src/core/terminal-openers";
import { allowedSystemPath } from "../src/core/link-policy";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ports = vi.hoisted(() => ({ hosts: vi.fn(), list: vi.fn(), openTarget: vi.fn() }));
vi.mock("../src/services", () => ({ catalog: { list: ports.hosts }, sessions: { list: ports.list, openTarget: ports.openTarget } }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator" }));
vi.mock("../src/ui/components", () => ({ PrimaryButton: "PrimaryButton", Screen: "Screen" }));
vi.mock("../src/ui/preferences", () => ({ usePreferences: vi.fn() }));

const link = "mars-ram-preview://notice?h=00700063&b=0073&encoding=utf16-hex";
const target = { hostId: "pc", bridgeInstanceId: "s" };
const live = [{ hostId: "pc", bridgeInstanceId: "s", key: "pc/s" }];
beforeEach(() => {
	vi.clearAllMocks();
	ports.hosts.mockResolvedValue([{ id: "pc", name: "devbox" }]);
	ports.list.mockResolvedValue({ computers: [{ sessions: live }] });
});

describe("a terminal link stops at a confirmation", () => {
	it.each([true, false])("cold/warm link (initial=%s) goes to the confirmation without connecting", async initial => {
		expect(await redirectSystemPath({ path: link, initial })).toBe("/link-terminal?h=00700063&b=0073");
		// Only the local saved-computer list is read: no discovery (SSH), no terminal check, no focus.
		expect(ports.hosts).toHaveBeenCalledOnce();
		expect(ports.list).not.toHaveBeenCalled();
		expect(ports.openTarget).not.toHaveBeenCalled();
	});

	it("an unknown computer or a malformed link goes to Inicio without a prompt", async () => {
		ports.hosts.mockResolvedValueOnce([]);
		expect(await redirectSystemPath({ path: link, initial: true })).toBe("/");
		expect(await redirectSystemPath({ path: `${link}&x=1`, initial: true })).toBe("/");
		ports.hosts.mockRejectedValueOnce(new Error("disk"));
		expect(await linkConfirmationPath(link, ports.hosts)).toBe("/");
		expect(ports.list).not.toHaveBeenCalled();
	});

	it("reads only the exact hex params the confirmation route was given", () => {
		expect(readLinkTerminalParams("00700063", "0073")).toEqual(target);
		for (const [h, b] of [["0070", ["0073"]], [undefined, "0073"], ["0070&b=0073", "0073"], ["%30", "0073"], ["007", "0073"], ["", "0073"]] as const)
			expect(readLinkTerminalParams(h as never, b as never)).toBeNull();
	});
});

describe("answering the confirmation", () => {
	function effects() { return { live: vi.fn(async () => live), open: vi.fn(), home: vi.fn() }; }

	it("«Abrir» connects, then opens the terminal-first route for the session", async () => {
		const e = effects();
		expect(await answerLinkTerminal("open", target, e)).toBe("opened");
		expect(e.live).toHaveBeenCalledOnce(); expect(e.open).toHaveBeenCalledWith("pc/s"); expect(e.home).not.toHaveBeenCalled();
	});

	it("«Cancelar» touches nothing on the computer and goes home", async () => {
		const e = effects();
		expect(await answerLinkTerminal("cancel", target, e)).toBe("cancelled");
		expect(e.live).not.toHaveBeenCalled(); expect(e.open).not.toHaveBeenCalled(); expect(e.home).toHaveBeenCalledOnce();
	});

	// L14: going back would refocus a plain shell underneath, whose blur closed its channel: a fresh PTY.
	it.each([true, false])("«Cancelar» always lands on Inicio, never back to the previous screen (canGoBack=%s)", async canGoBack => {
		const router = { back: vi.fn(), canGoBack: vi.fn(() => canGoBack), replace: vi.fn(), dismissTo: vi.fn() };
		const e = { ...effects(), home: () => leaveToInicio(router) };
		expect(await answerLinkTerminal("cancel", target, e)).toBe("cancelled");
		expect(router.back).not.toHaveBeenCalled(); expect(router.canGoBack).not.toHaveBeenCalled();
		// One POP_TO removes the stacked screens without focusing them, or opens Inicio if it is not in the stack.
		expect(router.dismissTo).toHaveBeenCalledExactlyOnceWith("/");
		expect(e.live).not.toHaveBeenCalled(); expect(e.open).not.toHaveBeenCalled();
	});

	it("the confirmation screen has no way back to the previous screen", () => {
		const screen = readFileSync(fileURLToPath(new URL("../src/app/link-terminal.tsx", import.meta.url)), "utf8");
		expect(screen).not.toMatch(/\.back\(|canGoBack|goBack/);
		expect(screen).toMatch(/leaveToInicio\(router\)/);
		// Android back is the same exit as «Cancelar», not a pop to the screen underneath.
		expect(screen).toMatch(/BackHandler\.addEventListener\("hardwareBackPress", \(\) => \{ leave\(\); return true; \}\)/);
	});

	it("an ended session or unreachable computer after «Abrir» opens nothing", async () => {
		const ended = effects(); ended.live.mockResolvedValueOnce([]);
		expect(await answerLinkTerminal("open", target, ended)).toBe("gone");
		const down = effects(); down.live.mockRejectedValueOnce(new Error("UNREACHABLE"));
		expect(await answerLinkTerminal("open", target, down)).toBe("gone");
		expect(ended.open).not.toHaveBeenCalled(); expect(down.open).not.toHaveBeenCalled();
	});
});

describe("terminals opened inside the app keep opening directly", () => {
	const src = (path: string) => readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), "utf8");
	it("tiles, switcher, shortcuts, launcher and the session screen go straight to the terminal route", () => {
		expect(TERMINAL_ROUTE).toBe("/session/terminal/[id]");
		for (const path of ["ui/terminal-launcher.tsx", "ui/shortcuts.tsx", "app/session/terminal/[id].tsx", "app/session/[id].tsx", "app/session/open/[id].tsx", "app/open-terminal/index.tsx"]) {
			expect(src(path)).not.toMatch(/link-terminal|linkTerminal/);
		}
	});
	it("an external link cannot name the confirmation route itself", () => {
		for (const path of ["mars-ram://link-terminal?h=0070&b=0073", "/link-terminal?h=0070&b=0073"]) expect(allowedSystemPath(path)).toBe("/");
	});
});

function elements(node: unknown): { type: unknown; props: Record<string, any> }[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!isValidElement<Record<string, any>>(node)) return [];
	return [{ type: node.type, props: node.props }, ...elements(node.props.footer), ...elements(node.props.children)];
}
const texts = (nodes: ReturnType<typeof elements>) => nodes.filter(n => n.type === "Text").map(n => [n.props.children].flat().join(""));
const theme = { touch: 48, spacing: (n: number) => n * 4, radius: { medium: 12 }, colors: { text: "w", textMuted: "g", accentText: "a", card: "c", border: "b", danger: "r" } };

describe("the confirmation screen", () => {
	it.each([["es", es, "Abrir", "Cancelar"], ["en", en, "Open", "Cancel"]] as const)("names the computer and what will happen (%s)", (_l, t, open, cancel) => {
		const onOpen = vi.fn(), onCancel = vi.fn(), onHome = vi.fn();
		const nodes = elements(LinkTerminalView({ phase: "confirm", computer: "devbox", t, theme: theme as never, onOpen, onCancel, onHome }));
		const shown = texts(nodes);
		expect(shown).toContain(t.linkTerminal.title);
		expect(shown).toContain("devbox");
		expect(shown).toContain(t.linkTerminal.explain("devbox"));
		expect(t.linkTerminal.explain("devbox")).toContain("Herdr");
		const primary = nodes.find(n => n.type === "PrimaryButton")!;
		expect(primary.props.label).toBe(open);
		const back = nodes.find(n => n.type === "Pressable" && n.props.accessibilityLabel === cancel)!;
		expect(back.props.accessibilityRole).toBe("button");
		expect(back.props.style.minHeight).toBeGreaterThanOrEqual(48);
		expect(onOpen).not.toHaveBeenCalled(); primary.props.onPress(); expect(onOpen).toHaveBeenCalledOnce();
		back.props.onPress(); expect(onCancel).toHaveBeenCalledOnce();
	});

	it("shows connecting, gone and invalid states without an «Abrir» button", () => {
		for (const phase of ["opening", "gone", "invalid"] as const) {
			const nodes = elements(LinkTerminalView({ phase, computer: "devbox", t: es, theme: theme as never, onOpen: vi.fn(), onCancel: vi.fn(), onHome: vi.fn() }));
			expect(nodes.some(n => n.type === "PrimaryButton" && n.props.label === es.linkTerminal.open)).toBe(false);
			expect(texts(nodes).join(" ")).toContain(phase === "opening" ? es.linkTerminal.opening("devbox") : phase === "gone" ? es.linkTerminal.gone("devbox") : es.linkTerminal.invalid);
		}
	});
});
