// The «Agregar computadora» wizard (PRD R1): which steps it shows, when a phone step passes, and what a failed scan most likely means.
import { installCommands } from "./install-command";
import type { WizardNetwork } from "./network-choice";
import type { PairingFailureCode } from "./pairing";
import { zeroTierPhone, type PhoneNetworkState } from "./phone-network";

export type WizardStep = "tailscale" | "dns" | "zerotier" | "computer" | "scan";
/** A phone check: passes, fails, or the phone could not tell. */
export type StepCheck = "pass" | "fail" | "unknown";

export type WizardModel = {
	step: WizardStep;
	/** Null until the first read, or when the phone cannot be read. */
	network: PhoneNetworkState | null;
	/** Private DNS was active during this run: its step stays in the bar, marked done, once fixed. */
	dnsConflict: boolean;
	/** The network the steps guide through; a scanned offer still pairs over its own network. */
	choice: WizardNetwork;
};

const PHONE_STEPS: readonly WizardStep[] = ["tailscale", "dns", "zerotier"];

export function isPhoneStep(step: WizardStep): boolean {
	return PHONE_STEPS.includes(step);
}

/**
 * Normally Tailscale · Computadora · Escanear; the DNS step appears only when Private DNS is in the way.
 * ZeroTier · Computadora · Escanear never has it: ZeroTier pairs by IP address, without MagicDNS.
 */
export function wizardSteps(model: WizardModel): WizardStep[] {
	if (model.choice === "zerotier") return ["zerotier", "computer", "scan"];
	return model.dnsConflict ? ["tailscale", "dns", "computer", "scan"] : ["tailscale", "computer", "scan"];
}

/** Only phone steps can be checked; the computer and the scan cannot. */
export function stepCheck(step: WizardStep, network: PhoneNetworkState | null): StepCheck {
	if (!network) return "unknown";
	if (step === "tailscale") return network.tailscaleInstalled && network.tailscaleOn ? "pass" : "fail";
	if (step === "dns") return network.privateDnsActive === true ? "fail" : "pass";
	if (step === "zerotier") {
		const zerotier = zeroTierPhone(network);
		return !zerotier ? "unknown" : zerotier.on ? "pass" : "fail";
	}
	return "unknown";
}

/** The step after `from`, skipping phone steps that already pass. */
function nextOpenStep(steps: WizardStep[], from: number, network: PhoneNetworkState | null): WizardStep {
	for (const step of steps.slice(from)) {
		if (!isPhoneStep(step) || stepCheck(step, network) !== "pass") return step;
	}
	return "scan";
}

export function startWizard(network: PhoneNetworkState | null, start?: WizardStep, choice: WizardNetwork = "tailscale"): WizardModel {
	const model: WizardModel = { step: "tailscale", network, dnsConflict: network?.privateDnsActive === true, choice };
	return { ...model, step: start ?? nextOpenStep(wizardSteps(model), 0, network) };
}

/**
 * Where the network can be changed: its first step, and «Computadora», where a saved choice whose phone check
 * passes opens the wizard with nothing to go back to.
 */
export function showsNetworkChoice(model: WizardModel): boolean {
	return model.step === wizardSteps(model)[0] || model.step === "computer";
}

/**
 * The other network's steps. From the first step, its phone step so the user sees its check; from «Computadora»,
 * its first step that does not pass yet, which is «Computadora» again when the phone is ready for it.
 */
export function chooseNetwork(model: WizardModel, choice: WizardNetwork): WizardModel {
	const next: WizardModel = { ...model, choice };
	const steps = wizardSteps(next);
	return { ...next, step: model.step === "computer" ? nextOpenStep(steps, 0, model.network) : steps[0] };
}

/** The user moves by hand: back, «Ya sé, escanear», or back to the computer from a diagnosis. */
export function goToStep(model: WizardModel, step: WizardStep): WizardModel {
	return { ...model, step };
}

/** A fresh read, for example when the app returns to the front: a phone step that starts passing moves on by itself. */
export function recheck(model: WizardModel, network: PhoneNetworkState | null): WizardModel {
	const dnsConflict = model.dnsConflict || network?.privateDnsActive === true;
	const next: WizardModel = { ...model, network, dnsConflict };
	const started = isPhoneStep(model.step) && stepCheck(model.step, model.network) !== "pass" && stepCheck(model.step, network) === "pass";
	if (!started) return next;
	const steps = wizardSteps(next);
	return { ...next, step: nextOpenStep(steps, steps.indexOf(model.step) + 1, network) };
}

/** What a scan that failed or stalled most likely needs: the phone's Tailscale, its Private DNS, its ZeroTier, or something on the computer. */
export type Diagnosis = "tailscale_off" | "private_dns" | "zerotier_off" | "check_computer";

/** Failures where the phone did not get through to the computer; the others already say what to do. */
const UNREACHED: readonly PairingFailureCode[] = ["UNREACHABLE", "PRIVATE_DNS", "SEND_FAILED", "TIMEOUT", "HOST_NOT_FOUND", "NOT_ON_VPN"];

