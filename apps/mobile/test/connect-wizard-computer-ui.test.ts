import { createElement, isValidElement } from "react";
import { expect, it, vi } from "vitest";
import { es } from "../src/ui/i18n/es";
import { ComputerStep } from "../src/ui/connect-wizard/computer-step";
import { usePreferences } from "../src/ui/preferences";

vi.mock("react-native", () => ({ View: "View", Text: "Text" }));
vi.mock("../src/ui/components", () => ({ PrimaryButton: "PrimaryButton" }));
vi.mock("../src/ui/install-help", () => ({ CommandBlock: "CommandBlock" }));
vi.mock("../src/ui/preferences", () => ({ usePreferences: vi.fn() }));
vi.mock("../src/ui/connect-wizard/parts", () => ({ PathText: "PathText", StepTitle: "StepTitle", Tabs: "Tabs" }));
vi.mock("../src/ui/connect-wizard/phone-steps", () => ({ StepLayout: "StepLayout" }));
vi.mocked(usePreferences).mockReturnValue({ theme: { spacing: (n: number) => n * 4, font: { mono: "mono" }, colors: { text: "white", textMuted: "gray", border: "gray" } }, t: es } as never);

function elements(node: unknown): { type: unknown; props: Record<string, any> }[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!isValidElement<Record<string, any>>(node)) return [];
	return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}

const props = { top: null, os: "linux" as const, onOs: () => {}, onScan: () => {}, choice: "zerotier" as const };

it("shows the network choice above «Computadora» when the wizard gives one", () => {
	const chooser = createElement("NetworkTabs");
	const nodes = elements(ComputerStep({ ...props, chooser }));
	const types = nodes.map((node) => node.type);
	expect(types).toContain("NetworkTabs");
	expect(types.indexOf("NetworkTabs")).toBeLessThan(types.indexOf("StepTitle"));
	expect(elements(ComputerStep(props)).map((node) => node.type)).not.toContain("NetworkTabs");
});

/** Like elements, but also renders the step's own function components (they only read preferences). */
function rendered(node: unknown): { type: unknown; props: Record<string, any> }[] {
	if (Array.isArray(node)) return node.flatMap(rendered);
	if (!isValidElement<Record<string, any>>(node)) return [];
	if (typeof node.type === "function") return rendered((node.type as (props: unknown) => unknown)(node.props));
	return [{ type: node.type, props: node.props }, ...rendered(node.props.children)];
}
const texts = (node: unknown): string[] => rendered(node).flatMap((element) => [element.props.children].flat().filter((child): child is string => typeof child === "string"));
const commands = (node: unknown): string[] => rendered(node).filter((element) => element.type === "CommandBlock").map((element) => element.props.command);

it("tells a Linux ZeroTier computer how to let ZeroTier through ufw, with a command to copy", () => {
	const linux = ComputerStep(props);
	expect(texts(linux)).toContain(es.wizard.firewall);
	expect(commands(linux)).toEqual(["pnpm add -g mars-ram", "mars-ram install", es.wizard.firewallCommand, "mars-ram pair-zt"]);
	expect(es.wizard.firewallCommand).toBe("sudo ufw allow in on <interfaz de ZeroTier>");
	expect(es.wizard.firewall).toBe("Si usás firewall (ufw), dejá pasar ZeroTier. mars-ram pair-zt te muestra el comando exacto, con el nombre de la interfaz:");
});

it("shows no firewall line on macOS, Windows or Tailscale", () => {
	for (const step of [ComputerStep({ ...props, os: "macos" }), ComputerStep({ ...props, os: "windows" }), ComputerStep({ ...props, choice: "tailscale" })]) {
		expect(texts(step)).not.toContain(es.wizard.firewall);
		expect(commands(step)).not.toContain(es.wizard.firewallCommand);
	}
});
