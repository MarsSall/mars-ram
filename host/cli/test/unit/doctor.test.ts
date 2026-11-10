import { describe, expect, it } from "vitest";
import { checkPi, checkUploads, checkInstallation, checkRegistry, checkPermissions, checkLinkServer, checkTailscale, checkZeroTier, checkFirewall, checkForwarding, checkWindows, diagnose, type DoctorPorts } from "../../src/core/doctor.ts";
import { parseForwarding, pairingKeysAllowForwarding, parseWindowsAcl, parseDefaultShell, parseSshService } from "../../src/adapters/doctor.ts";
import { parseArguments } from "../../src/arguments.ts";
import { doctorCommand } from "../../src/doctor-command.ts";

function fake(overrides: Partial<DoctorPorts> = {}): DoctorPorts {
	return {
		platform: "linux", spanish: false, herdr: async () => true,
  cli: async () => ({ resolved: true, command: "/home/alex/.local/bin/mars-ram", current: true, localBin: true }),
  linkServer: async () => ({ present: true, current: true, configured: true, validLinks: 0, listener: false }),
		piVersion: async () => "pi 1.2.0", installation: async () => ({ present: true, current: true, homes: [{ path: "/pi", registered: true }] }),
		registry: async () => ({ exists: true, entries: [{ name: "live.json", pid: 10 }], directoryMode: 0o700, modes: [0o600] }),
		alive: () => true, acl: async () => ({ safe: true, administratorOwner: false }),
  keyLocks: async () => [],
		tailscale: async () => "100.64.0.1", zerotier: async () => [], zeroTierInterfaces: async () => [], firewall: async () => ({ ufw: "inactive", firewalld: "inactive" }), forwarding: async () => ({ allowed: true, keysAllowed: true }),
		windows: async () => ({ service: true, shell: "cmd" }),
		uploads: async () => ({ state: { ok: true, path: "/tmp/mars-ram-1000/uploads" }, legacy: false }), ...overrides,
	};
}
const statuses = (results: { status: string }[]) => results.map((r) => r.status);