export function diagnosisOffered(code: PairingFailureCode | undefined): boolean {
	return code !== undefined && UNREACHED.includes(code);
}

/**
 * The cause from pairing's failure code (or "slow": no answer yet) and a fresh read of the phone; the phone's own checks come first.
 * `over` is the network of the failed offer, or the wizard's choice while it still waits.
 */
export function diagnose(trigger: { code?: PairingFailureCode } | "slow", network: PhoneNetworkState | null, over: WizardNetwork = "tailscale"): Diagnosis {
	if (over === "zerotier") {
		const zerotier = zeroTierPhone(network);
		if ((trigger !== "slow" && trigger.code === "NOT_ON_VPN") || (zerotier && !zerotier.on)) return "zerotier_off";
		return "check_computer";
	}
	if (network && (!network.tailscaleInstalled || !network.tailscaleOn)) return "tailscale_off";
	if ((trigger !== "slow" && trigger.code === "PRIVATE_DNS") || network?.privateDnsActive === true) return "private_dns";
	return "check_computer";
}

export type PhoneWarning = "tailscale_missing" | "tailscale_off" | "private_dns" | "zerotier_missing" | "zerotier_off";

/** Shown on the scan step: scanning stays enabled, but the user knows it will likely fail. */
export function phoneWarnings(network: PhoneNetworkState | null, choice: WizardNetwork = "tailscale"): PhoneWarning[] {
	if (!network) return [];
	if (choice === "zerotier") {
		const zerotier = zeroTierPhone(network);
		if (!zerotier || zerotier.on) return [];
		return [zerotier.installed ? "zerotier_off" : "zerotier_missing"];
	}
	const warnings: PhoneWarning[] = [];
	if (!network.tailscaleInstalled) warnings.push("tailscale_missing");
	else if (!network.tailscaleOn) warnings.push("tailscale_off");
	if (network.privateDnsActive === true) warnings.push("private_dns");
	return warnings;
}

/** How long the phone may look for the computer before «Ver qué pasa» appears; the attempt keeps going. */
export const SLOW_MS = 15_000;

/** Offered only while the phone has not reached the computer; once it answered, only its user's confirmation is pending. */
export function slowOffer(waiting: { stage: "reaching" | "confirming"; since: number }, now: number): boolean {
	return waiting.stage === "reaching" && now - waiting.since >= SLOW_MS;
}

export type ComputerOs = "linux" | "macos" | "windows";

/** One line of the computer step; the screen words the requirements in the user's language. */
export type ComputerInstruction =
	| { kind: "node" }
	| { kind: "tailscale" }
	| { kind: "zerotier" }
	| { kind: "ssh"; os: ComputerOs }
	/** Linux firewalls (ufw) block ZeroTier by default; Tailscale lets itself through. */
	| { kind: "firewall" }
	/** addressHint: mention `--address` for a computer in several ZeroTier networks. */
	| { kind: "command"; command: string; alternative?: string; note?: "admin" | "qr"; addressHint?: true };

/**
 * Tailscale: Node.js 24+, Tailscale with MagicDNS, the SSH server, then install, set up and pair (README › Install).
 * ZeroTier: Node.js 24+, install and set up, ZeroTier joined and authorized, the SSH server, on Linux the firewall, then `mars-ram pair-zt`.
 */
export function computerInstructions(os: ComputerOs, choice: WizardNetwork = "tailscale"): ComputerInstruction[] {
	if (choice === "zerotier") {
		return [
			{ kind: "node" },
			{ kind: "command", command: installCommands.recommended, alternative: installCommands.npm },
			{ kind: "command", command: "mars-ram install" },
			{ kind: "zerotier" },
			{ kind: "ssh", os },
			...(os === "linux" ? [{ kind: "firewall" } as const] : []),
			{ kind: "command", command: "mars-ram pair-zt", note: os === "windows" ? "admin" : "qr", addressHint: true },
		];
	}
	return [
		{ kind: "node" },
		{ kind: "tailscale" },
		{ kind: "ssh", os },
		{ kind: "command", command: installCommands.recommended, alternative: installCommands.npm },
		{ kind: "command", command: "mars-ram install" },
		// The CLI asks Windows administrators to authorize the phone from an administrator terminal.
		{ kind: "command", command: "mars-ram pair", note: os === "windows" ? "admin" : "qr" },
	];
}

/** What to check on the computer when the phone reached the network but not the computer, most likely first. */
export type ComputerCause = "account" | "zerotier_network" | "zerotier_authorized" | "firewall" | "ssh" | "awake";

export function computerCauses(over: WizardNetwork, os: ComputerOs): ComputerCause[] {
	if (over !== "zerotier") return ["account", "ssh", "awake"];
	return ["zerotier_network", "zerotier_authorized", ...(os === "linux" ? ["firewall" as const] : []), "ssh", "awake"];
}
