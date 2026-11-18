// `mars-ram update` policy: which package manager, what runs, and what the user reads, with fake ports.
import { describe, expect, it } from "vitest";
import { managerCommand, managerFor, newestPackage, update, type GlobalRoot, type RunResult, type UpdatePorts } from "../../src/core/update.ts";

const PNPM_DIR = "/home/alex/.local/share/pnpm/global/5/node_modules/.pnpm/mars-ram@0.1.7/node_modules/mars-ram";
const WIN_PNPM_DIR = "C:\\Users\\ASUS\\AppData\\Local\\pnpm\\global\\5\\node_modules\\.pnpm\\mars-ram@0.1.7\\node_modules\\mars-ram";
const NEW_BIN = "/home/alex/.local/share/pnpm/global/5/node_modules/mars-ram/bin/mars-ram.mjs";
const MANUAL_EN = "In a normal terminal (not an administrator one), run these two commands, one per line:";

const roots = (pnpm: string[] | "missing" | "failed", npm: string[] | "missing" | "failed" = [], bun: string[] | "missing" | "failed" = "missing"): GlobalRoot[] =>
	([["pnpm", pnpm], ["npm", npm], ["bun", bun]] as const).map(([manager, value]) => typeof value === "string" ? { manager, state: value } : { manager, state: "ok", packages: [...value] });

type Fake = UpdatePorts & { out: string[]; err: string[]; calls: string[] };
function fake(overrides: Partial<UpdatePorts> = {}): Fake {
	const out: string[] = [], err: string[] = [], calls: string[] = [];
	const ports: Fake = {
		out, err, calls,
		platform: "linux",
		inWindow: false,
		packageBin: `${PNPM_DIR}/bin/mars-ram.mjs`,
		packageDir: PNPM_DIR,
		currentVersion: "0.1.7",
		elevated: () => { calls.push("elevated"); return false; },
		globalRoots: async () => { calls.push("roots"); return roots([PNPM_DIR]); },
		openWindow: async () => { calls.push("openWindow"); return true; },
		waitForCaller: async () => { calls.push("waitForCaller"); return true; },
		runManager: async (manager, args) => { calls.push(`run ${manager} ${args.join(" ")}`); return { ok: true }; },
		installedVersion: (dir) => { calls.push(`version ${dir}`); return "0.1.7"; },
		installedPackage: async (manager) => { calls.push(`find ${manager}`); return { entry: NEW_BIN, version: "0.1.8" }; },
		runInstall: async (entry) => { calls.push(`install ${entry}`); return 0; },
		runDoctor: async (entry) => { calls.push(`doctor ${entry}`); return 0; },
		waitForEnter: async () => { calls.push("enter"); },
		print: (line) => out.push(line),
		printError: (line) => err.push(line),
		...overrides,
	} as Fake;
	return ports;
}

describe("managerFor (S4): the manager whose global root holds the running package", () => {
	it.each([
		// Folder names never decide: a user called pnpm, an npm prefix ending in install\global, a custom pnpm 11 store.
		["/home/pnpm/.local/lib/node_modules/mars-ram", "linux", roots([], ["/home/pnpm/.local/lib/node_modules/mars-ram"]), "npm"],
		["C:\\Users\\pnpm\\AppData\\Roaming\\npm\\node_modules\\mars-ram", "win32", roots([], ["C:\\Users\\pnpm\\AppData\\Roaming\\npm\\node_modules\\mars-ram"], []), "npm"],
		["/srv/cache/store/v11/links/@/mars-ram/0.1.6/984a01/node_modules/mars-ram", "linux", roots(["/srv/cache/store/v11/links/@/mars-ram/0.1.6/984a01/node_modules/mars-ram"], []), "pnpm"],
		["C:\\tools\\install\\global\\node_modules\\mars-ram", "win32", roots([], ["C:\\tools\\install\\global\\node_modules\\mars-ram"], []), "npm"],
		["/home/alex/.bun/install/global/node_modules/mars-ram", "linux", roots([], [], ["/home/alex/.bun/install/global/node_modules/mars-ram"]), "bun"],
		// Windows paths compare without case; a manager that is not installed or whose root command fails is skipped.
		["C:\\USERS\\ASUS\\APPDATA\\ROAMING\\NPM\\NODE_MODULES\\MARS-RAM", "win32", roots("missing", ["C:\\Users\\ASUS\\AppData\\Roaming\\npm\\node_modules\\mars-ram"]), "npm"],
		["/usr/local/lib/node_modules/mars-ram", "linux", roots("failed", ["/usr/local/lib/node_modules/mars-ram"], "missing"), "npm"],
	] as const)("%s → %s", (dir, platform, found, manager) => {
		expect(managerFor(dir, found, platform)).toEqual({ manager, matches: [manager] });
	});

	it("zero or several matches name no manager", () => {
		expect(managerFor("/opt/mars-ram", roots([], []), "linux")).toEqual({ matches: [] });
		expect(managerFor("/USR/lib/node_modules/mars-ram", roots([], ["/usr/lib/node_modules/mars-ram"]), "linux")).toEqual({ matches: [] });
		expect(managerFor("/x/mars-ram", roots(["/x/mars-ram"], ["/x/mars-ram"]), "linux")).toEqual({ matches: ["pnpm", "npm"] });
		expect(managerFor("/x/mars-ram", roots("failed", "failed", "missing"), "linux")).toEqual({ matches: [] });
	});

	it("names the exact command for each manager", () => {
		expect(managerCommand("pnpm")).toEqual(["add", "-g", "mars-ram@latest"]);
		expect(managerCommand("npm")).toEqual(["install", "-g", "mars-ram@latest"]);
		expect(managerCommand("bun")).toEqual(["add", "-g", "mars-ram@latest"]);
	});
});

