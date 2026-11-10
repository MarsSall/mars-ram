import { isValidElement } from "react";
import { expect, it, vi } from "vitest";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";
import { DiagnosisView } from "../src/ui/connect-wizard/diagnosis";
import { usePreferences } from "../src/ui/preferences";

vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), useState: (value: unknown) => [value, () => {}] }));
vi.mock("react-native", () => ({ View: "View", Text: "Text" }));
vi.mock("../src/ui/components", () => ({ PrimaryButton: "PrimaryButton" }));
vi.mock("../src/ui/install-help", () => ({ CommandBlock: "CommandBlock" }));
vi.mock("../src/ui/preferences", () => ({ usePreferences: vi.fn() }));
vi.mock("../src/ui/connect-wizard/parts", () => ({ CheckRow: "CheckRow", ErrorText: "ErrorText", Kicker: "Kicker", Panel: "Panel", PathText: "PathText", QuietButton: "QuietButton", SecondaryButton: "SecondaryButton", StepTitle: "StepTitle" }));
vi.mock("../src/ui/connect-wizard/phone-steps", () => ({ StepLayout: "StepLayout" }));
vi.mock("../src/ui/connect-wizard/use-phone-network", () => ({ phoneActions: {} }));
const theme = { spacing: (n: number) => n * 4, font: { mono: "mono" }, colors: { text: "white", textMuted: "gray", border: "gray", surfaceRaised: "black" } };
const language = (t: typeof es) => vi.mocked(usePreferences).mockReturnValue({ theme, t } as never);

function elements(node: unknown): { type: unknown; props: Record<string, any> }[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!isValidElement<Record<string, any>>(node)) return [];
	return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
const texts = (node: unknown): string[] => elements(node).flatMap((element) => [element.props.children].flat().filter((child): child is string => typeof child === "string"));
const commands = (node: unknown): string[] => elements(node).filter((element) => element.type === "CommandBlock").map((element) => element.props.command);

const props = { top: null, diagnosis: "check_computer" as const, network: null, over: "zerotier" as const, computerName: "devbox", os: "linux" as const, onRetry: () => {}, onBackToComputer: () => {} };

it("lists «El firewall de la computadora bloquea ZeroTier» right after the my.zerotier.com authorization, with the ufw command", () => {
	language(es);
	const view = DiagnosisView(props);
	const lines = texts(view);
	const d = es.wizard.diagnosis;
	expect(lines.indexOf(d.firewall)).toBe(lines.indexOf(d.zerotierAuthorizedHint) + 1);
	expect(d.firewall).toBe("El firewall de la computadora bloquea ZeroTier");
	expect(lines).toContain(d.firewallHint);
	expect(commands(view)).toEqual([es.wizard.firewallCommand, "mars-ram doctor"]);
});

it("words the firewall cause in English too", () => {
	language(en);
	const view = DiagnosisView(props);
	expect(texts(view)).toContain("The computer's firewall blocks ZeroTier");
	expect(commands(view)).toEqual(["sudo ufw allow in on <ZeroTier interface>", "mars-ram doctor"]);
});

it("leaves the firewall out on macOS, Windows and Tailscale", () => {
	language(es);
	for (const view of [DiagnosisView({ ...props, os: "macos" }), DiagnosisView({ ...props, os: "windows" }), DiagnosisView({ ...props, over: "tailscale" })]) {
		expect(texts(view)).not.toContain(es.wizard.diagnosis.firewall);
		expect(commands(view)).toEqual(["mars-ram doctor"]);
	}
});
