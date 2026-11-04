import { describe, expect, it } from "vitest";
import { checkPi, checkInstallation, checkRegistry, checkPermissions, checkLinkServer, checkTailscale, checkForwarding, checkWindows, diagnose, type DoctorPorts } from "../../src/core/doctor.ts";
import { parseForwarding, pairingKeysAllowForwarding, parseWindowsAcl, parseDefaultShell, parseSshService } from "../../src/adapters/doctor.ts";
import { parseArguments } from "../../src/arguments.ts";
import { doctorCommand } from "../../src/doctor-command.ts";

function fake(overrides: Partial<DoctorPorts> = {}): DoctorPorts {
	return {
		platform: "linux", spanish: false, herdr: async () => true,
  cli: async () => ({ resolved: true, current: true, localBin: true }),
  linkServer: async () => ({ present: true, current: true, configured: true, validLinks: 0, listener: false }),
		piVersion: async () => "pi 1.2.0", installation: async () => ({ present: true, current: true, homes: [{ path: "/pi", registered: true }] }),
		registry: async () => ({ exists: true, entries: [{ name: "live.json", pid: 10 }], directoryMode: 0o700, modes: [0o600] }),
		alive: () => true, acl: async () => ({ safe: true, administratorOwner: false }),
  keyLocks: async () => [],
		tailscale: async () => "100.64.0.1", forwarding: async () => ({ allowed: true, keysAllowed: true }),
		windows: async () => ({ service: true, shell: "cmd" }), ...overrides,
	};
}
const statuses = (results: { status: string }[]) => results.map((r) => r.status);

describe("read-only doctor policy with fake ports", () => {
	it("accepts doctor without options", () => {
		expect(parseArguments(["doctor"])).toEqual({ ok: true, command: "doctor" });
		expect(parseArguments(["doctor", "--fix"])).toEqual({ ok: false });
	});
	it("reports healthy installation and an idle on-demand link server", async () => {
		const report = await diagnose(fake());
		expect(report.code).toBe(0);
		expect(report.results.every((r) => r.status === "ok")).toBe(true);
		expect((await checkLinkServer(fake())).map(r => r.finding).join(" ")).toContain("0 valid links");
	});
 it("reports missing/outdated link copies, bad config and identity-confirmed serving without repairs", async () => {
  const missing = await checkLinkServer(fake({ linkServer: async () => ({ present: false, current: false, configured: false, validLinks: 2, listener: false }) }));
  expect(missing.filter(r => r.status === "warning")).toHaveLength(3);
  expect(missing.every(r => r.fix)).toBe(true);
  const live = await checkLinkServer(fake({ linkServer: async () => ({ present: true, current: true, configured: true, validLinks: 2, listener: true }) }));
  expect(live.at(-1)?.finding).toMatch(/identity confirmed/);
  expect(live.at(-1)?.status).toBe("ok");
 });
	it.each([["1.1.9", "warning"], ["1.2.0", "ok"], ["2.0.0", "ok"], ["1.2.0-beta.1", "warning"], ["unknown", "warning"]])("checks Pi version %s", async (version, status) => {
		expect(statuses(await checkPi(fake({ piVersion: async () => version })))).toEqual([status]);
	});
	it("exits zero for warnings and emits one line per finding without terminal control characters", async () => {
		const lines: string[] = [];
		const ports = fake({ piVersion: async () => "1.1.0", installation: async () => ({ present: true, current: false, homes: [{ path: "bad\n\u001b[31mhome", registered: false }] }) });
		expect(await doctorCommand(ports, (line) => lines.push(line))).toBe(0);
		expect(lines.some((line) => line.startsWith("warning:"))).toBe(true);
		expect(lines.every((line) => !/[\r\n\u001b]/.test(line))).toBe(true);
	});
	it("reports missing Pi and a failing exit code with actionable fixes", async () => {
		const report = await diagnose(fake({ piVersion: async () => { throw Error("missing"); } }));
		expect(report.code).toBe(1);
		for (const result of report.results.filter((r) => r.status !== "ok")) expect(result.fix).toBeTruthy();
	});
	it("checks the install record, every home, and source freshness", async () => {
		expect(statuses(await checkInstallation(fake({ installation: async () => ({ present: false, current: false, homes: [] }) })))).toContain("warning");
		const results = await checkInstallation(fake({ installation: async () => ({ present: true, current: false, homes: [{ path: "plain", registered: true }, { path: "gentle", registered: false }] }) }));
		expect(results.find((r) => r.finding.includes("gentle"))?.fix).toContain("mars-ram install");
		expect(results.find((r) => r.finding.includes("outdated"))?.status).toBe("warning");
	});
	it("counts live entries, reports stale and malformed ones without deleting them", async () => {
		const ports = fake({ registry: async () => ({ exists: true, directoryMode: 0o700, modes: [], entries: [{ name: "a", pid: 1 }, { name: "b", pid: 2 }, { name: "c" }] }), alive: (pid) => pid === 1 });
		const results = await checkRegistry(ports);
		expect(results[0]?.finding).toContain("1");
		expect(results.filter((r) => r.status === "warning")).toHaveLength(2);
		expect(statuses(await checkRegistry(fake({ registry: async () => ({ exists: false, entries: [], modes: [] }) })))).toEqual(["warning"]);
	});
	it.each([[0o755, [0o600]], [0o700, [0o644]], [0o700, [0o600, undefined]]])("rejects unsafe or unreadable Linux registry modes", async (directoryMode, modes) => {
		expect(statuses(await checkPermissions(fake({ registry: async () => ({ exists: true, entries: [], directoryMode, modes }) })))).toContain("problem");
	});
	it("checks Windows ACL and warns about the L9 administrator owner", async () => {
		expect(statuses(await checkPermissions(fake({ platform: "win32", acl: async () => ({ safe: false, administratorOwner: true }) })))).toEqual(["problem", "warning"]);
		expect(statuses(await checkPermissions(fake({ platform: "win32" })))).toEqual(["ok"]);
	});
	it("reports unavailable Tailscale", async () => {
		expect(statuses(await checkTailscale(fake({ tailscale: async () => { throw Error("offline"); } })))).toEqual(["problem"]);
	});
	it("distinguishes sshd denial from restricted pairing keys", async () => {
		expect(statuses(await checkForwarding(fake({ forwarding: async () => ({ allowed: false, keysAllowed: false }) })))).toEqual(["problem", "warning"]);
	});
	it("F4 unknown SSH forwarding is a warning with config advice and exit zero", async () => {
		const report = await diagnose(fake({ forwarding: async () => ({ allowed: undefined, keysAllowed: true }) }));
		expect(report.code).toBe(0);
		expect(report.results).toContainEqual(expect.objectContaining({ status: "warning", finding: expect.stringMatching(/could not determine/i), fix: expect.stringContaining("sshd_config") }));
	});
	it("only checks Windows service and shell on Windows", async () => {
		expect(await checkWindows(fake())).toEqual([]);
		expect(statuses(await checkWindows(fake({ platform: "win32", windows: async () => ({ service: false, shell: "other" }) })))).toEqual(["problem", "warning"]);
	});
	it("turns unreadable check data into advice and continues", async () => {
		const report = await diagnose(fake({ registry: async () => { throw Error("denied"); } }));
		expect(report.code).toBe(1);
		expect(report.results.some((r) => r.finding.includes("Tailscale"))).toBe(true);
	});
	it("uses Spanish findings and fixes when selected", async () => {
		const report = await diagnose(fake({ spanish: true, piVersion: async () => { throw Error(); } }));
		expect(report.results[0]?.fix).toContain("Instalá");
		expect(report.results.some((r) => r.finding.includes("instalado"))).toBe(true);
	});
});

