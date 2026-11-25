// Windows ACL check of ~/.mars-ram through a fake PowerShell: fixtures shaped like the owner's PC, where Codex's
// sandbox adds a read/execute Allow entry for CodexSandboxUsers to %USERPROFILE% and %USERPROFILE%\.mars-ram.
import { describe, expect, it } from "vitest";
import { createDoctorAdapter, type DoctorIO } from "../../src/adapters/doctor.ts";
import { checkPermissions, diagnose, type DoctorPorts } from "../../src/core/doctor.ts";

const USER = "S-1-5-21-1111-2222-3333-1001";
const SYSTEM = "S-1-5-18";
const ADMINS = "S-1-5-32-544";
const CODEX = "S-1-5-21-1111-2222-3333-1010";
const home = "C:\\Users\\mars";
const root = `${home}\\.mars-ram`;
// FileSystemRights as PowerShell reports them.
const FULL = 2032127;
const READ_EXECUTE = 1179817; // ReadAndExecute, Synchronize
const MODIFY = 1245631;
const GENERIC_READ_EXECUTE = 0xA0000000;

type Rule = { sid: string; rights: number; name?: string };
type Acl = { owner: string; protected: boolean; rules: Rule[]; dir?: boolean; reparse?: boolean };
type Item = Acl | { missing: true } | Record<string, unknown>;
const own = (rules: Rule[] = [], owner = USER, isProtected = true): Acl => ({ owner, protected: isProtected, rules: [{ sid: USER, rights: FULL }, { sid: SYSTEM, rights: FULL }, { sid: ADMINS, rights: FULL }, ...rules] });
const codexRead: Rule = { sid: CODEX, rights: READ_EXECUTE, name: "MARS\\CodexSandboxUsers" };
const exactMissing = (item: Item | undefined) => !!item && Object.keys(item).length === 1 && (item as { missing?: unknown }).missing === true;

/**
 * Folders (with their entries) as the file system lists them, and the ACL PowerShell reports per path. A folder is
 * reported as a directory (the root too); `present` paths still exist when re-checked although PowerShell said they
 * were missing. For lstat, `links` are symlinks/junctions and `files` are files. `touched` records every file-system
 * call (lstat, list, read), so a test can show nothing under a path was looked at.
 */
function windows(tree: Record<string, string[]>, acls: Record<string, Item>, options: { env?: NodeJS.ProcessEnv; present?: string[]; links?: string[]; files?: string[] } = {}) {
	const scripts: string[] = [];
	const asked: string[] = [];
	const listed: string[] = [];
	const touched: string[] = [];
	const reads: string[] = [];
	const missing = () => Object.assign(Error("missing"), { code: "ENOENT" });
	const io: DoctorIO = {
		run(command, args) {
			expect(command).toBe("powershell.exe");
			expect(args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
			const script = Buffer.from(args[3]!, "base64").toString("utf16le");
			scripts.push(script);
			const data = script.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)?.[1];
			const paths = JSON.parse(Buffer.from(data!, "base64").toString("utf8")) as string[];
			asked.push(...paths);
			// Names travel as UTF-8 base64, as the real script sends them; type and reparse flags as Get-Item gives them.
			const wire = (path: string, item: Item) => !("rules" in item) || !Array.isArray(item.rules) ? item : {
				dir: path in tree || path === root, reparse: false, ...item,
				rules: (item.rules as Rule[]).map(({ name, ...rule }) => name === undefined ? rule : { ...rule, name64: Buffer.from(name, "utf8").toString("base64") }),
			};
			return JSON.stringify({ user: USER, items: paths.map((path) => wire(path, acls[path] ?? { missing: true })) });
		},
		read: (path) => { touched.push(path); reads.push(path); return undefined; },
		list: (path) => { touched.push(path); listed.push(path); return tree[path] ?? []; },
		mode(path) {
			touched.push(path);
			if (options.links?.includes(path)) return -1;
			if (path in tree || path === root) return 0o700;
			if (options.present?.includes(path) || (path in acls && !exactMissing(acls[path]))) return 0o600;
			throw missing();
		},
		type(path) {
			touched.push(path);
			if (options.links?.includes(path)) return "link";
			if (options.files?.includes(path)) return "file";
			// A folder of the tree, the root, or any folder above a known path (C:\\Users, D:\\Mars Ram).
			if (path in tree || path === root || [...Object.keys(tree), ...Object.keys(acls)].some((known) => known.toLowerCase().startsWith(`${path.toLowerCase()}\\`))) return "directory";
			if (options.present?.includes(path) || (path in acls && !exactMissing(acls[path]))) return "file";
			throw missing();
		},
	};
	return { adapter: createDoctorAdapter({ home, platform: "win32", io, env: options.env ?? {} }), scripts, asked, listed, touched, reads };
}

