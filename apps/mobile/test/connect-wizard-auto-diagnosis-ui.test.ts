import { afterEach, describe, expect, it, vi } from "vitest";
import type { PhoneNetworkState } from "../src/core/phone-network";
import type { PairingPhase } from "../src/ui/connect-wizard/pairing-runner";
import { ConnectWizard } from "../src/ui/connect-wizard/wizard";

// Hooks run as plain functions: refs keep their value across renders by call order, effects run when the test says.
const f = vi.hoisted(() => ({
	effects: [] as (() => void | (() => void))[],
	refs: [] as { current: unknown }[],
	refIndex: 0,
	diagnosis: [] as unknown[],
	phase: { kind: "idle" } as unknown,
	network: null as unknown,
	readNow: vi.fn(),
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useEffect: (effect: () => void | (() => void)) => {
		f.effects.push(effect);
	},
	useRef: (initial: unknown) => (f.refs[f.refIndex++] ??= { current: initial }),
	useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, (next: unknown) => f.diagnosis.push(next)],
}));
vi.mock("react-native", () => ({ BackHandler: { addEventListener: () => ({ remove: () => {} }) } }));
vi.mock("expo-router", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock("../src/services", () => ({ networkChoice: { saved: () => "tailscale", current: () => "tailscale", choose: vi.fn() } }));
vi.mock("../src/ui/preferences", () => ({ usePreferences: () => ({ t: { add: { title: "Agregar" }, wizard: { step: () => "1/3", notConnected: "x" } } }) }));
vi.mock("../src/ui/connect-wizard/pairing-runner", () => ({ usePairingRunner: () => ({ phase: f.phase, run: vi.fn(), reset: vi.fn() }) }));
vi.mock("../src/ui/connect-wizard/use-phone-network", () => ({ usePhoneNetwork: () => ({ readNow: f.readNow }) }));
vi.mock("../src/ui/connect-wizard/computer-step", () => ({ ComputerStep: "ComputerStep" }));
vi.mock("../src/ui/connect-wizard/diagnosis", () => ({ DiagnosisView: "DiagnosisView" }));
vi.mock("../src/ui/connect-wizard/network-choice", () => ({ NetworkChoiceStep: "NetworkChoiceStep", NetworkTabs: "NetworkTabs" }));
vi.mock("../src/ui/connect-wizard/parts", () => ({ ProgressBar: "ProgressBar", WizardHeader: "WizardHeader" }));
vi.mock("../src/ui/connect-wizard/phone-steps", () => ({ DnsStep: "DnsStep", ReadingPhone: "ReadingPhone", TailscaleStep: "TailscaleStep", ZeroTierStep: "ZeroTierStep" }));
vi.mock("../src/ui/connect-wizard/scan-step", () => ({ ScanStep: "ScanStep" }));

const phoneOnZeroTier: PhoneNetworkState = { tailscaleInstalled: true, tailscaleOn: false, privateDnsActive: false, zerotierInstalled: true, vpnOn: true };

/** One render of the wizard opened on its camera, then its effects, as React would after committing it. */
async function render(phase: PairingPhase) {
	f.phase = phase;
	f.refIndex = 0;
	f.effects.length = 0;
	ConnectWizard({ start: "scan" });
	for (const effect of f.effects) effect();
	await new Promise((resolve) => setTimeout(resolve));
}

afterEach(() => {
	f.refs.length = 0;
	f.diagnosis.length = 0;
	f.readNow.mockReset();
});

describe("a scan that fails inside the connect wizard", () => {
	it("opens the diagnosis by itself, over the offer's network, for a failure that did not reach the computer", async () => {
		f.readNow.mockResolvedValue(phoneOnZeroTier);
		await render({ kind: "failed", message: "no responde", code: "UNREACHABLE", network: "zerotier" });
		expect(f.readNow).toHaveBeenCalledOnce();
		expect(f.diagnosis).toEqual([{ kind: "reading" }, { kind: "ready", diagnosis: "check_computer", network: phoneOnZeroTier, over: "zerotier" }]);
	});

	it("opens it once per failure: backing out of it keeps the failure screen, a new failure opens it again", async () => {
		f.readNow.mockResolvedValue(null);
		const failure: PairingPhase = { kind: "failed", message: "x", code: "SEND_FAILED" };
		await render(failure);
		await render(failure);
		expect(f.readNow).toHaveBeenCalledOnce();
		await render({ kind: "idle" });
		await render({ kind: "failed", message: "x", code: "TIMEOUT" });
		expect(f.readNow).toHaveBeenCalledTimes(2);
	});

	it.each(["CODE_EXPIRED", "PAIRING_CLOSED", "REFUSED", "INVALID_QR", "MAGICDNS_REQUIRED", undefined] as const)("keeps today's failure screen for %s", async (code) => {
		await render({ kind: "failed", message: "x", code });
		expect(f.readNow).not.toHaveBeenCalled();
		expect(f.diagnosis).toEqual([]);
	});

	it("does not open it while the pairing is still running", async () => {
		await render({ kind: "pairing", stage: "reaching", since: 0 });
		expect(f.readNow).not.toHaveBeenCalled();
	});
});
