import { isValidElement } from "react";
import { expect, it, vi } from "vitest";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";
import { ShortcutActions } from "../src/ui/shortcut-actions";
import { usePreferences } from "../src/ui/preferences";
import { HOME_OPEN_TERMINAL } from "../src/core/tour";
import { TourAnchor } from "../src/ui/tour/anchors";

vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable" }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
vi.mock("../src/ui/preferences", () => ({ usePreferences: vi.fn() }));
vi.mock("../src/ui/tour/anchors", () => ({ TourAnchor: "TourAnchor" }));
const theme = { spacing: (n: number) => n * 4, radius: { medium: 12 }, colors: { text: "white", textMuted: "gray", border: "gray", card: "black", accentText: "blue" } };

function elements(node: unknown): { type: unknown; props: Record<string, any> }[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!isValidElement<Record<string, any>>(node)) return [];
	return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}

it.each([["es", es], ["en", en]] as const)("puts «%s» open terminal right next to «Agregar atajo»", (_language, t) => {
	vi.mocked(usePreferences).mockReturnValue({ theme, t } as never);
	const add = vi.fn(); const openTerminal = vi.fn();
	const root = ShortcutActions({ add, openTerminal });
	const buttons = elements(root).filter((node) => node.type === "Pressable");
	expect(buttons.map((node) => node.props.accessibilityLabel)).toEqual([t.shortcuts.add, t.openers.button]);
	// Same row: both are direct children of one horizontal View.
	expect(isValidElement<Record<string, any>>(root) && root.props.style.flexDirection).toBe("row");
	expect(elements(root.props.children).filter((node) => node.type === "Pressable")).toHaveLength(2);
	buttons[0].props.onPress(); expect(add).toHaveBeenCalledOnce(); expect(openTerminal).not.toHaveBeenCalled();
	buttons[1].props.onPress(); expect(openTerminal).toHaveBeenCalledOnce();
	expect(buttons.every((node) => node.props.style.some?.((s: any) => s?.minHeight >= 48) || node.props.style.minHeight >= 48)).toBe(true);
	expect(elements(root).some((node) => node.type === "Ionicons" && node.props.name === "terminal-outline")).toBe(true);
});

// As React Native merges a style array: the last width wins.
const widthOf = (style: any) => [style].flat(Infinity).reduce((width: unknown, s: any) => s?.width ?? width, undefined);

it("anchors «Abrir terminal» for the tour, the wrapper taking the tile's width", () => {
	vi.mocked(usePreferences).mockReturnValue({ theme, t: es } as never);
	const root = ShortcutActions({ add: vi.fn(), openTerminal: vi.fn() });
	const anchor = elements(root).find((node) => node.type === TourAnchor);
	expect(anchor?.props.id).toBe(HOME_OPEN_TERMINAL);
	expect(anchor?.props.style).toEqual({ width: "48%" });
	const inside = elements(anchor?.props.children).filter((node) => node.type === "Pressable");
	expect(inside.map((node) => node.props.accessibilityLabel)).toEqual([es.openers.button]);
	expect(widthOf(inside[0].props.style)).toBe("100%");
	// «Agregar atajo» keeps its own 48% and stays outside the anchor.
	const add = elements(root).find((node) => node.type === "Pressable" && node.props.accessibilityLabel === es.shortcuts.add);
	expect(widthOf(add?.props.style)).toBe("48%");
});