describe("newestPackage", () => {
	it("picks the highest release and ignores invalid versions", () => {
		expect(newestPackage([{ entry: "a", version: "0.1.9" }, { entry: "b", version: "0.1.10" }, { entry: "c", version: "x" }])).toEqual({ entry: "b", version: "0.1.10" });
		expect(newestPackage([{ entry: "c", version: "dev" }])).toBeUndefined();
		expect(newestPackage([])).toBeUndefined();
	});
});

describe("update (English)", () => {
	it("S6: updates with the detected manager, reports from/to and passes the new install's exit code", async () => {
		const ports = fake({ runInstall: async (entry) => { ports.calls.push(`install ${entry}`); return 3; } });
		expect(await update(ports, false)).toBe(3);
		// A failed install is the update's result; the doctor does not run after it.
		expect(ports.calls).toEqual(["roots", "run pnpm add -g mars-ram@latest", "find pnpm", `install ${NEW_BIN}`]);
		expect(ports.out).toEqual([
			"Updating mars-ram with pnpm: pnpm add -g mars-ram@latest",
			"mars-ram updated from 0.1.7 to 0.1.8.",
			"Running mars-ram install of 0.1.8…",
		]);
		expect(ports.err).toEqual([]);
	});

	it("release 0.1.8 S2: after a successful install it runs the new version's doctor and says in one line that it ran", async () => {
		const ports = fake();
		expect(await update(ports, false)).toBe(0);
		expect(ports.calls).toEqual(["roots", "run pnpm add -g mars-ram@latest", "find pnpm", `install ${NEW_BIN}`, `doctor ${NEW_BIN}`]);
		expect(ports.out).toEqual([
			"Updating mars-ram with pnpm: pnpm add -g mars-ram@latest",
			"mars-ram updated from 0.1.7 to 0.1.8.",
			"Running mars-ram install of 0.1.8…",
			"Running mars-ram doctor of 0.1.8…",
			"mars-ram doctor ran; its findings are above. The update finished.",
		]);
		expect(ports.err).toEqual([]);
	});

	it("release 0.1.8 S2: doctor problems, or a doctor that cannot start, never change the update's success", async () => {
		const problems = fake({ runDoctor: async (entry) => { problems.calls.push(`doctor ${entry}`); return 1; } });
		expect(await update(problems, false)).toBe(0);
		expect(problems.out.slice(2)).toEqual([
			"Running mars-ram install of 0.1.8…",
			"Running mars-ram doctor of 0.1.8…",
			"mars-ram doctor ran and found problems (above); fix them as it says. The update itself finished.",
		]);
		expect(problems.err).toEqual([]);
		const broken = fake({ runDoctor: async () => undefined });
		expect(await update(broken, false)).toBe(0);
		expect(broken.out.at(-1)).toBe("mars-ram doctor could not run; run it yourself to check the setup. The update finished.");
		expect(broken.err).toEqual([]);
	});

	it("release 0.1.8 S2: a failed update never runs the doctor", async () => {
		for (const overrides of [
			{ runManager: async (): Promise<RunResult> => ({ ok: false, code: 1, stdout: "", stderr: "boom" }) },
			{ installedPackage: async () => undefined },
			{ runInstall: async () => 2 },
		]) {
			const ports = fake(overrides);
			expect(await update(ports, false)).not.toBe(0);
			expect(ports.calls.some((call) => call.startsWith("doctor"))).toBe(false);
		}
	});

	it("S6: says it was already up to date and still runs that version's install", async () => {
		const ports = fake({ installedPackage: async () => ({ entry: NEW_BIN, version: "0.1.7" }) });
		expect(await update(ports, false)).toBe(0);
		expect(ports.out).toEqual([
			"Updating mars-ram with pnpm: pnpm add -g mars-ram@latest",
			"mars-ram was already up to date (0.1.7).",
			"Running mars-ram install of 0.1.7…",
			"Running mars-ram doctor of 0.1.7…",
			"mars-ram doctor ran; its findings are above. The update finished.",
		]);
	});

	it("S4: npm and Bun installs update with their own manager", async () => {
		for (const [dir, found, manager, command] of [
			["/usr/local/lib/node_modules/mars-ram", roots([], ["/usr/local/lib/node_modules/mars-ram"]), "npm", "npm install -g mars-ram@latest"],
			["/home/alex/.bun/install/global/node_modules/mars-ram", roots("missing", "missing", ["/home/alex/.bun/install/global/node_modules/mars-ram"]), "bun", "bun add -g mars-ram@latest"],
		] as const) {
			const ports = fake({ packageBin: `${dir}/bin/mars-ram.mjs`, packageDir: dir, globalRoots: async () => found });
			expect(await update(ports, false)).toBe(0);
			expect(ports.calls[0]).toBe(`run ${command}`);
			expect(ports.calls[1]).toBe(`find ${manager}`);
			expect(ports.out[0]).toBe(`Updating mars-ram with ${manager}: ${command}`);
		}
	});

	it("S4: an installation that is not from a package gets the manual way and nothing runs (Linux, macOS)", async () => {
		const ports = fake({ packageBin: undefined, packageDir: undefined });
		expect(await update(ports, false)).toBe(1);
		expect(ports.calls).toEqual([]);
		expect(ports.out).toEqual([]);
		expect(ports.err).toEqual([[
			"This mars-ram was not installed with a package manager (pnpm, npm or Bun), so mars-ram update cannot update it. Nothing changed.",
			"Installed with the curl script: run it again:",
			"  curl -fsSL https://marssall.github.io/mars-ram/install.sh | sh",
			"From a clone of the repository: update it (git pull) and run:",
			"  node host/cli/src/main.ts install",
			"Or switch to the package, which mars-ram update can update afterwards (one command per line):",
			"  pnpm add -g mars-ram",
			"  mars-ram install",
		].join("\n")]);
	});

	it("S4: on Windows the manual way names the PowerShell script", async () => {
		const ports = fake({ platform: "win32", packageBin: undefined, packageDir: undefined });
		expect(await update(ports, false)).toBe(1);
		expect(ports.calls).toEqual(["elevated"]);
		expect(ports.err[0]!.split("\n").slice(1, 3)).toEqual([
			"Installed with the PowerShell script: run it again in PowerShell:",
			"  irm https://marssall.github.io/mars-ram/install.ps1 | iex",
		]);
	});

	it("S4: no manager lists the package: says which were not found, shows every manager's commands, nothing runs", async () => {
		const ports = fake({ globalRoots: async () => { ports.calls.push("roots"); return roots("missing", "failed", "missing"); } });
		expect(await update(ports, false)).toBe(1);
		expect(ports.calls).toEqual(["roots"]);
		expect(ports.out).toEqual([]);
		expect(ports.err).toEqual([[
			`mars-ram is installed from a package (${PNPM_DIR}), but no package manager lists it among its global packages, so mars-ram update cannot tell which one to use. Nothing changed.`,
			"Not found: pnpm, bun. Could not ask: npm.",
			"Update it with the package manager you installed it with. In a normal terminal (not an administrator one), run these two commands, one per line:",
			"pnpm add -g mars-ram@latest   (or: npm install -g mars-ram@latest, or: bun add -g mars-ram@latest)",
			"mars-ram install",
		].join("\n")]);
	});

	it("S4: several managers list it: names them, nothing runs", async () => {
		const ports = fake({ globalRoots: async () => roots([PNPM_DIR], [PNPM_DIR]) });
		expect(await update(ports, false)).toBe(1);
		expect(ports.calls).toEqual([]);
		expect(ports.err[0]!.split("\n")[0]).toBe(`mars-ram (${PNPM_DIR}) is listed by more than one package manager (pnpm, npm), so mars-ram update cannot tell which one to use. Nothing changed.`);
		expect(ports.err[0]!.split("\n")).toHaveLength(4);
	});

	it("S3: an elevated Windows terminal is refused before anything else", async () => {
		const ports = fake({ platform: "win32", elevated: () => { ports.calls.push("elevated"); return true; } });
		expect(await update(ports, false)).toBe(1);
		expect(ports.calls).toEqual(["elevated"]);
		expect(ports.out).toEqual([]);
		expect(ports.err).toEqual(["Open a non-administrator terminal to update. Nothing changed."]);
	});

	it("S3: the elevation check also runs in the continuation window", async () => {
		const ports = fake({ platform: "win32", inWindow: true, elevated: () => { ports.calls.push("elevated"); return true; } });
		expect(await update(ports, false)).toBe(1);
		expect(ports.calls).toEqual(["elevated", "enter"]);
		expect(ports.out).toEqual(["Press Enter to close this window."]);
	});

	it("Windows: the update continues in a new window so the running mars-ram.cmd is never replaced under cmd.exe", async () => {
		const ports = fake({ platform: "win32", packageBin: `${WIN_PNPM_DIR}\\bin\\mars-ram.mjs`, packageDir: WIN_PNPM_DIR, globalRoots: async () => { ports.calls.push("roots"); return roots([WIN_PNPM_DIR]); } });
		expect(await update(ports, false)).toBe(0);
		expect(ports.calls).toEqual(["elevated", "roots", "openWindow"]);
		expect(ports.out).toEqual(["The update continues in a new window: Windows cannot replace the mars-ram command while this terminal is running it."]);
	});

	it("Windows: without a window nothing runs and the two commands are shown one per line", async () => {
		const ports = fake({ platform: "win32", openWindow: async () => false });
		expect(await update(ports, false)).toBe(1);
		expect(ports.calls).toEqual(["elevated", "roots"]);
		expect(ports.err).toEqual([`Could not open a window for the update. Nothing changed. ${MANUAL_EN}\npnpm add -g mars-ram@latest\nmars-ram install`]);
	});

	it("Windows window: waits for the first terminal to finish, updates, and waits for Enter before closing", async () => {
		const ports = fake({ platform: "win32", inWindow: true });
		expect(await update(ports, false)).toBe(0);
		// The doctor of the new version runs in this window too, before it waits for Enter.
		expect(ports.calls).toEqual(["elevated", "roots", "waitForCaller", "run pnpm add -g mars-ram@latest", "find pnpm", `install ${NEW_BIN}`, `doctor ${NEW_BIN}`, "enter"]);
		expect(ports.out.at(-2)).toBe("mars-ram doctor ran; its findings are above. The update finished.");
		expect(ports.out.at(-1)).toBe("Press Enter to close this window.");
	});

	it("Windows window: when the first terminal is still running after the wait, nothing runs and the two commands are shown", async () => {
		const ports = fake({ platform: "win32", inWindow: true, waitForCaller: async () => { ports.calls.push("waitForCaller"); return false; } });
		expect(await update(ports, false)).toBe(1);
		expect(ports.calls).toEqual(["elevated", "roots", "waitForCaller", "enter"]);
		expect(ports.err).toEqual([`The first terminal is still running mars-ram, so the update did not start. Nothing changed. ${MANUAL_EN}\npnpm add -g mars-ram@latest\nmars-ram install`]);
	});

	it("S1/S5: pnpm's global bin directory not in PATH or missing explains pnpm setup and reports the version still installed", async () => {
		for (const output of [
			{ stdout: "", stderr: 'ERROR The configured global bin directory "C:\\Users\\ASUS\\AppData\\Local\\pnpm\\bin" is not in PATH\nRun "pnpm setup" to update your shell configuration.' },
			{ stdout: " ERR_PNPM_NO_GLOBAL_BIN_DIR  Unable to find the global bin directory", stderr: "" },
		]) {
			const ports = fake({ runManager: async () => ({ ok: false, code: 1, ...output }) });
			expect(await update(ports, false)).toBe(1);
			expect(ports.calls).toEqual(["roots", `version ${PNPM_DIR}`]);
			expect(ports.err).toEqual([`pnpm has no global bin directory on PATH. Run pnpm setup, open a new terminal and run mars-ram update again.\nmars-ram 0.1.7 is still installed (${PNPM_DIR}).`]);
		}
	});

	it("S5: a failure that left the package unreadable says the installation may be incomplete and how to repair it", async () => {
		const ports = fake({ installedVersion: () => undefined, runManager: async () => ({ ok: false, code: 1, stdout: "", stderr: "EPERM: rename" }) });
		expect(await update(ports, false)).toBe(1);
		expect(ports.err).toEqual([[
			"pnpm could not update mars-ram (exit code 1). pnpm said:",
			"EPERM: rename",
			`The installed mars-ram could not be read (${PNPM_DIR}): the installation may be incomplete. Run mars-ram update again, or reinstall it with these two commands, one per line:`,
			"pnpm add -g mars-ram@latest",
			"mars-ram install",
		].join("\n")]);
	});

	it("S5: a missing manager is named; it never ran, so nothing changed", async () => {
		const ports = fake({ runManager: async () => ({ ok: false, missing: true }) });
		expect(await update(ports, false)).toBe(1);
		expect(ports.err).toEqual(["pnpm was not found. mars-ram was installed with pnpm: install it, or open a terminal where pnpm works, and run mars-ram update again. Nothing changed."]);
	});

	it("S5: other failures show the end of the manager's own message and what is installed now; nothing else runs", async () => {
		const stderr = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join("\n") + "\n\n";
		const ports = fake({ installedVersion: () => "0.1.6", runManager: async () => ({ ok: false, code: 254, stdout: "progress", stderr }) });
		expect(await update(ports, false)).toBe(1);
		expect(ports.err).toEqual([["pnpm could not update mars-ram (exit code 254). pnpm said:", ...Array.from({ length: 20 }, (_, i) => `line ${i + 6}`), `mars-ram 0.1.6 is still installed (${PNPM_DIR}).`].join("\n")]);
		expect(ports.calls).not.toContain("find pnpm");
		const quiet = fake({ runManager: async () => ({ ok: false, code: 1, stdout: "only stdout", stderr: "" }) });
		expect(await update(quiet, false)).toBe(1);
		expect(quiet.err).toEqual([`pnpm could not update mars-ram (exit code 1). pnpm said:\nonly stdout\nmars-ram 0.1.7 is still installed (${PNPM_DIR}).`]);
	});

	it("S5: a manager that cannot be started shows why and the manual commands", async () => {
		const ports = fake({ runManager: async (): Promise<RunResult> => ({ ok: false, error: "Unsupported pnpm.cmd launcher." }) });
		expect(await update(ports, false)).toBe(1);
		expect(ports.err).toEqual([`Could not run pnpm: Unsupported pnpm.cmd launcher. Nothing changed. ${MANUAL_EN}\npnpm add -g mars-ram@latest\nmars-ram install`]);
	});

	it("S6: the new package cannot be found after a successful update", async () => {
		const ports = fake({ installedPackage: async () => undefined });
		expect(await update(ports, false)).toBe(1);
		expect(ports.err).toEqual(["pnpm finished, but the new mars-ram was not found. Open a new terminal and run mars-ram install."]);
	});
});

