import { mkdtempSync, mkdirSync, chmodSync, readFileSync, existsSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInstallAdapter as realCreateInstallAdapter, resolveWindowsPiEntry, findHerdr, stableNodePath } from "../../src/adapters/installation.ts";
import { Installation } from "../../src/core/installation.ts";
import { copyIsCurrent } from "../../src/adapters/doctor.ts";

// Windows tests must never reach the real HKCU user Path, even with a temporary HOME.
function createInstallAdapter(options: Parameters<typeof realCreateInstallAdapter>[0] = {}) {
 let raw = "";
 return realCreateInstallAdapter({ ...options, userPath: { read: () => ({ raw, kind: "ExpandString" }), write: (_previous, value) => { raw = value; } } });
}

describe("installation adapter (isolated; never invokes Pi)", () => {
 it("uninstall calls the installed stop before deleting the copy and reports failure", async () => {
  const home = mkdtempSync(join(tmpdir(), "link-stop-"));
  try {
   const main = join(home, ".mars-ram/link-server/src/main.ts");
   mkdirSync(join(home, ".mars-ram/link-server/src"), { recursive: true });
   writeFileSync(main, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(join(home, "stop-args"))}, JSON.stringify(process.argv.slice(2)));\nprocess.exit(1);`);
   const adapter = createInstallAdapter({ home });
   await expect(adapter.deleteInstallation()).rejects.toThrow(/stop/i);
   expect(JSON.parse(readFileSync(join(home, "stop-args"), "utf8"))).toEqual(["stop"]);
   expect(existsSync(main)).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
 });
 it("finds Herdr without a shell, records it atomically, updates and removes only owned config", async () => {
  const home = mkdtempSync(join(tmpdir(), "herdr-install-"));
  try {
   const bin = join(home, "my tools"); mkdirSync(bin); const herdr = join(bin, "herdr");
   writeFileSync(herdr, "fixture only"); chmodSync(herdr, 0o700);
   expect(findHerdr({ path: bin })).toBe(herdr);
   const adapter = createInstallAdapter({ home, herdr: () => findHerdr({ path: bin }) });
   expect(await adapter.writeHostConfig()).toBe(true);
   expect(JSON.parse(readFileSync(join(home, ".mars-ram/host.json"), "utf8"))).toEqual({ herdr, node: stableNodePath(), linkServer: join(home, ".mars-ram/link-server/src/main.ts"), linkPort: 47811, cli: join(home, '.mars-ram/cli/src/main.ts') });
   expect(existsSync(join(home, ".mars-ram/host.tmp"))).toBe(false);
   const missing = createInstallAdapter({ home, herdr: () => undefined });
   expect(await missing.writeHostConfig()).toBe(false);
   expect(JSON.parse(readFileSync(join(home, ".mars-ram/host.json"), "utf8"))).toEqual({ node: stableNodePath(), linkServer: join(home, ".mars-ram/link-server/src/main.ts"), linkPort: 47811, cli: join(home, '.mars-ram/cli/src/main.ts') });
   await adapter.deleteInstallation(); expect(existsSync(join(home, ".mars-ram/host.json"))).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
 });
 it("looks up Windows exe paths and PATHEXT without executing command shims", () => {
  const seen: string[] = [];
  expect(findHerdr({ platform: "win32", path: 'C:\\first;"C:\\Program Files\\Herdr"', pathExt: ".CMD;.EXE", executable: file => { seen.push(file); return file === "C:\\Program Files\\Herdr\\herdr.exe"; } })).toBe("C:\\Program Files\\Herdr\\herdr.exe");
  expect(seen).toEqual(["C:\\first\\herdr", "C:\\first\\herdr.exe", "C:\\Program Files\\Herdr\\herdr", "C:\\Program Files\\Herdr\\herdr.exe"]);
 });
 it("ignores non-executable files and directories on PATH", () => {
  const home = mkdtempSync(join(tmpdir(), "herdr-path-"));
  try { mkdirSync(join(home, "herdr")); expect(findHerdr({ path: home })).toBeUndefined(); }
  finally { rmSync(home, { recursive: true, force: true }); }
 });
	it("R3/R4 keeps an unowned registration and shared copy after uninstall", async () => {
		const home = mkdtempSync(join(tmpdir(), "host-unowned-"));
		try {
			const adapter = createInstallAdapter({ home });
			const unowned = join(home, ".pi", "agent");
			const owned = join(home, ".gentle-shell", "agent");
			for (const agent of [unowned, owned]) mkdirSync(agent, { recursive: true });
			const settings = join(unowned, "settings.json");
			writeFileSync(settings, JSON.stringify({ packages: ["../../.mars-ram/pi-bridge"] }));
			const calls: string[] = [];
			const installer = new Installation({ ...adapter, preflight: async () => {},
				register: async (agent, copy) => { calls.push(`install ${agent}`); writeFileSync(join(agent, "settings.json"), JSON.stringify({ packages: [copy] })); },
				remove: async (agent) => { calls.push(`remove ${agent}`); writeFileSync(join(agent, "settings.json"), '{"packages":[]}'); },
			});
			expect(await installer.install([unowned, owned], true)).toEqual([unowned]);
			const messages = await installer.uninstall(true);
			expect(await adapter.isRegistered(unowned, join(home, ".mars-ram", "pi-bridge"))).toBe(true);
			expect(existsSync(join(home, ".mars-ram", "pi-bridge", "src", "extension.ts"))).toBe(true);
			expect(messages.join(" ")).toMatch(/kept.*registration/i);
			expect(calls).toEqual([`install ${owned}`, `remove ${owned}`]);
			expect(await adapter.isRegistered(owned, join(home, ".mars-ram", "pi-bridge"))).toBe(false);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
	it("builds and updates a self-contained copy and detects only existing homes", async () => {
		const home = mkdtempSync(join(tmpdir(), "host-install-"));
		try {
			const adapter = createInstallAdapter({ home });
			expect(await adapter.candidateHomes()).toEqual([]);
			const agent = join(home, ".pi", "agent");
			mkdirSync(agent, { recursive: true });
			expect(await adapter.candidateHomes()).toEqual([agent]);
			const result = await adapter.buildCopy();
			expect(typeof result.version).toBe("string");
			expect(copyIsCurrent(result.copy)).toBe(true);
			await adapter.writeRecord({ ...result, homes: [agent], date: "2026-10-23T00:00:00Z" });
			expect((await adapter.readRecord())?.homes).toEqual([agent]);
			for (const path of ["src/extension.ts", "package.json", "node_modules/@workspace/protocol/src/index.ts", "node_modules/@workspace/protocol/package.json", "node_modules/typebox/package.json"]) {
				expect(existsSync(join(result.copy, path)), path).toBe(true);
			}
			expect(JSON.parse(readFileSync(join(result.copy, "node_modules/typebox/package.json"), "utf8")).name).toBe("typebox");
			writeFileSync(join(agent, "settings.json"), JSON.stringify({ packages: ["../../.mars-ram/pi-bridge"] }));
			expect(await adapter.isRegistered(agent, result.copy)).toBe(true);
			writeFileSync(join(result.copy, "src", "extension.ts"), "// outdated copy\n");
			expect(copyIsCurrent(result.copy)).toBe(false);
			expect((await adapter.buildCopy()).version).toBe(result.version);
			expect(copyIsCurrent(result.copy)).toBe(true);
			expect(existsSync(join(result.copy, "src/extension.ts"))).toBe(true);
			writeFileSync(join(agent, "settings.json"), JSON.stringify({ packages: [{ source: result.copy }] }));
			expect(await adapter.isRegistered(agent, result.copy)).toBe(true);
			for (const name of ["bridges", "uploads"]) {
				mkdirSync(join(home, ".mars-ram", name));
				writeFileSync(join(home, ".mars-ram", name, "keep"), "untouched");
			}
			await adapter.deleteInstallation();
			expect(existsSync(result.copy)).toBe(false);
			expect(await adapter.readRecord()).toBeUndefined();
			for (const name of ["bridges", "uploads"]) expect(readFileSync(join(home, ".mars-ram", name, "keep"), "utf8")).toBe("untouched");
		} finally { rmSync(home, { recursive: true, force: true }); }
	});
	it.each(["root", "pi-bridge", "install.json", "host.json", "host.tmp", "pi-bridge.staging", "pi-bridge.previous", "link-server", "link-server.staging", "link-server.previous", "cli", "cli.staging", "cli.previous", "bin", "install.tmp", "pi-bridge-staging-old", "install.123.tmp"])("F1 refuses linked installer paths before touching targets: %s", async (name) => {
		const home = mkdtempSync(join(tmpdir(), "host-link-"));
		try {
			const root = join(home, ".mars-ram");
			const target = join(home, "unrelated");
			mkdirSync(target);
			writeFileSync(join(target, "keep"), "safe");
			if (name !== "root") mkdirSync(root);
			symlinkSync(target, name === "root" ? root : join(root, name), "junction");
			const adapter = createInstallAdapter({ home });
			await expect(adapter.preflight()).rejects.toThrow(/check|revis/i);
   await expect(adapter.writeHostConfig()).rejects.toThrow(/check|revis/i);
			await expect(adapter.recover()).rejects.toThrow(/check|revis/i);
			await expect(adapter.readRecord()).rejects.toThrow(/check|revis/i);
			await expect(adapter.writeRecord({ copy: join(root, "pi-bridge"), homes: [], version: "1", date: "today" })).rejects.toThrow(/check|revis/i);
			await expect(adapter.buildCopy()).rejects.toThrow(/check|revis/i);
			await expect(adapter.deleteInstallation()).rejects.toThrow(/check|revis/i);
			expect(readFileSync(join(target, "keep"), "utf8")).toBe("safe");
		} finally { rmSync(home, { recursive: true, force: true }); }
	});
	it("F3 restores the previous copy and removes staging after interruption, then uninstalls leftovers", async () => {
		const home = mkdtempSync(join(tmpdir(), "host-recovery-"));
		try {
			const root = join(home, ".mars-ram");
			mkdirSync(join(root, "pi-bridge.previous"), { recursive: true });
			writeFileSync(join(root, "pi-bridge.previous", "keep"), "usable");
			mkdirSync(join(root, "pi-bridge.staging"));
			const adapter = createInstallAdapter({ home });
			await adapter.recover();
			expect(readFileSync(join(root, "pi-bridge", "keep"), "utf8")).toBe("usable");
			expect(existsSync(join(root, "pi-bridge.staging"))).toBe(false);
			mkdirSync(join(root, "pi-bridge.previous"));
			mkdirSync(join(root, "pi-bridge.staging"));
			await adapter.deleteInstallation();
			for (const name of ["pi-bridge", "pi-bridge.staging", "pi-bridge.previous"]) expect(existsSync(join(root, name))).toBe(false);
		} finally { rmSync(home, { recursive: true, force: true }); }
	});
	it("uninstall also removes leftovers of the earlier random-name installer, and nothing else", async () => {
		const home = mkdtempSync(join(tmpdir(), "mr-legacy-"));
		try {
			const root = join(home, ".mars-ram");
			for (const dir of ["pi-bridge-staging-abc123", "pi-bridge-staging-abc123-previous", "bridges", "uploads"]) mkdirSync(join(root, dir), { recursive: true });
			writeFileSync(join(root, "install.123.tmp"), "{}");
			writeFileSync(join(root, "uploads", "keep.png"), "x");
			await createInstallAdapter({ home }).deleteInstallation();
			expect(existsSync(join(root, "pi-bridge-staging-abc123"))).toBe(false);
			expect(existsSync(join(root, "pi-bridge-staging-abc123-previous"))).toBe(false);
			expect(existsSync(join(root, "install.123.tmp"))).toBe(false);
			expect(existsSync(join(root, "uploads", "keep.png"))).toBe(true);
			expect(existsSync(join(root, "bridges"))).toBe(true);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("F1 rejects dangling links and accepts a symlinked home whose product root is real", async () => {
		const fixture = mkdtempSync(join(tmpdir(), "host-real-home-"));
		try {
			const home = join(fixture, "real-home");
			mkdirSync(home);
			const alias = join(fixture, "home-alias");
			symlinkSync(home, alias, "junction");
			const adapter = createInstallAdapter({ home: alias });
			await adapter.buildCopy();
			await adapter.deleteInstallation();
			symlinkSync(join(fixture, "missing"), join(home, ".mars-ram", "pi-bridge"), "junction");
			await expect(adapter.deleteInstallation()).rejects.toThrow(/check|revis/i);
		} finally { rmSync(fixture, { recursive: true, force: true }); }
	});
 it("installs the dependency-free link server, preserves host fields and link data, and recovers its backup", async () => {
  const home = mkdtempSync(join(tmpdir(), "links-install-"));
  try {
   const root = join(home, ".mars-ram");
   const adapter = createInstallAdapter({ home, herdr: () => undefined });
   await adapter.buildCopy();
   const main = join(root, "link-server/src/main.ts");
   expect(existsSync(main)).toBe(true);
   expect(existsSync(join(root, "link-server/node_modules"))).toBe(false);
   expect(readFileSync(join(root, "link-server/fingerprint.sha256"), "utf8").trim()).toMatch(/^[a-f0-9]{64}$/);
   writeFileSync(join(root, "host.json"), JSON.stringify({ custom: "keep", herdr: "/old/herdr" }));
   await adapter.writeHostConfig();
   expect(JSON.parse(readFileSync(join(root, "host.json"), "utf8"))).toEqual({ custom: "keep", node: stableNodePath(), cli: join(root, 'cli/src/main.ts'), linkServer: main, linkPort: 47811 });
   mkdirSync(join(root, "links")); writeFileSync(join(root, "links/keep"), "user data");
   await adapter.deleteInstallation();
   expect(existsSync(main)).toBe(false);
   expect(JSON.parse(readFileSync(join(root, "host.json"), "utf8"))).toEqual({ custom: "keep" });
   expect(readFileSync(join(root, "links/keep"), "utf8")).toBe("user data");
   mkdirSync(join(root, "link-server.previous"));
   writeFileSync(join(root, "link-server.previous/keep"), "recoverable");
   mkdirSync(join(root, "link-server.staging"));
   await adapter.recover();
   expect(readFileSync(join(root, "link-server/keep"), "utf8")).toBe("recoverable");
   expect(existsSync(join(root, "link-server.staging"))).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
 });
	it("resolves supported Windows shims and rejects unknown layouts without a shell", () => {
		const shim = '@"%~dp0\\node.exe" "%~dp0\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js" %*';
		expect(resolveWindowsPiEntry(shim, "C:\\tools\\pi.cmd")).toBe("C:\\tools\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js");
		expect(() => resolveWindowsPiEntry("echo unexpected", "C:\\tools\\pi.cmd")).toThrow();
	});
});

describe("recorded shortcut programs", () => {
 it("records the programs found at install, replaces an old record and keeps other fields", async () => {
  const home = mkdtempSync(join(tmpdir(), "programs-install-"));
  try {
   mkdirSync(join(home, ".mars-ram"), { recursive: true });
   writeFileSync(join(home, ".mars-ram/host.json"), JSON.stringify({ repoRoots: ["/srv/code"], programs: { opencode: "/old/opencode" } }));
   const adapter = createInstallAdapter({ home, herdr: () => undefined, programs: async () => ({ pi: "/home/u/Library/pnpm/bin/pi" }) });
   await adapter.writeHostConfig();
   const written = JSON.parse(readFileSync(join(home, ".mars-ram/host.json"), "utf8"));
   expect(written.programs).toEqual({ pi: "/home/u/Library/pnpm/bin/pi" });
   expect(written.repoRoots).toEqual(["/srv/code"]);
   const none = createInstallAdapter({ home, herdr: () => undefined, programs: async () => ({}) });
   await none.writeHostConfig();
   expect(JSON.parse(readFileSync(join(home, ".mars-ram/host.json"), "utf8")).programs).toBeUndefined();
  } finally { rmSync(home, { recursive: true, force: true }); }
 });
});
