import { describe, expect, it } from "vitest";
import { chooseNetwork, computerCauses, computerInstructions, goToStep, showsNetworkChoice, diagnose, diagnosisOffered, phoneWarnings, recheck, startWizard, stepCheck, wizardSteps } from "../src/core/connect-wizard";
import { zeroTierPhone, type PhoneNetworkState } from "../src/core/phone-network";

// ZeroTier on: some VPN is active and it has no Tailscale address. Android does not say which app owns the VPN.
const zt: PhoneNetworkState = { tailscaleInstalled: true, tailscaleOn: false, privateDnsActive: false, zerotierInstalled: true, vpnOn: true };
const ztOff: PhoneNetworkState = { ...zt, vpnOn: false };
const tailscaleActive: PhoneNetworkState = { ...zt, tailscaleOn: true };
const ztMissing: PhoneNetworkState = { ...ztOff, zerotierInstalled: false };
/** An older or failed native read: the ZeroTier facts are missing. */
const ztUnknown: PhoneNetworkState = { tailscaleInstalled: true, tailscaleOn: true, privateDnsActive: null };

describe("ZeroTier on the phone", () => {
	it("is on only when a VPN is active without a Tailscale address", () => {
		expect(zeroTierPhone(zt)).toEqual({ installed: true, on: true });
		expect(zeroTierPhone(ztOff)).toEqual({ installed: true, on: false });
		// One VPN at a time on Android: Tailscale's VPN means ZeroTier's is off.
		expect(zeroTierPhone(tailscaleActive)).toEqual({ installed: true, on: false });
		expect(zeroTierPhone(ztMissing)).toEqual({ installed: false, on: false });
	});

	it("cannot tell when the phone gave no ZeroTier facts", () => {
		expect(zeroTierPhone(ztUnknown)).toBeNull();
		expect(zeroTierPhone({ ...zt, vpnOn: undefined })).toBeNull();
		expect(zeroTierPhone(null)).toBeNull();
	});
});

describe("ZeroTier wizard steps", () => {
	it("shows ZeroTier · Computadora · Escanear, never the DNS step", () => {
		expect(wizardSteps(startWizard(zt, undefined, "zerotier"))).toEqual(["zerotier", "computer", "scan"]);
		expect(wizardSteps(startWizard({ ...ztOff, privateDnsActive: true }, undefined, "zerotier"))).toEqual(["zerotier", "computer", "scan"]);
		expect(wizardSteps(startWizard(null, undefined, "zerotier"))).toEqual(["zerotier", "computer", "scan"]);
	});

	it("starts at the ZeroTier step until it passes, then at the computer", () => {
		expect(startWizard(ztOff, undefined, "zerotier").step).toBe("zerotier");
		expect(startWizard(ztMissing, undefined, "zerotier").step).toBe("zerotier");
		expect(startWizard(tailscaleActive, undefined, "zerotier").step).toBe("zerotier");
		expect(startWizard(ztUnknown, undefined, "zerotier").step).toBe("zerotier");
		expect(startWizard(zt, undefined, "zerotier").step).toBe("computer");
		expect(startWizard(ztOff, "scan", "zerotier").step).toBe("scan");
	});

	it("checks the ZeroTier step as pass, fail or unknown", () => {
		expect(stepCheck("zerotier", zt)).toBe("pass");
		expect(stepCheck("zerotier", ztOff)).toBe("fail");
		expect(stepCheck("zerotier", ztMissing)).toBe("fail");
		expect(stepCheck("zerotier", tailscaleActive)).toBe("fail");
		expect(stepCheck("zerotier", ztUnknown)).toBe("unknown");
		expect(stepCheck("zerotier", null)).toBe("unknown");
	});

	it("moves on by itself when ZeroTier turns on, even if Private DNS is on", () => {
		const model = recheck(startWizard(ztOff, undefined, "zerotier"), { ...zt, privateDnsActive: true });
		expect(model.step).toBe("computer");
		expect(wizardSteps(model)).toEqual(["zerotier", "computer", "scan"]);
	});

	it("keeps the Tailscale wizard when Tailscale is chosen, which is also the default", () => {
		expect(startWizard(zt).choice).toBe("tailscale");
		expect(wizardSteps(startWizard(zt, undefined, "tailscale"))).toEqual(["tailscale", "computer", "scan"]);
		expect(startWizard(zt, undefined, "tailscale").step).toBe("tailscale");
	});
});