describe("update (Spanish)", () => {
	it("speaks Spanish for every message", async () => {
		const ok = fake();
		await update(ok, true);
		expect(ok.out).toEqual([
			"Actualizando mars-ram con pnpm: pnpm add -g mars-ram@latest",
			"mars-ram se actualizó de 0.1.7 a 0.1.8.",
			"Ejecutando mars-ram install de la 0.1.8…",
			"Ejecutando mars-ram doctor de la 0.1.8…",
			"Se ejecutó mars-ram doctor; lo que encontró está arriba. La actualización terminó.",
		]);
		const problems = fake({ runDoctor: async () => 1 });
		expect(await update(problems, true)).toBe(0);
		expect(problems.out.at(-1)).toBe("Se ejecutó mars-ram doctor y encontró problemas (arriba); arreglalos como indica. La actualización en sí terminó.");
		const broken = fake({ runDoctor: async () => undefined });
		expect(await update(broken, true)).toBe(0);
		expect(broken.out.at(-1)).toBe("No se pudo ejecutar mars-ram doctor; ejecutalo vos para revisar la instalación. La actualización terminó.");
		const same = fake({ installedPackage: async () => ({ entry: NEW_BIN, version: "0.1.7" }) });
		await update(same, true);
		expect(same.out[1]).toBe("mars-ram ya estaba en la última versión (0.1.7).");
		const admin = fake({ platform: "win32", elevated: () => true });
		await update(admin, true);
		expect(admin.err).toEqual(["Abrí una terminal sin privilegios de administrador para actualizar. No se cambió nada."]);
		const path = fake({ runManager: async () => ({ ok: false, code: 1, stdout: "", stderr: "ERR_PNPM_NO_GLOBAL_BIN_DIR" }) });
		await update(path, true);
		expect(path.err).toEqual([`pnpm no tiene su carpeta de comandos globales en PATH. Ejecutá pnpm setup, abrí una terminal nueva y ejecutá mars-ram update otra vez.\nSigue instalado mars-ram 0.1.7 (${PNPM_DIR}).`]);
		const missing = fake({ runManager: async () => ({ ok: false, missing: true }) });
		await update(missing, true);
		expect(missing.err).toEqual(["No se encontró pnpm. mars-ram se instaló con pnpm: instalalo, o abrí una terminal donde pnpm funcione, y ejecutá mars-ram update otra vez. No se cambió nada."]);
		const failed = fake({ installedVersion: () => undefined, runManager: async () => ({ ok: false, code: 2, stdout: "", stderr: "boom" }) });
		await update(failed, true);
		expect(failed.err).toEqual([`pnpm no pudo actualizar mars-ram (código 2). pnpm dijo:\nboom\nNo se pudo leer el mars-ram instalado (${PNPM_DIR}): la instalación puede haber quedado incompleta. Ejecutá mars-ram update otra vez, o reinstalalo con estos dos comandos, uno por línea:\npnpm add -g mars-ram@latest\nmars-ram install`]);
		const manual = fake({ packageBin: undefined, packageDir: undefined });
		await update(manual, true);
		expect(manual.err[0]!.split("\n")[0]).toBe("Este mars-ram no se instaló con un gestor de paquetes (pnpm, npm o Bun), así que mars-ram update no puede actualizarlo. No se cambió nada.");
		const unknown = fake({ globalRoots: async () => roots("missing", [], "failed") });
		await update(unknown, true);
		expect(unknown.err).toEqual([[
			`mars-ram está instalado desde un paquete (${PNPM_DIR}), pero ningún gestor de paquetes lo tiene entre sus paquetes globales, así que mars-ram update no sabe cuál usar. No se cambió nada.`,
			"No se encontró: pnpm. No se pudo consultar: bun.",
			"Actualizalo con el gestor con el que lo instalaste. En una terminal normal (no de administrador), ejecutá estos dos comandos, uno por línea:",
			"pnpm add -g mars-ram@latest   (o: npm install -g mars-ram@latest, o: bun add -g mars-ram@latest)",
			"mars-ram install",
		].join("\n")]);
		const several = fake({ globalRoots: async () => roots([PNPM_DIR], [], [PNPM_DIR]) });
		await update(several, true);
		expect(several.err[0]!.split("\n")[0]).toBe(`mars-ram (${PNPM_DIR}) figura en más de un gestor de paquetes (pnpm, bun), así que mars-ram update no sabe cuál usar. No se cambió nada.`);
		const window = fake({ platform: "win32" });
		await update(window, true);
		expect(window.out).toEqual(["La actualización sigue en una ventana nueva: Windows no puede reemplazar el comando mars-ram mientras esta terminal lo está ejecutando."]);
		const noWindow = fake({ platform: "win32", openWindow: async () => false });
		await update(noWindow, true);
		expect(noWindow.err).toEqual(["No se pudo abrir una ventana para actualizar. No se cambió nada. En una terminal normal (no de administrador), ejecutá estos dos comandos, uno por línea:\npnpm add -g mars-ram@latest\nmars-ram install"]);
		const late = fake({ platform: "win32", inWindow: true, waitForCaller: async () => false });
		await update(late, true);
		expect(late.err).toEqual(["La primera terminal sigue ejecutando mars-ram, así que la actualización no empezó. No se cambió nada. En una terminal normal (no de administrador), ejecutá estos dos comandos, uno por línea:\npnpm add -g mars-ram@latest\nmars-ram install"]);
		const enter = fake({ platform: "win32", inWindow: true });
		await update(enter, true);
		expect(enter.out.at(-1)).toBe("Pulsá Enter para cerrar esta ventana.");
		const lost = fake({ installedPackage: async () => undefined });
		await update(lost, true);
		expect(lost.err).toEqual(["pnpm terminó, pero no se encontró el mars-ram nuevo. Abrí una terminal nueva y ejecutá mars-ram install."]);
	});
});
