import { describe, expect, it } from "vitest";
import { createDoctorAdapter, type DoctorIO } from "../../src/adapters/doctor.ts";
import { diagnose } from "../../src/core/doctor.ts";
import { readTailscaleIp } from "../../src/adapters/tailscale.ts";

function boundary(files: Record<string, string> = {}, outputs: Record<string, string> = {}) {
	const calls: [string, string[]][] = [];
	const reads: string[] = [];
	const io: DoctorIO = {
		run(command, args) {
			calls.push([command, args]);
			const value = outputs[[command, ...args].join(" ")];
			if (value === undefined) throw Error("unavailable");
			return value;
		},
		read(path) { reads.push(path); return files[path]; },
		list(path) { return Object.keys(files).filter((name) => name.startsWith(`${path}/`) && !name.slice(path.length + 1).includes("/")).map((name) => name.slice(path.length + 1)); },
		mode: () => 0o700,
	};
	return { io, calls, reads };
}

describe("doctor read-only adapters", () => {
 it('reports ownerless locks, trash and unverifiable identities with exact repair paths', async () => {
  const target = '/fixture/.ssh/authorized_keys';
  const b = boundary({ [`${target}.lock.recovery/owner.json`]: JSON.stringify({ id: 'live', pid: process.pid, startTime: null, createdAt: 123 }) });
  b.io.list = path => path === '/fixture/.ssh' ? ['authorized_keys.lock', 'authorized_keys.lock.recovery', 'authorized_keys.lock.abc.trash'] : [];
  const report = await diagnose({ ...createDoctorAdapter({ home: '/fixture', platform: 'linux', io: b.io }), spanish: false });
  for (const path of [target + '.lock', target + '.lock.recovery', target + '.lock.abc.trash']) {
   expect(report.results).toContainEqual(expect.objectContaining({ status: 'warning', finding: expect.stringContaining(path), fix: expect.stringContaining(`delete ${path}`) }));
  }
  expect(report.results).toContainEqual(expect.objectContaining({ finding: expect.stringMatching(new RegExp(`pid ${process.pid}.*123.*identity could not be verified`)) }));
 });
 it.each(['linux', 'win32'] as const)('reports stale main and recovery locks read-only on %s with exact manual fixes', async platform => {
  const home = platform === 'linux' ? '/fixture' : 'C:\\fixture';
  const programData = process.env.ProgramData ?? 'C:\\ProgramData';
  const target = platform === 'linux' ? '/fixture/.ssh/authorized_keys' : `${programData}\\ssh\\administrators_authorized_keys`;
  const stale = JSON.stringify({ id: 'dead', pid: 2147483647, startTime: null, createdAt: 0 });
  const files = { [`${target}.lock/owner.json`]: stale, [`${target}.lock.recovery/owner.json`]: stale };
  const before = { ...files };
  const b = boundary(files, { 'whoami /groups /fo csv': '"S-1-5-32-544"' });
  const report = await diagnose({ ...createDoctorAdapter({ home, platform, io: b.io }), spanish: false });
  for (const path of [target + '.lock', target + '.lock.recovery']) {
   expect(report.results).toContainEqual(expect.objectContaining({ status: 'warning', finding: expect.stringContaining(path), fix: expect.stringContaining(`delete ${path} and try again`) }));
  }
  expect(files).toEqual(before);
 });
	it("reuses the resolved Windows Pi Node entry, never pi.cmd or a shell", async () => {
		const b = boundary({}, { 'node.exe C:\\pi\\cli.js --version': '1.2.0' });
		const adapter = createDoctorAdapter({ platform: "win32", io: b.io, pi: () => ({ command: "node.exe", prefix: ["C:\\pi\\cli.js"] }) });
		expect(await adapter.piVersion()).toBe("1.2.0");
		expect(b.calls).toEqual([["node.exe", ["C:\\pi\\cli.js", "--version"]]]);
	});
	it.each([['no', 'problem', 'disabled', 1], ['yes', 'ok', 'allowed', 0]] as const)("R3 retains forwarding %s when paired keys are unreadable", async (allow, status, label, code) => {
		const b = boundary({}, { 'sshd -T': `allowtcpforwarding ${allow}` });
		b.io.read = () => { throw Error("access denied"); };
		const adapter = createDoctorAdapter({ home: "/fixture", platform: "linux", io: b.io });
		const report = await diagnose({ ...adapter, spanish: false, piVersion: async () => "1.2.0", installation: async () => ({ present: false, current: false, homes: [] }), tailscale: async () => "100.64.0.1" });
		expect(report.results).toContainEqual(expect.objectContaining({ status, finding: `SSH TCP forwarding: ${label}.` }));
		expect(report.results).toContainEqual(expect.objectContaining({ status: "warning", finding: expect.stringMatching(/keys.*unreadable/i) }));
		expect(report.code).toBe(code);
	});
	it.each([['ESTADO : 4  RUNNING', 'ok', 0], ['ESTADO : 1  STOPPED', 'problem', 1]] as const)("R3 diagnoses localized service %s", async (output, status, code) => {
		const b = boundary({}, { 'sc.exe query sshd': output });
		const adapter = createDoctorAdapter({ home: "C:\\fixture", platform: "win32", io: b.io });
		const report = await diagnose({ ...adapter, spanish: false, piVersion: async () => "1.2.0", installation: async () => ({ present: false, current: false, homes: [] }), acl: async () => ({ safe: true, administratorOwner: false }), tailscale: async () => "100.64.0.1", forwarding: async () => ({ allowed: true, keysAllowed: true }) });
		expect(report.results).toContainEqual(expect.objectContaining({ status, finding: expect.stringMatching(/^OpenSSH Server/) }));
		expect(report.code).toBe(code);
	});
	it("prefers effective sshd -T and reads paired keys without modifying them", async () => {
		const b = boundary({ '/home/test/.ssh/authorized_keys': 'restrict ssh-ed25519 AAA mars-ram:phone' }, { 'sshd -T': 'allowtcpforwarding no' });
		const adapter = createDoctorAdapter({ home: "/home/test", platform: "linux", io: b.io });
		expect(await adapter.forwarding()).toEqual({ allowed: false, keysAllowed: false });
		expect(b.reads).toEqual(["/home/test/.ssh/authorized_keys"]);
	});
	it("reports forwarding allowed when sshd_config and an empty sshd_config.d never set it (sshd's default)", async () => {
		const b = boundary({ '/etc/ssh/sshd_config': 'Include /etc/ssh/sshd_config.d/*.conf\nKbdInteractiveAuthentication no\nUsePAM yes' });
		expect((await createDoctorAdapter({ home: "/home/test", platform: "linux", io: b.io }).forwarding()).allowed).toBe(true);
	});
	it("falls back to sshd config and drop-ins if sshd -T is unavailable", async () => {
		const b = boundary({ '/etc/ssh/sshd_config': 'Include /etc/ssh/sshd_config.d/*.conf', '/etc/ssh/sshd_config.d/20-no.conf': 'AllowTcpForwarding remote' });
		const adapter = createDoctorAdapter({ home: "/home/test", platform: "linux", io: b.io });
		expect(await adapter.forwarding()).toEqual({ allowed: false, keysAllowed: true });
		expect(b.calls).toEqual([["sshd", ["-T"]]]);
	});
	it("F4 warns when config is missing, unreadable or has unknown includes", async () => {
		const b = boundary();
		expect((await createDoctorAdapter({ platform: "linux", io: b.io }).forwarding()).allowed).toBeUndefined();
		b.io.read = (path) => { if (path.endsWith("sshd_config")) throw Error("access denied"); return undefined; };
		expect((await createDoctorAdapter({ platform: "linux", io: b.io }).forwarding()).allowed).toBeUndefined();
		const unknown = boundary({ '/etc/ssh/sshd_config': 'Include /custom/*.conf' });
		expect((await createDoctorAdapter({ platform: "linux", io: unknown.io }).forwarding()).allowed).toBeUndefined();
	});
	it("F4 keeps effective output authoritative even if the fallback is restrictive", async () => {
		const b = boundary({ '/etc/ssh/sshd_config': 'AllowTcpForwarding no\nMatch User x' }, { 'sshd -T': 'allowtcpforwarding yes\ndisableforwarding no' });
		expect((await createDoctorAdapter({ home: "/home/test", platform: "linux", io: b.io }).forwarding()).allowed).toBe(true);
		expect(b.reads).not.toContain('/etc/ssh/sshd_config');
	});
	it("F4 expands supported includes in place and respects the first setting", async () => {
		const b = boundary({ '/etc/ssh/sshd_config': 'Include /etc/ssh/sshd_config.d/*.conf\nAllowTcpForwarding yes', '/etc/ssh/sshd_config.d/20-no.conf': 'AllowTcpForwarding no' });
		expect((await createDoctorAdapter({ platform: "linux", io: b.io }).forwarding()).allowed).toBe(false);
		b.io.read = (path) => path.endsWith('sshd_config') ? 'Include /etc/ssh/sshd_config.d/*.conf\nAllowTcpForwarding yes' : undefined;
		expect((await createDoctorAdapter({ platform: "linux", io: b.io }).forwarding()).allowed).toBeUndefined();
	});
	it("reads native Windows SSH configuration and the administrator pairing target", async () => {
		const programData = process.env.ProgramData ?? "C:\\ProgramData";
		const b = boundary({ [`${programData}\\ssh\\sshd_config`]: 'AllowTcpForwarding no', [`${programData}\\ssh\\administrators_authorized_keys`]: 'restrict ssh-ed25519 AAA mars-ram:phone' }, { 'whoami /groups /fo csv': '"S-1-5-32-544"' });
		expect(await createDoctorAdapter({ home: "C:\\Users\\test", platform: "win32", io: b.io }).forwarding()).toEqual({ allowed: false, keysAllowed: false });
		expect(b.calls).toEqual([["whoami", ["/groups", "/fo", "csv"]]]);
	});
	describe.each([false, true])("Windows terminal shell compatibility (Spanish: %s)", (spanish) => {
		it.each([
			[undefined, "ok"],
			["", "ok"],
			['DefaultShell REG_SZ C:\\Windows\\System32\\cmd.exe', "ok"],
			['DefaultShell REG_EXPAND_SZ "%SystemRoot%\\System32\\CMD.EXE"', "ok"],
			['DefaultShell REG_SZ C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', "powershell"],
			['DefaultShell REG_SZ "C:\\Program Files\\PowerShell\\7\\pwsh.exe"', "powershell"],
			['DefaultShell REG_SZ pwsh.exe', "powershell"],
			['DefaultShell REG_SZ C:\\tools\\bash.exe', "other"],
			['DefaultShell REG_SZ C:\\tools\\nu.exe', "other"],
			['DefaultShell REG_SZ C:\\tools\\not-pwsh.exe', "other"],
		] as const)("diagnoses %s as %s without repairing it", async (output, expected) => {
			const outputs: Record<string, string> = { 'sc.exe query sshd': 'STATE : 4 RUNNING' };
			if (output !== undefined) outputs['reg.exe query HKLM\\SOFTWARE\\OpenSSH /v DefaultShell'] = output;
			const b = boundary({}, outputs);
			const adapter = createDoctorAdapter({ home: "C:\\fixture", platform: "win32", io: b.io });
			const report = await diagnose({ ...adapter, spanish, keyLocks: async () => [], piVersion: async () => "1.2.0", installation: async () => ({ present: false, current: false, homes: [] }), acl: async () => ({ safe: true, administratorOwner: false }), tailscale: async () => "100.64.0.1", forwarding: async () => ({ allowed: true, keysAllowed: true }) });
			const shell = report.results.find((r) => r.finding.startsWith(spanish ? "Shell SSH predeterminado:" : "SSH default shell:"));
			expect(report.code).toBe(0);
			if (expected === "ok") {
				expect(shell).toEqual({ status: "ok", finding: spanish ? "Shell SSH predeterminado: cmd (explícito o por defecto); es el que necesita la terminal del teléfono." : "SSH default shell: cmd (explicit or default); required by the phone terminal." });
			} else {
				expect(shell).toEqual({
					status: "warning",
					finding: expected === "powershell"
						? (spanish ? "Shell SSH predeterminado: PowerShell; la terminal del teléfono no abrirá." : "SSH default shell: PowerShell; the phone terminal will not open.")
						: (spanish ? "Shell SSH predeterminado: otro shell; no probado con la terminal del teléfono." : "SSH default shell: other shell; untested with the phone terminal."),
					fix: `${spanish ? "Ejecutá en PowerShell como administrador:" : "Run in administrator PowerShell:"} Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\OpenSSH' -Name DefaultShell`,
				});
			}
			expect(b.calls).toEqual([["sc.exe", ["query", "sshd"]], ["reg.exe", ["query", "HKLM\\SOFTWARE\\OpenSSH", "/v", "DefaultShell"]]]);
		});
	});
	it("queries Windows services and registry values, never starts or edits them", async () => {
		const b = boundary({}, { 'sc.exe query sshd': 'STATE : 4 RUNNING', 'reg.exe query HKLM\\SOFTWARE\\OpenSSH /v DefaultShell': 'DefaultShell REG_SZ C:\\Windows\\powershell.exe' });
		expect(await createDoctorAdapter({ platform: "win32", io: b.io }).windows()).toEqual({ service: true, shell: "powershell" });
		expect(b.calls.map(([command]) => command)).toEqual(["sc.exe", "reg.exe"]);
		expect(await createDoctorAdapter({ platform: "win32", io: boundary().io }).windows()).toEqual({ service: false, shell: "cmd" });
	});
	it("reports malformed registry entries without returning their token contents", async () => {
		const b = boundary({ '/home/test/.mars-ram/bridges/bad.json': '{"token":"never-print"}', '/home/test/.mars-ram/bridges/token.tmp': 'never-print' });
		const adapter = createDoctorAdapter({ home: "/home/test", platform: "linux", io: b.io });
		expect((await adapter.registry()).entries).toEqual([{ name: "bad.json" }]);
		expect(JSON.stringify(await adapter.registry())).not.toContain("never-print");
		expect(b.reads).toHaveLength(1);
	});
	it("reads ACL SIDs and owner with an encoded read-only script, treating paths only as data", async () => {
		const b = boundary();
		const home = "C:\\Users\\test'; Write-Output unsafe";
		b.io.mode = () => { throw Object.assign(Error("missing"), { code: "ENOENT" }); };
		b.io.run = (command, args) => {
			b.calls.push([command, args]);
			expect(command).toBe("powershell.exe");
			expect(args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
			const script = Buffer.from(args[3]!, "base64").toString("utf16le");
			expect(script).toContain("Get-Acl -LiteralPath");
			expect(script).not.toContain(home);
			expect(script).not.toMatch(/Set-Acl|New-Item|Remove-Item/);
			return JSON.stringify({ owner: "S-1-5-32-544", user: "S-1-5-21-123", grants: ["S-1-5-18", "S-1-5-21-123"] });
		};
		expect(await createDoctorAdapter({ home, platform: "win32", io: b.io }).acl()).toEqual({ safe: true, administratorOwner: true });
		expect(b.calls).toHaveLength(1);
	});
	it("runs only tailscale ip -4 and rejects invalid or missing addresses", () => {
		const b = boundary({}, { 'tailscale ip -4': '100.64.0.12\n' });
		expect(readTailscaleIp(b.io.run)).toBe("100.64.0.12");
		expect(b.calls).toEqual([["tailscale", ["ip", "-4"]]]);
		for (const output of ["", "100.64.999.1", "100.64.0.1\n100.64.0.2", "192.168.1.1"]) expect(() => readTailscaleIp(() => output)).toThrow();
	});
});