describe("changing the network from the first step", () => {
	it("switches the steps and stays on the new network's phone step", () => {
		const tailscale = startWizard(zt);
		const zerotier = chooseNetwork(tailscale, "zerotier");
		expect(zerotier.choice).toBe("zerotier");
		expect(zerotier.step).toBe("zerotier");
		expect(wizardSteps(zerotier)).toEqual(["zerotier", "computer", "scan"]);
		const back = chooseNetwork(zerotier, "tailscale");
		expect(back.step).toBe("tailscale");
		expect(wizardSteps(back)).toEqual(["tailscale", "computer", "scan"]);
	});
});

describe("changing the network from the computer step", () => {
	// A saved ZeroTier choice whose phone check passes opens the wizard at «Computadora», with nothing to go back to.
	it("offers the network choice on the first step and on the computer step only", () => {
		const zerotier = startWizard(zt, undefined, "zerotier");
		expect(zerotier.step).toBe("computer");
		expect(showsNetworkChoice(zerotier)).toBe(true);
		expect(showsNetworkChoice(startWizard(ztOff, undefined, "zerotier"))).toBe(true);
		expect(showsNetworkChoice(startWizard(zt))).toBe(true);
		expect(showsNetworkChoice(goToStep(zerotier, "scan"))).toBe(false);
		const dns = startWizard({ ...tailscaleActive, privateDnsActive: true });
		expect(dns.step).toBe("dns");
		expect(showsNetworkChoice(dns)).toBe(false);
	});

	it("recomputes the steps and opens the new network's first step that does not pass yet", () => {
		const fromComputer = chooseNetwork(startWizard(zt, undefined, "zerotier"), "tailscale");
		expect(fromComputer.choice).toBe("tailscale");
		expect(wizardSteps(fromComputer)).toEqual(["tailscale", "computer", "scan"]);
		// Tailscale is off on this phone, so the user sees its check.
		expect(fromComputer.step).toBe("tailscale");
		// Tailscale on and Private DNS in the way: the DNS step appears.
		const dns = chooseNetwork(goToStep(startWizard({ ...tailscaleActive, privateDnsActive: true }, undefined, "zerotier"), "computer"), "tailscale");
		expect(wizardSteps(dns)).toEqual(["tailscale", "dns", "computer", "scan"]);
		expect(dns.step).toBe("dns");
		// Tailscale on, nothing in the way: stays at «Computadora» with Tailscale's commands.
		const passing = chooseNetwork(goToStep(startWizard(tailscaleActive, undefined, "zerotier"), "computer"), "tailscale");
		expect(passing.step).toBe("computer");
		expect(passing.choice).toBe("tailscale");
		// And back to ZeroTier, whose check passes on the original phone.
		const again = chooseNetwork(goToStep(fromComputer, "computer"), "zerotier");
		expect(again.step).toBe("computer");
		expect(wizardSteps(again)).toEqual(["zerotier", "computer", "scan"]);
	});

	it("keeps the network on the computer step when the phone cannot be read", () => {
		const unread = chooseNetwork(startWizard(null, "computer", "zerotier"), "tailscale");
		expect(unread.step).toBe("tailscale");
	});
});

