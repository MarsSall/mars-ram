import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { es } from "../src/ui/i18n/es";
import { HomeHeading, WelcomeSteps } from "../src/ui/home-welcome";

const push = vi.fn();
vi.mock("expo-router", () => ({ useRouter: () => ({ push }) }));
vi.mock("react-native", () => ({ Image: "Image", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" }));
vi.mock("../src/ui/components", () => ({ PrimaryButton: "PrimaryButton", Screen: "Screen" }));
vi.mock("../src/ui/install-help", () => ({ InstallSteps: "InstallSteps" }));
vi.mock("../src/ui/preferences", async () => {
	const { es } = await import("../src/ui/i18n/es");
	return { usePreferences: () => ({ t: es, theme: { spacing: (n: number) => n * 4, touch: 48, colors: { text: "white", textMuted: "gray", accentText: "blue" } } }) };
});

type Node = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Node[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!isValidElement<Record<string, any>>(node)) return [];
	return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
/** What a reader meets, in order: the heading, the install steps, texts, and buttons by their label. */
const reading = (nodes: Node[]) =>
	nodes.flatMap((node) => {
		if (node.type === HomeHeading) return ["HomeHeading"];
		if (node.type === "InstallSteps") return ["InstallSteps"];
		if (node.type === "PrimaryButton") return [node.props.label];
		if (node.type === "Text") return [node.props.children];
		return [];
	});

describe("the welcome", () => {
	const view = elements(WelcomeSteps({}));
	const scroll = view.find((node) => node.type === "ScrollView")!;
	const inside = elements(scroll.props.children);
	const scan = view.find((node) => node.type === "PrimaryButton" && node.props.label === es.home.scan)!;

	it("keeps «Escanear código» in a footer outside the scroll, so it is visible without scrolling", () => {
		expect(scan).toBeDefined();
		expect(inside.some((node) => node.type === "PrimaryButton")).toBe(false);
		scan.props.onPress();
		expect(push).toHaveBeenCalledWith("/add-computer/scan");
	});

	it("keeps the rest of its content and order inside the scroll", () => {
		expect(reading(inside)).toEqual(["HomeHeading", "InstallSteps", es.home.windowsPair, es.home.guide, es.home.manual]);
		expect(reading(view).at(-1)).toBe(es.home.scan);
	});
});