/** The owner's PC: every secret folder protected and private, with the nested records their writers make. */
const LOCK = `${root}\\agents\\codex-abc.lock`;
const LINK = `${root}\\links\\AbCdEf123456`;
const secretTree: Record<string, string[]> = {
	[`${root}\\agents`]: ["codex-abc.lock"],
	[LOCK]: ["4242-133700000000000000-0123456789abcdef"],
	[`${root}\\bridges`]: ["pi-1.json"],
	[`${root}\\links`]: ["AbCdEf123456", "server.pid.json"],
	[LINK]: ["content", "link.json"],
	[`${root}\\notify`]: ["a".repeat(64) + ".json"],
};
const treeAcls = (tree: Record<string, string[]>): Record<string, Item> => Object.fromEntries(Object.entries(tree).flatMap(([dir, names]) => [[dir, own()], ...names.map((name) => [`${dir}\\${name}`, own()])]));
const secretAcls = () => treeAcls(secretTree);
const everyPath = (tree: Record<string, string[]>) => [...new Set(Object.entries(tree).flatMap(([dir, names]) => [dir, ...names.map((name) => `${dir}\\${name}`)]))];
const PROBLEM = {
	status: "problem",
	finding: "Mars-RAM ACL and owner: unsafe.",
	fix: "Use Windows Security advanced permissions to allow only your account, SYSTEM and Administrators, including ownership and child entries.",
};

const findings = async (adapter: DoctorPorts, spanish = false) => checkPermissions({ ...adapter, spanish });
const under = (paths: string[], folder: string) => paths.filter((path) => path.toLowerCase().startsWith(`${folder.toLowerCase()}\\`));
/** The full doctor with the real Windows registry and ACL observers; every other check is stubbed quiet. */
// Without Claude Code or Codex hook ports (their checks are skipped), as on a computer without those agents.
const fullDoctor = ({ claudeHooks: _claude, codexHooks: _codex, ...adapter }: DoctorPorts) => diagnose({
	...adapter, spanish: false,
	piVersion: async () => "pi 1.2.0", herdr: async () => true, herdrMachines: async () => [],
	cli: async () => ({ resolved: true, command: "C:\\Users\\mars\\.mars-ram\\bin\\mars-ram.cmd", current: true, localBin: true }),
	linkServer: async () => ({ present: true, current: true, configured: true, validLinks: 0, listener: false }),
	installation: async () => ({ present: true, current: true, homes: [{ path: "C:\\pi", registered: true }] }),
	keyLocks: async () => [],
	tailscale: async () => "100.64.0.1", zerotier: async () => [], zeroTierInterfaces: async () => [], firewall: async () => ({ ufw: "inactive", firewalld: "inactive" }),
	forwarding: async () => ({ allowed: true, keysAllowed: true }), windows: async () => ({ service: true, shell: "cmd" }),
	uploads: async () => ({ state: { ok: true, path: "C:\\Temp\\uploads" }, legacy: false }),
});
const REGISTRY_LINK = (path: string) => ({
	status: "problem",
	finding: `Bridge registry path is a link, reparse point or not a folder, so doctor did not read it: ${path}.`,
	fix: "If you did not make it on purpose, remove the link and start Pi again so the bridge recreates it with private permissions.",
});