describe("ZeroTier diagnosis", () => {
	it("names ZeroTier when pairing says the phone is not on a VPN, whatever the phone read", () => {
		expect(diagnose({ code: "NOT_ON_VPN" }, zt, "zerotier")).toBe("zerotier_off");
		expect(diagnose({ code: "NOT_ON_VPN" }, null, "zerotier")).toBe("zerotier_off");
	});

	it("names ZeroTier when the probe failed with the VPN off, Tailscale holding it, or ZeroTier missing", () => {
		expect(diagnose({ code: "UNREACHABLE" }, ztOff, "zerotier")).toBe("zerotier_off");
		expect(diagnose({ code: "UNREACHABLE" }, tailscaleActive, "zerotier")).toBe("zerotier_off");
		expect(diagnose("slow", ztMissing, "zerotier")).toBe("zerotier_off");
	});

	it("points at the computer when ZeroTier is on, and never at Private DNS", () => {
		expect(diagnose({ code: "UNREACHABLE" }, zt, "zerotier")).toBe("check_computer");
		expect(diagnose({ code: "SEND_FAILED" }, { ...zt, privateDnsActive: true }, "zerotier")).toBe("check_computer");
		expect(diagnose("slow", zt, "zerotier")).toBe("check_computer");
		expect(diagnose({ code: "UNREACHABLE" }, ztUnknown, "zerotier")).toBe("check_computer");
	});

	it("is offered when the phone is not on a VPN", () => {
		expect(diagnosisOffered("NOT_ON_VPN")).toBe(true);
	});
});

describe("ZeroTier scan warnings", () => {
	it("warns about ZeroTier only, without blocking the scan", () => {
		expect(phoneWarnings(zt, "zerotier")).toEqual([]);
		expect(phoneWarnings(ztUnknown, "zerotier")).toEqual([]);
		expect(phoneWarnings(null, "zerotier")).toEqual([]);
		expect(phoneWarnings({ ...ztOff, privateDnsActive: true }, "zerotier")).toEqual(["zerotier_off"]);
		expect(phoneWarnings(ztMissing, "zerotier")).toEqual(["zerotier_missing"]);
	});
});

describe("ZeroTier computer instructions", () => {
	it("installs, joins ZeroTier, turns on SSH and pairs with pair-zt", () => {
		for (const os of ["linux", "macos", "windows"] as const) {
			const steps = computerInstructions(os, "zerotier");
			expect(steps.map((step) => step.kind)).toEqual(os === "linux" ? ["node", "command", "command", "zerotier", "ssh", "firewall", "command"] : ["node", "command", "command", "zerotier", "ssh", "command"]);
			expect(steps[1]).toEqual({ kind: "command", command: "pnpm add -g mars-ram", alternative: "npm i -g mars-ram" });
			expect(steps[2]).toEqual({ kind: "command", command: "mars-ram install" });
			expect(steps[4]).toEqual({ kind: "ssh", os });
		}
		expect(computerInstructions("linux", "zerotier")[6]).toEqual({ kind: "command", command: "mars-ram pair-zt", note: "qr", addressHint: true });
		expect(computerInstructions("macos", "zerotier")[5]).toEqual({ kind: "command", command: "mars-ram pair-zt", note: "qr", addressHint: true });
		expect(computerInstructions("windows", "zerotier")[5]).toEqual({ kind: "command", command: "mars-ram pair-zt", note: "admin", addressHint: true });
	});

	it("keeps the Tailscale instructions by default, without the firewall line: Tailscale lets itself through", () => {
		expect(computerInstructions("linux", "tailscale")).toEqual(computerInstructions("linux"));
		for (const os of ["linux", "macos", "windows"] as const) expect(computerInstructions(os, "tailscale").map((step) => step.kind)).not.toContain("firewall");
	});
});

describe("computer causes in «revisá la computadora»", () => {
	it("lists the firewall right after the my.zerotier.com authorization, on Linux only", () => {
		expect(computerCauses("zerotier", "linux")).toEqual(["zerotier_network", "zerotier_authorized", "firewall", "ssh", "awake"]);
		expect(computerCauses("zerotier", "macos")).toEqual(["zerotier_network", "zerotier_authorized", "ssh", "awake"]);
		expect(computerCauses("zerotier", "windows")).toEqual(["zerotier_network", "zerotier_authorized", "ssh", "awake"]);
	});
	it("keeps the Tailscale causes unchanged", () => {
		for (const os of ["linux", "macos", "windows"] as const) expect(computerCauses("tailscale", os)).toEqual(["account", "ssh", "awake"]);
	});
});