describe("doctor attachments folder", () => {
	const path = "/tmp/mars-ram-1000/uploads";
	const lines = async (uploads: Awaited<ReturnType<DoctorPorts["uploads"]>>, spanish = false) => {
		const printed: string[] = [];
		await doctorCommand(fake({ spanish, uploads: async () => uploads }), (line) => printed.push(line));
		return printed.filter((line) => /ttachments|adjuntos/.test(line));
	};
	it("reports the private folder", async () => {
		expect(await lines({ state: { ok: true, path }, legacy: false })).toEqual([`ok: Attachments folder: ${path} (private).`]);
		expect(await lines({ state: { ok: true, path }, legacy: false }, true)).toEqual([`ok: Carpeta de adjuntos: ${path} (privada).`]);
	});
	it("reports a folder not created yet without creating it", async () => {
		expect(await lines({ state: { ok: false, error: "missing", path }, legacy: false })).toEqual([`ok: Attachments folder: ${path} (created with the first attachment).`]);
	});
	it("reports an unsafe folder as a problem with its reason and fix", async () => {
		const unsafe = { ok: false, error: "unsafe_folder", path, component: "/tmp/mars-ram-1000", reason: "owner", message: "The attachments folder /tmp/mars-ram-1000 belongs to another user. Remove it and try again." } as const;
		expect(await lines({ state: unsafe, legacy: false })).toEqual(["problem: Attachments folder /tmp/mars-ram-1000 belongs to another user; attachments will fail. Remove /tmp/mars-ram-1000 and try again."]);
		// The status label follows the process locale; the finding follows the port.
		expect((await lines({ state: unsafe, legacy: false }, true)).map((line) => line.replace(/^\w+: /, ""))).toEqual(["La carpeta de adjuntos /tmp/mars-ram-1000 pertenece a otro usuario; los adjuntos van a fallar. Eliminá /tmp/mars-ram-1000 y volvé a intentar."]);
		expect((await diagnose(fake({ uploads: async () => ({ state: unsafe, legacy: false }) }))).code).toBe(1);
		for (const [reason, en] of [["link", "is a link"], ["not_folder", "is not a folder"], ["permissions", "can be opened by other users"]] as const) {
			expect((await checkUploads(fake({ uploads: async () => ({ state: { ...unsafe, reason }, legacy: false }) })))[0]?.finding).toContain(en);
		}
	});
	it("warns about an unavailable folder and a leftover legacy folder", async () => {
		expect(statuses(await checkUploads(fake({ uploads: async () => ({ state: { ok: false, error: "unavailable", path, message: "x (EACCES)." }, legacy: false }) })))).toEqual(["warning"]);
		expect(await lines({ state: { ok: true, path }, legacy: true })).toEqual([`ok: Attachments folder: ${path} (private).`, "warning: Old attachments folder ~/.mars-ram/uploads still exists; nothing reads it anymore. Run mars-ram install to remove it."]);
	});
});

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
	it("in package mode prints the mars-ram on PATH as information and warns only for a missing command or the old launcher", async () => {
		const printed = async (spanish: boolean, cli: Awaited<ReturnType<DoctorPorts["cli"]>>) => {
			const lines: string[] = [];
			expect(await doctorCommand(fake({ spanish, cli: async () => cli }), (line) => lines.push(line))).toBe(0);
			return lines;
		};
		const pnpm = "C:\\Users\\alex\\AppData\\Local\\pnpm\\mars-ram.CMD";
		for (const spanish of [false, true]) {
			expect(await printed(spanish, { resolved: false, command: pnpm, current: true, localBin: false, packageMode: true })).toContain(`ok: ${spanish ? "mars-ram en PATH" : "mars-ram on PATH"}: ${pnpm}`);
			const missing = (await printed(spanish, { resolved: false, current: true, localBin: false, packageMode: true })).join("\n");
			expect(missing).toContain(spanish ? ": mars-ram no está en PATH. Abrí una terminal nueva o revisá la instalación de pnpm/npm (pnpm setup)." : ": mars-ram is not on PATH. Open a new terminal or check the pnpm/npm install (pnpm setup).");
			const old = (await printed(spanish, { resolved: true, command: "/home/alex/.local/bin/mars-ram", current: true, localBin: false, packageMode: true })).join("\n");
			expect(old).toContain(spanish ? ": mars-ram en PATH es el lanzador anterior de mars-ram install; ejecutá mars-ram install de nuevo para retirarlo." : ": mars-ram on PATH is the old launcher from mars-ram install; run mars-ram install again to retire it.");
			for (const output of [missing, old]) expect(output).not.toMatch(/npm package|paquete de npm/);
		}
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
	it("without ZeroTier, reports unavailable Tailscale as a problem and shows no ZeroTier line", async () => {
		const report = await diagnose(fake({ tailscale: async () => { throw Error("offline"); } }));
		expect(report.code).toBe(1);
		expect(report.results.filter((r) => /Tailscale/.test(r.finding))).toEqual([{ status: "problem", finding: "Tailscale IPv4 unavailable.", fix: "Install Tailscale, sign in and connect; verify tailscale ip -4." }]);
		expect(report.results.some((r) => /ZeroTier/.test(r.finding))).toBe(false);
	});
	it("with ZeroTier connected, reports missing Tailscale as a warning about private links and Siempre atento", async () => {
		const ports = fake({ tailscale: async () => { throw Error("offline"); }, zerotier: async () => ["10.147.17.5"] });
		expect(await checkTailscale(ports)).toEqual([{
			status: "warning",
			finding: "Tailscale IPv4 unavailable; this computer pairs over ZeroTier, but private links and Siempre atento need Tailscale.",
			fix: "To use them, install Tailscale, sign in and connect; verify tailscale ip -4.",
		}]);
		const report = await diagnose(ports);
		expect(report.code).toBe(0);
		expect(report.results).toContainEqual({ status: "ok", finding: "ZeroTier: 10.147.17.5" });
	});
	it("shows ZeroTier next to a working Tailscale", async () => {
		const report = await diagnose(fake({ zerotier: async () => ["10.147.17.5", "10.144.0.2"] }));
		expect(report.code).toBe(0);
		expect(report.results).toContainEqual({ status: "ok", finding: "Tailscale: 100.64.0.1" });
		expect(report.results).toContainEqual({ status: "ok", finding: "ZeroTier: 10.147.17.5, 10.144.0.2" });
	});
	it("treats unreadable network interfaces as no ZeroTier", async () => {
		const ports = fake({ tailscale: async () => { throw Error("offline"); }, zerotier: async () => { throw Error("uv_interface_addresses"); } });
		expect(statuses(await checkTailscale(ports))).toEqual(["problem"]);
		expect(await checkZeroTier(ports)).toEqual([]);
	});
	it("explains the ZeroTier warning in Spanish", async () => {
		const [finding] = await checkTailscale(fake({ spanish: true, tailscale: async () => { throw Error("offline"); }, zerotier: async () => ["10.147.17.5"] }));
		expect(finding).toEqual({
			status: "warning",
			finding: "IPv4 de Tailscale no disponible; esta computadora se empareja por ZeroTier, pero los enlaces privados y Siempre atento necesitan Tailscale.",
			fix: "Para usarlos, instalá Tailscale, iniciá sesión y conectalo; verificá tailscale ip -4.",
		});
	});
	it("warns that an active ufw may block ZeroTier and names the exact interface fix", async () => {
		const ports = fake({ zerotier: async () => ["10.147.20.49"], zeroTierInterfaces: async () => ["ztexample0"], firewall: async () => ({ ufw: "active", firewalld: "inactive" }) });
		expect(await checkFirewall(ports)).toEqual([{
			status: "warning",
			finding: "Firewall (ufw) is on; it may block pairing and SSH over ZeroTier (Tailscale is not affected).",
			fix: "If the phone cannot connect over ZeroTier, run: sudo ufw allow in on ztexample0 comment 'ZeroTier'",
		}]);
		const report = await diagnose(ports);
		expect(report.code).toBe(0);
		const lines: string[] = [];
		await doctorCommand(ports, (line) => lines.push(line));
		expect(lines).toContain("warning: Firewall (ufw) is on; it may block pairing and SSH over ZeroTier (Tailscale is not affected). If the phone cannot connect over ZeroTier, run: sudo ufw allow in on ztexample0 comment 'ZeroTier'");
	});
	it("warns about firewalld in Spanish with its fix", async () => {
		const ports = fake({ spanish: true, zerotier: async () => ["10.147.20.49"], zeroTierInterfaces: async () => ["ztexample0"], firewall: async () => ({ ufw: "inactive", firewalld: "active" }) });
		expect(await checkFirewall(ports)).toEqual([{
			status: "warning",
			finding: "Firewall (firewalld) activo; puede bloquear el emparejamiento y SSH por ZeroTier (Tailscale no se ve afectado).",
			fix: "Si el teléfono no conecta por ZeroTier, ejecutá: sudo firewall-cmd --permanent --zone=trusted --add-interface=ztexample0 && sudo firewall-cmd --reload",
		}]);
	});
	it("says nothing about the firewall without ZeroTier, or with no active firewall", async () => {
		const firewall = { firewall: async () => ({ ufw: "active" as const, firewalld: "active" as const }) };
		const noZeroTier = fake(firewall);
		expect(await checkFirewall(noZeroTier)).toEqual([]);
		expect((await diagnose(noZeroTier)).results.some((r) => /firewall/i.test(r.finding))).toBe(false);
		const ports = (state: { ufw: "active" | "inactive" | "unknown"; firewalld: "active" | "inactive" | "unknown" }) => fake({ zerotier: async () => ["10.147.20.49"], zeroTierInterfaces: async () => ["ztexample0"], firewall: async () => state });
		expect(await checkFirewall(ports({ ufw: "inactive", firewalld: "inactive" }))).toEqual([]);
		expect(await checkFirewall(ports({ ufw: "unknown", firewalld: "unknown" }))).toEqual([]);
		expect(await checkFirewall(fake({ zerotier: async () => ["10.147.20.49"], zeroTierInterfaces: async () => ["ztexample0"], firewall: async () => { throw Error("no systemctl"); } }))).toEqual([]);
	});
	it("gives one fix per ZeroTier interface", async () => {
		const ports = fake({ zerotier: async () => ["10.147.20.49", "10.144.0.2"], zeroTierInterfaces: async () => ["ztexample0", "zt1"], firewall: async () => ({ ufw: "active", firewalld: "inactive" }) });
		expect((await checkFirewall(ports)).map((r) => r.fix)).toEqual(["If the phone cannot connect over ZeroTier, run: sudo ufw allow in on ztexample0 comment 'ZeroTier'; sudo ufw allow in on zt1 comment 'ZeroTier'"]);
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
