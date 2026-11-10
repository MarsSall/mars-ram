import { describe, expect, it } from "vitest";
import { computerInstructions, diagnose, diagnosisOffered, goToStep, phoneWarnings, recheck, SLOW_MS, slowOffer, startWizard, wizardSteps } from "../src/core/connect-wizard";
import type { PhoneNetworkState } from "../src/core/phone-network";

const ready: PhoneNetworkState = { tailscaleInstalled: true, tailscaleOn: true, privateDnsActive: false };
const off: PhoneNetworkState = { ...ready, tailscaleOn: false };
const privateDns: PhoneNetworkState = { ...ready, privateDnsActive: true };

describe("wizard steps", () => {
	it("has three steps when Private DNS is off or cannot be read", () => {
		expect(wizardSteps(startWizard(ready))).toEqual(["tailscale", "computer", "scan"]);
		expect(wizardSteps(startWizard({ ...ready, privateDnsActive: null }))).toEqual(["tailscale", "computer", "scan"]);
		expect(wizardSteps(startWizard(null))).toEqual(["tailscale", "computer", "scan"]);
	});

	it("inserts the DNS step only when Private DNS is active", () => {
		expect(wizardSteps(startWizard(privateDns))).toEqual(["tailscale", "dns", "computer", "scan"]);
	});

	it("starts at the first phone step that does not pass, or at the computer when the phone is ready", () => {
		expect(startWizard(off).step).toBe("tailscale");
		expect(startWizard({ ...ready, tailscaleInstalled: false, tailscaleOn: false }).step).toBe("tailscale");
		expect(startWizard(privateDns).step).toBe("dns");
		expect(startWizard(ready).step).toBe("computer");
		// Unread checks are not passing: the user sees the step and can move on.
		expect(startWizard(null).step).toBe("tailscale");
	});

	it("can start at the scan step, for «Ya sé, escanear» entries", () => {
		expect(startWizard(off, "scan").step).toBe("scan");
	});
});

describe("re-reading the phone", () => {
	it("moves on by itself when the step on screen starts passing", () => {
		expect(recheck(startWizard(off), ready).step).toBe("computer");
		expect(recheck(startWizard(privateDns), ready).step).toBe("computer");
	});

	it("goes from Tailscale to the DNS step when fixing Tailscale reveals Private DNS", () => {
		const model = recheck(startWizard(off), privateDns);
		expect(model.step).toBe("dns");
		expect(wizardSteps(model)).toEqual(["tailscale", "dns", "computer", "scan"]);
	});

	it("keeps the DNS step in the bar after it is fixed during this run", () => {
		expect(wizardSteps(recheck(startWizard(privateDns), ready))).toEqual(["tailscale", "dns", "computer", "scan"]);
	});

	it("stays when the step still fails", () => {
		expect(recheck(startWizard(off), off).step).toBe("tailscale");
	});

	it("does not move the user away from a passing step they went back to", () => {
		const back = goToStep(startWizard(ready), "tailscale");
		expect(back.step).toBe("tailscale");
		expect(recheck(back, ready).step).toBe("tailscale");
	});

	it("does not move on from the computer or scan steps", () => {
		expect(recheck(startWizard(ready), ready).step).toBe("computer");
		expect(recheck(startWizard(off, "scan"), ready).step).toBe("scan");
	});

	it("keeps the step when the phone can no longer be read", () => {
		const model = recheck(startWizard(off), null);
		expect(model.step).toBe("tailscale");
		expect(model.network).toBeNull();
	});
});