describe("platform parsing", () => {
	it.each([["", true], ["Port 22\nPasswordAuthentication no", true], ["AllowTcpForwarding garbage", undefined], ["DisableForwarding garbage\nAllowTcpForwarding yes", undefined], ["Include=/unknown\nAllowTcpForwarding yes", undefined], ["# AllowTcpForwarding no", true], ["AllowTcpForwarding no", false], ["allowtcpforwarding remote", false], ["AllowTcpForwarding local", true], ["AllowTcpForwarding yes\nMatch User x\n AllowTcpForwarding no", undefined], ["DisableForwarding yes", false], ["AllowTcpForwarding=no", false], ["DisableForwarding = yes", false]])("parses sshd forwarding conservatively: %s", (config, expected) => {
		expect(parseForwarding(config)).toBe(expected);
	});
	it("recognizes only pairing comments, respects explicit denial and quoted options", () => {
		expect(pairingKeysAllowForwarding('restrict,port-forwarding,pty ssh-ed25519 AAA mars-ram:phone')).toBe(true);
		expect(pairingKeysAllowForwarding('ssh-ed25519 AAA mars-ram:phone')).toBe(true);
		expect(pairingKeysAllowForwarding('restrict ssh-ed25519 AAA mars-ram:phone')).toBe(false);
		expect(pairingKeysAllowForwarding('no-port-forwarding,port-forwarding ssh-ed25519 AAA mars-ram:phone')).toBe(false);
		expect(pairingKeysAllowForwarding('command="echo mars-ram:fake" ssh-ed25519 AAA unrelated')).toBe(true);
		expect(pairingKeysAllowForwarding('# restrict ssh-ed25519 AAA mars-ram:phone')).toBe(true);
	});
	it("uses SIDs instead of localized ACL names and rejects unknown owners and grants", () => {
		const acl = { owner: "S-1-5-32-544", user: "S-1-5-21-123", grants: ["S-1-5-18", "S-1-5-32-544", "S-1-5-21-123"] };
		expect(parseWindowsAcl(acl)).toEqual({ safe: true, administratorOwner: true });
		expect(parseWindowsAcl({ ...acl, grants: [...acl.grants, "S-1-1-0"] }).safe).toBe(false);
		expect(parseWindowsAcl({ ...acl, owner: "S-1-1-0" }).safe).toBe(false);
	});
	it("recognizes a running sshd and classifies actual shell executables", () => {
		expect(parseSshService("STATE : 4 RUNNING")).toBe(true);
		expect(parseSshService("STATE : 1 STOPPED")).toBe(false);
		expect(parseDefaultShell('DefaultShell REG_SZ C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')).toBe("powershell");
		expect(parseDefaultShell('DefaultShell REG_SZ C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe("powershell");
		expect(parseDefaultShell('DefaultShell REG_SZ C:\\cmd.exe')).toBe("cmd");
		expect(parseDefaultShell('')).toBe("cmd");
		expect(parseDefaultShell('DefaultShell REG_SZ C:\\tools\\nu.exe')).toBe("other");
		expect(parseDefaultShell('unrecognized output')).toBe("other");
	});
});