describe("doctor Windows ACL of Mars-RAM", () => {
	it("warns, naming the principal, when Codex's sandbox can read the root and the secret folders stay private", async () => {
		const { adapter, asked } = windows(secretTree, { [root]: own([codexRead]), ...secretAcls() });
		expect(await adapter.acl()).toEqual({ safe: true, administratorOwner: false, readers: ["MARS\\CodexSandboxUsers"] });
		// Root and every secret folder with all its descendants; nothing else (code, logs, host.json stay readable).
		expect(asked.sort()).toEqual([root, ...everyPath(secretTree)].sort());
		expect(await findings(adapter)).toEqual([{
			status: "warning",
			finding: "Other accounts can read Mars-RAM's code and settings (MARS\\CodexSandboxUsers, added by Codex's sandbox). Tokens and links stay private.",
			fix: "Nothing to fix: Codex adds it again each time it starts. The agents, bridges, links and notify folders are checked separately and stay private.",
		}]);
		expect(await findings(adapter, true)).toEqual([{
			status: "warning",
			finding: "Otros usuarios pueden leer el código y la configuración de Mars-RAM (MARS\\CodexSandboxUsers, que agrega el sandbox de Codex). Los tokens y links siguen privados.",
			fix: "No hay que corregir nada: Codex lo vuelve a agregar cada vez que inicia. Las carpetas agents, bridges, links y notify se revisan aparte y siguen privadas.",
		}]);
	});
	it("treats generic read/execute rights as read-only and names any other reader with a generic fix", async () => {
		const { adapter } = windows(secretTree, { [root]: own([{ sid: "S-1-1-0", rights: GENERIC_READ_EXECUTE, name: "Everyone" }]), ...secretAcls() });
		expect(await adapter.acl()).toEqual({ safe: true, administratorOwner: false, readers: ["Everyone"] });
		expect(await findings(adapter)).toEqual([{
			status: "warning",
			finding: "Other accounts can read Mars-RAM's code and settings (Everyone). Tokens and links stay private.",
			fix: `If you did not allow this on purpose, remove it in the Windows Security advanced permissions of ${"%USERPROFILE%\\.mars-ram"}.`,
		}]);
		expect((await findings(adapter, true))[0]!.fix).toBe("Si no lo permitiste a propósito, quitalo en los permisos avanzados de Seguridad de Windows de %USERPROFILE%\\.mars-ram.");
	});
	it("falls back to the SID when the principal has no name, and keeps non-ASCII names intact", async () => {
		const { adapter } = windows({}, { [root]: own([{ sid: CODEX, rights: READ_EXECUTE }]) });
		expect((await adapter.acl()).readers).toEqual([CODEX]);
		const named = windows({}, { [root]: own([{ sid: CODEX, rights: READ_EXECUTE, name: "EQUIPO\\Usuarios de Codex ñ" }]) });
		expect((await named.adapter.acl()).readers).toEqual(["EQUIPO\\Usuarios de Codex ñ"]);
	});
	it.each([
		["a root entry that can write", { [root]: own([{ ...codexRead, rights: MODIFY }]) }],
		["a root entry that can change permissions", { [root]: own([{ ...codexRead, rights: READ_EXECUTE | 0x40000 }]) }],
		["a root owned by another account", { [root]: own([], CODEX) }],
		["a root without Allow entries", { [root]: { owner: USER, protected: true, rules: [] } }],
		["a secret folder with an extra entry", { [`${root}\\links`]: own([codexRead]) }],
		["a secret folder owned by another account", { [`${root}\\notify`]: own([], CODEX) }],
		["a secret folder inheriting the root's extra entries", { [root]: own([codexRead]), [`${root}\\bridges`]: own([], USER, false) }],
		["a token file with an extra entry", { [`${root}\\bridges\\pi-1.json`]: own([codexRead]) }],
		["an agents lock with an extra entry", { [`${root}\\agents\\codex-abc.lock`]: own([codexRead]) }],
	] as [string, Record<string, Item>][])("reports a problem for %s, as before", async (_case, override) => {
		const { adapter } = windows(secretTree, { [root]: own(), ...secretAcls(), ...override });
		expect((await adapter.acl()).safe).toBe(false);
		expect(await findings(adapter)).toEqual([{
			status: "problem",
			finding: "Mars-RAM ACL and owner: unsafe.",
			fix: "Use Windows Security advanced permissions to allow only your account, SYSTEM and Administrators, including ownership and child entries.",
		}]);
		expect((await findings(adapter, true))[0]!.finding).toBe("ACL y propietario de Mars-RAM: inseguros.");
	});
	it("accepts a secret folder inheriting from a clean root", async () => {
		const { adapter } = windows(secretTree, { [root]: own(), ...secretAcls(), [`${root}\\links`]: own([], USER, false) });
		expect(await adapter.acl()).toEqual({ safe: true, administratorOwner: false, readers: [] });
	});
	it("reports ok for a clean tree and only asks about the secret folders that exist", async () => {
		const tree = { [`${root}\\bridges`]: ["pi-1.json"] };
		const { adapter, asked, scripts } = windows(tree, { [root]: own(), [`${root}\\bridges`]: own(), [`${root}\\bridges\\pi-1.json`]: own() });
		expect(await findings(adapter)).toEqual([{ status: "ok", finding: "Mars-RAM ACL and owner: restricted." }]);
		expect(asked.sort()).toEqual([root, `${root}\\bridges`, `${root}\\bridges\\pi-1.json`]);
		for (const script of scripts) {
			expect(script).toContain("Get-Acl -LiteralPath");
			expect(script).toContain("FileSystemRights");
			expect(script).not.toMatch(/Set-Acl|SetAccessControl|New-Item|Remove-Item|icacls/);
		}
	});
	it("ignores an entry that disappeared between listing and reading, but not a missing root", async () => {
		const { adapter } = windows(secretTree, { [root]: own(), ...secretAcls(), [`${root}\\bridges\\pi-1.json`]: { missing: true } });
		expect((await adapter.acl()).safe).toBe(true);
		await expect(windows({}, {}).adapter.acl()).rejects.toThrow();
	});
	it("keeps the L9 Administrators-owner warning next to the read-only warning", async () => {
		const { adapter } = windows({}, { [root]: own([codexRead], ADMINS) });
		expect(await adapter.acl()).toEqual({ safe: true, administratorOwner: true, readers: ["MARS\\CodexSandboxUsers"] });
		expect((await findings(adapter)).map((f) => f.status)).toEqual(["warning", "warning"]);
	});
	it("bounds every PowerShell command line and keeps paths as data", async () => {
		const names = Array.from({ length: 150 }, (_, i) => `entry-${i}-${"x".repeat(60)}.json`);
		const tree = { [`${root}\\links`]: names };
		const acls: Record<string, Item> = { [root]: own(), [`${root}\\links`]: own(), ...Object.fromEntries(names.map((name) => [`${root}\\links\\${name}`, own()])) };
		const { adapter, asked, scripts } = windows(tree, acls);
		expect((await adapter.acl()).safe).toBe(true);
		expect(asked).toHaveLength(152);
		expect(scripts.length).toBeGreaterThan(1);
		for (const script of scripts) {
			expect(Buffer.from(script, "utf16le").toString("base64").length).toBeLessThan(30_000);
			expect(script).not.toContain("entry-");
		}
	});
	describe("every descendant of the secret folders", () => {
		const MARKER = `${LOCK}\\4242-133700000000000000-0123456789abcdef`;
		it("reads the lock markers, link records and link copies deep inside the secret folders", async () => {
			const { adapter, asked } = windows(secretTree, { [root]: own(), ...secretAcls() });
			expect(await findings(adapter)).toEqual([{ status: "ok", finding: "Mars-RAM ACL and owner: restricted." }]);
			expect(asked).toEqual(expect.arrayContaining([MARKER, `${LINK}\\link.json`, `${LINK}\\content`]));
		});
		it.each([
			["a hook-token marker inside a session lock", MARKER],
			["a link's link.json", `${LINK}\\link.json`],
			["a link's copied content", `${LINK}\\content`],
		])("reports a problem for %s with an extra entry", async (_case, path) => {
			const { adapter } = windows(secretTree, { [root]: own(), ...secretAcls(), [path]: own([codexRead]) });
			expect(await findings(adapter)).toEqual([PROBLEM]);
		});
		it("treats a reparse point (junction or symlink) as unsafe and never walks into it", async () => {
			const { adapter, asked, listed } = windows(secretTree, { [root]: own(), ...secretAcls(), [LINK]: { ...own(), reparse: true } });
			expect(await findings(adapter)).toEqual([PROBLEM]);
			expect(listed).not.toContain(LINK);
			expect(asked).not.toContain(`${LINK}\\link.json`);
			const file = windows(secretTree, { [root]: own(), ...secretAcls(), [`${root}\\bridges\\pi-1.json`]: { ...own(), reparse: true } });
			expect(await findings(file.adapter)).toEqual([PROBLEM]);
		});
		it("treats an ACL without its type and reparse flags as unsafe", async () => {
			const { adapter } = windows(secretTree, { [root]: own(), ...secretAcls(), [MARKER]: { ...own(), dir: "no" } });
			expect(await findings(adapter)).toEqual([PROBLEM]);
		});
		it("reports a problem, not ok, when there are too many entries to check, also deep down", async () => {
			const tree = { [`${root}\\links`]: ["many"], [`${root}\\links\\many`]: Array.from({ length: 1100 }, (_, i) => `f-${i}`) };
			const { adapter, asked } = windows(tree, { [root]: own(), ...treeAcls(tree) });
			expect(await adapter.acl()).toMatchObject({ safe: false, tooMany: true, readers: [] });
			expect(asked.length).toBeLessThanOrEqual(1024);
			expect(await findings(adapter)).toEqual([{
				status: "problem",
				finding: "Mars-RAM ACL and owner: too many entries to check.",
				fix: "Check by hand, in the Windows Security advanced permissions, that only your account, SYSTEM and Administrators can open the agents, bridges, links and notify folders and everything inside them.",
			}]);
			expect((await findings(adapter, true))[0]!.finding).toBe("ACL y propietario de Mars-RAM: demasiadas entradas para revisar.");
		});
	});
	describe("the registry folder the bridges use (PI_BRIDGE_REGISTRY_DIR)", () => {
		const registry = "D:\\Mars Ram\\pi-bridges";
		const tree = { ...secretTree, [registry]: ["pi-9.json", "agent-1.json"] };
		const env = { PI_BRIDGE_REGISTRY_DIR: registry };
		it("checks an overridden registry outside the root, with its entries, and reports ok when it is private", async () => {
			const { adapter, asked } = windows(tree, { [root]: own([codexRead]), ...treeAcls(tree) }, { env });
			expect(await adapter.acl()).toEqual({ safe: true, administratorOwner: false, readers: ["MARS\\CodexSandboxUsers"] });
			expect(asked).toEqual(expect.arrayContaining([registry, `${registry}\\pi-9.json`, `${registry}\\agent-1.json`]));
		});
		it.each([
			["a token file with an extra entry", { [`${registry}\\pi-9.json`]: own([codexRead]) }],
			["the folder with an extra entry", { [registry]: own([codexRead]) }],
			["the folder owned by another account", { [registry]: own([], CODEX) }],
			["the folder inheriting its ACL", { [registry]: own([], USER, false) }],
			["the folder being a reparse point", { [registry]: { ...own(), reparse: true } }],
		] as [string, Record<string, Item>][])("reports a problem for %s", async (_case, override) => {
			const { adapter } = windows(tree, { [root]: own(), ...treeAcls(tree), ...override }, { env });
			expect(await findings(adapter)).toEqual([PROBLEM]);
		});
		it("does not check the override when it is not set, and reports a relative or empty override as unsafe", async () => {
			const unset = windows(tree, { [root]: own(), ...treeAcls(tree), [registry]: own([codexRead]) });
			expect((await unset.adapter.acl()).safe).toBe(true);
			expect(unset.asked).not.toContain(registry);
			for (const value of ["pi-bridges", ""]) {
				const relative = windows(secretTree, { [root]: own(), ...secretAcls() }, { env: { PI_BRIDGE_REGISTRY_DIR: value } });
				expect(await findings(relative.adapter)).toEqual([PROBLEM]);
			}
		});
		it("checks an override inside the root as a secret folder, once", async () => {
			const inside = `${root}\\custom-bridges`;
			const local = { ...secretTree, [inside]: ["pi-9.json"] };
			const clean = windows(local, { [root]: own(), ...treeAcls(local) }, { env: { PI_BRIDGE_REGISTRY_DIR: inside } });
			expect((await clean.adapter.acl()).safe).toBe(true);
			expect(clean.asked.filter((path) => path === inside)).toHaveLength(1);
			const inherited = windows(local, { [root]: own([codexRead]), ...treeAcls(local), [inside]: own([], USER, false) }, { env: { PI_BRIDGE_REGISTRY_DIR: inside } });
			expect((await inherited.adapter.acl()).safe).toBe(false);
			const same = windows(secretTree, { [root]: own(), ...secretAcls() }, { env: { PI_BRIDGE_REGISTRY_DIR: `${root}\\Bridges\\` } });
			expect((await same.adapter.acl()).safe).toBe(true);
			expect(same.asked.filter((path) => path.toLowerCase().startsWith(`${root}\\bridges`.toLowerCase()) && !path.includes(".json"))).toHaveLength(1);
		});
	});
	describe("entries reported missing", () => {
		const TOKEN = `${root}\\bridges\\pi-1.json`;
		it("accepts missing only when a re-check shows the path is gone", async () => {
			const gone = windows(secretTree, { [root]: own(), ...secretAcls(), [TOKEN]: { missing: true } });
			expect((await gone.adapter.acl()).safe).toBe(true);
			const present = windows(secretTree, { [root]: own(), ...secretAcls(), [TOKEN]: { missing: true } }, { present: [TOKEN] });
			expect(await findings(present.adapter)).toEqual([PROBLEM]);
		});
		it.each([
			["missing mixed with an ACL", { missing: true, ...own([codexRead]) }],
			["missing mixed with a clean ACL", { missing: true, ...own() }],
			["missing mixed with an error", { missing: true, error: true }],
			["missing that is not true", { missing: "yes" }],
			["an error", { error: true }],
		] as [string, Item][])("treats %s as unsafe", async (_case, item) => {
			const { adapter } = windows(secretTree, { [root]: own(), ...secretAcls(), [TOKEN]: item });
			expect(await findings(adapter)).toEqual([PROBLEM]);
		});
	});
	describe("the root and each secret folder are checked before anything under them", () => {
		it.each([
			["a reparse point", { ...own(), reparse: true }],
			["not a directory", { ...own(), dir: false }],
		] as [string, Item][])("reports a problem for a root that is %s and probes nothing under it", async (_case, item) => {
			const { adapter, asked, touched } = windows(secretTree, { ...secretAcls(), [root]: item });
			expect(await findings(adapter)).toEqual([PROBLEM]);
			expect(asked).toEqual([root]);
			expect(under(touched, root)).toEqual([]);
		});
		it.each([
			["a reparse point", { ...own(), reparse: true }],
			["not a directory", { ...own(), dir: false }],
		] as [string, Item][])("reports a problem for a secret folder that is %s and never lists it", async (_case, item) => {
			const bridges = `${root}\\bridges`;
			const { adapter, listed, asked } = windows(secretTree, { [root]: own(), ...secretAcls(), [bridges]: item });
			expect(await findings(adapter)).toEqual([PROBLEM]);
			expect(listed).not.toContain(bridges);
			expect(under(asked, bridges)).toEqual([]);
		});
	});
	describe("a registry override that is the root itself", () => {
		const tree = { ...secretTree, [root]: ["agents", "bridges", "links", "notify", "pi-9.json", "host.json"] };
		it.each([`${home}\\.MARS-RAM\\`, `${home}\\.mars-ram\\.`, `c:\\users\\MARS\\.mars-ram`])("judges the root as a secret folder for %s", async (value) => {
			const env = { PI_BRIDGE_REGISTRY_DIR: value };
			const clean = windows(tree, { ...treeAcls(tree), [root]: own() }, { env });
			expect(await findings(clean.adapter)).toEqual([{ status: "ok", finding: "Mars-RAM ACL and owner: restricted." }]);
			expect(clean.asked).toEqual(expect.arrayContaining([`${root}\\pi-9.json`, `${root}\\host.json`, `${LINK}\\link.json`]));
			expect(clean.asked.filter((path) => path === root)).toHaveLength(1);
			// The root holds tokens now: a reader on it is a problem, not a warning.
			const reader = windows(tree, { ...treeAcls(tree), [root]: own([codexRead]) }, { env });
			expect(await reader.adapter.acl()).toMatchObject({ safe: false, readers: [] });
			expect(await findings(reader.adapter)).toEqual([PROBLEM]);
			const token = windows(tree, { ...treeAcls(tree), [root]: own(), [`${root}\\pi-9.json`]: own([codexRead]) }, { env });
			expect(await findings(token.adapter)).toEqual([PROBLEM]);
			const inherited = windows(tree, { ...treeAcls(tree), [root]: own([], USER, false) }, { env });
			expect(await findings(inherited.adapter)).toEqual([PROBLEM]);
		});
	});
	describe("a registry override that is not fully qualified", () => {
		it.each(["\\pi-bridges", "/pi-bridges", "C:pi-bridges", "\\\\server", "\\\\server\\"])("reports %s as unknown", async (value) => {
			const { adapter } = windows(secretTree, { [root]: own(), ...secretAcls() }, { env: { PI_BRIDGE_REGISTRY_DIR: value } });
			expect(await findings(adapter)).toEqual([PROBLEM]);
		});
		it("accepts a UNC share path and checks it", async () => {
			const unc = "\\\\server\\share\\pi-bridges";
			const tree = { ...secretTree, [unc]: ["pi-9.json"] };
			const { adapter, asked } = windows(tree, { [root]: own(), ...treeAcls(tree) }, { env: { PI_BRIDGE_REGISTRY_DIR: unc } });
			expect(await findings(adapter)).toEqual([{ status: "ok", finding: "Mars-RAM ACL and owner: restricted." }]);
			expect(asked).toEqual(expect.arrayContaining([unc, `${unc}\\pi-9.json`]));
		});
	});
	describe("the full doctor never follows links or reparse points", () => {
		const problems = (results: { status: string }[]) => results.filter((result) => result.status === "problem");
		it("reports ok for a clean tree", async () => {
			const { adapter } = windows(secretTree, { [root]: own(), ...secretAcls() });
			const report = await fullDoctor(adapter);
			expect(problems(report.results)).toEqual([]);
			expect(report.code).toBe(0);
		});
		it("reports a root that is a reparse point and looks at nothing under it", async () => {
			const { adapter, asked, touched } = windows(secretTree, { ...secretAcls(), [root]: { ...own(), reparse: true } }, { links: [root] });
			const report = await fullDoctor(adapter);
			expect(problems(report.results)).toEqual([REGISTRY_LINK(root), PROBLEM]);
			expect(report.code).toBe(1);
			expect(asked).toEqual([root]);
			expect(under(touched, root)).toEqual([]);
		});
		it("reports a root that is not a directory and looks at nothing under it", async () => {
			const { adapter, asked, touched } = windows(secretTree, { ...secretAcls(), [root]: { ...own(), dir: false } }, { files: [root] });
			const report = await fullDoctor(adapter);
			expect(problems(report.results)).toEqual([REGISTRY_LINK(root), PROBLEM]);
			expect(asked).toEqual([root]);
			expect(under(touched, root)).toEqual([]);
		});
		it("reports a symlinked bridges entry without reading it", async () => {
			const evil = `${root}\\bridges\\evil.json`;
			const tree = { ...secretTree, [`${root}\\bridges`]: ["evil.json", "pi-1.json"] };
			const { adapter, touched, reads } = windows(tree, { [root]: own(), ...treeAcls(tree), [evil]: { ...own(), reparse: true } }, { links: [evil] });
			const report = await fullDoctor(adapter);
			expect(problems(report.results)).toEqual([REGISTRY_LINK(evil), PROBLEM]);
			expect(reads).not.toContain(evil);
			expect(reads).toContain(`${root}\\bridges\\pi-1.json`);
			expect(touched.filter((path) => path.startsWith(`${evil}\\`))).toEqual([]);
			expect(report.results).toContainEqual(expect.objectContaining({ finding: expect.stringContaining("Stale or invalid bridge entry: pi-1.json") }));
			expect(report.results).not.toContainEqual(expect.objectContaining({ finding: expect.stringContaining("Stale or invalid bridge entry: evil.json") }));
		});
		it("reports a symlinked bridges folder without listing it", async () => {
			const bridges = `${root}\\bridges`;
			const { adapter, listed } = windows(secretTree, { [root]: own(), ...secretAcls(), [bridges]: { ...own(), reparse: true } }, { links: [bridges] });
			const report = await fullDoctor(adapter);
			expect(problems(report.results)).toEqual([REGISTRY_LINK(bridges), PROBLEM]);
			expect(listed).not.toContain(bridges);
		});
	});
	describe("every folder on the way to a registry override", () => {
		const problems = (results: { status: string }[]) => results.filter((result) => result.status === "problem");
		const run = async (registry: string, extra: Record<string, string[]>, options: { links?: string[]; files?: string[] }) => {
			const tree = { ...secretTree, ...extra };
			const doctor = windows(tree, { [root]: own(), ...treeAcls(tree) }, { ...options, env: { PI_BRIDGE_REGISTRY_DIR: registry } });
			return { ...doctor, report: await fullDoctor(doctor.adapter) };
		};
		it("reports a junction inside the root on the way and never touches the registry under it", async () => {
			const junction = `${root}\\elsewhere`;
			const registry = `${junction}\\pi-bridges`;
			const { report, asked, touched } = await run(registry, { [junction]: ["pi-bridges"], [registry]: ["pi-9.json"] }, { links: [junction] });
			expect(problems(report.results)).toEqual([REGISTRY_LINK(junction), PROBLEM]);
			expect(touched.filter((path) => path.toLowerCase().startsWith(registry.toLowerCase()))).toEqual([]);
			expect(asked.filter((path) => path.toLowerCase().startsWith(junction.toLowerCase()))).toEqual([]);
		});
		it.each([
			["a junction", { links: ["D:\\Junction"] }],
			["a file", { files: ["D:\\Junction"] }],
		] as [string, { links?: string[]; files?: string[] }][])("reports %s outside the root on the way and never touches the registry under it", async (_case, options) => {
			const registry = "D:\\Junction\\nested\\pi-bridges";
			const { report, asked, touched } = await run(registry, { [registry]: ["pi-9.json"] }, options);
			expect(problems(report.results)).toEqual([REGISTRY_LINK("D:\\Junction"), PROBLEM]);
			expect(touched.filter((path) => path.startsWith("D:\\Junction\\"))).toEqual([]);
			expect(asked.filter((path) => path.startsWith("D:\\"))).toEqual([]);
		});
		it("reports a registry folder that is itself a link without listing or asking about it", async () => {
			const registry = "D:\\Mars Ram\\pi-bridges";
			const { report, asked, listed } = await run(registry, { [registry]: ["pi-9.json"] }, { links: [registry] });
			expect(problems(report.results)).toEqual([REGISTRY_LINK(registry), PROBLEM]);
			expect(listed).not.toContain(registry);
			expect(asked).not.toContain(registry);
		});
		it.each([
			["outside the root", "D:\\Mars Ram\\nested\\pi-bridges"],
			["inside the root", `${root}\\nested\\pi-bridges`],
			["on a UNC share", "\\\\server\\share\\nested\\pi-bridges"],
		])("reports ok for a clean nested override %s and checks it", async (_case, registry) => {
			const { report, asked } = await run(registry, { [registry]: ["pi-9.json"] }, {});
			expect(problems(report.results)).toEqual([]);
			expect(report.code).toBe(0);
			expect(asked).toEqual(expect.arrayContaining([registry, `${registry}\\pi-9.json`]));
		});
	});
});