describe("diagnosis", () => {
	it("names Tailscale when it is off or missing on the phone, whatever the failure", () => {
		expect(diagnose({ code: "UNREACHABLE" }, off)).toBe("tailscale_off");
		expect(diagnose("slow", { ...ready, tailscaleInstalled: false, tailscaleOn: false })).toBe("tailscale_off");
		expect(diagnose({ code: "PRIVATE_DNS" }, off)).toBe("tailscale_off");
	});

	it("names Private DNS when pairing says so or the phone has it on", () => {
		expect(diagnose({ code: "PRIVATE_DNS" }, ready)).toBe("private_dns");
		expect(diagnose({ code: "UNREACHABLE" }, privateDns)).toBe("private_dns");
		expect(diagnose("slow", privateDns)).toBe("private_dns");
		// Pairing's own evidence counts even when the phone cannot be read.
		expect(diagnose({ code: "PRIVATE_DNS" }, null)).toBe("private_dns");
	});

	it("points at the computer when the phone passes every check", () => {
		expect(diagnose({ code: "UNREACHABLE" }, ready)).toBe("check_computer");
		expect(diagnose({ code: "SEND_FAILED" }, ready)).toBe("check_computer");
		expect(diagnose("slow", ready)).toBe("check_computer");
		expect(diagnose({ code: "UNREACHABLE" }, { ...ready, privateDnsActive: null })).toBe("check_computer");
	});

	it("is offered for failures to reach the computer, not for ones the message already explains", () => {
		expect(diagnosisOffered("UNREACHABLE")).toBe(true);
		expect(diagnosisOffered("PRIVATE_DNS")).toBe(true);
		expect(diagnosisOffered("SEND_FAILED")).toBe(true);
		expect(diagnosisOffered("TIMEOUT")).toBe(true);
		expect(diagnosisOffered("CODE_EXPIRED")).toBe(false);
		expect(diagnosisOffered("INVALID_QR")).toBe(false);
		expect(diagnosisOffered("REFUSED")).toBe(false);
		expect(diagnosisOffered(undefined)).toBe(false);
	});
});

describe("scan warnings", () => {
	it("lists what will likely make the scan fail, without blocking it", () => {
		expect(phoneWarnings(ready)).toEqual([]);
		expect(phoneWarnings(null)).toEqual([]);
		expect(phoneWarnings({ ...ready, tailscaleInstalled: false, tailscaleOn: false })).toEqual(["tailscale_missing"]);
		expect(phoneWarnings({ ...off, privateDnsActive: true })).toEqual(["tailscale_off", "private_dns"]);
	});
});

describe("«Ver qué pasa» while waiting", () => {
	it("is offered after 15 s without reaching the computer", () => {
		expect(SLOW_MS).toBe(15_000);
		expect(slowOffer({ stage: "reaching", since: 1_000 }, 15_999)).toBe(false);
		expect(slowOffer({ stage: "reaching", since: 1_000 }, 16_000)).toBe(true);
	});

	it("is not offered once the computer answered and only the user's confirmation there is pending", () => {
		expect(slowOffer({ stage: "confirming", since: 1_000 }, 120_000)).toBe(false);
	});
});

describe("computer instructions", () => {
	it("gives each system its SSH server and the same install, setup and pair commands", () => {
		for (const os of ["linux", "macos", "windows"] as const) {
			const steps = computerInstructions(os);
			expect(steps.slice(0, 3)).toEqual([{ kind: "node" }, { kind: "tailscale" }, { kind: "ssh", os }]);
			expect(steps.slice(3).map((step) => step.kind === "command" && step.command)).toEqual(["pnpm add -g mars-ram", "mars-ram install", "mars-ram pair"]);
		}
	});

	it("offers npm as the alternative install, and on Windows asks for an administrator terminal to pair, as the CLI does", () => {
		expect(computerInstructions("linux")[3]).toEqual({ kind: "command", command: "pnpm add -g mars-ram", alternative: "npm i -g mars-ram" });
		expect(computerInstructions("windows")[5]).toEqual({ kind: "command", command: "mars-ram pair", note: "admin" });
		expect(computerInstructions("macos")[5]).toEqual({ kind: "command", command: "mars-ram pair", note: "qr" });
	});
});
