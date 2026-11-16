// `mars-ram update`: updates the package with the manager it was installed with, then runs the new version's install.
// Decides from facts only; adapters find the package, run processes without a shell and print.

export type PackageManager = "pnpm" | "npm" | "bun";

export type RunResult =
	| { ok: true; stdout?: string }
	| { ok: false; missing: true }
	| { ok: false; error: string }
	| { ok: false; code: number; stdout: string; stderr: string };

export type InstalledPackage = { entry: string; version: string };

/** What a manager says about its global packages: not installed, could not answer, or the real folders of mars-ram it holds. */
export type GlobalRoot = { manager: PackageManager; state: "missing" | "failed" } | { manager: PackageManager; state: "ok"; packages: string[] };

export type UpdatePorts = {
	platform: NodeJS.Platform;
	/** The npm package's launcher this command came from; undefined for the curl or PowerShell script and a clone. */
	packageBin: string | undefined;
	/** Real path of the folder of that package. */
	packageDir: string | undefined;
	/** Release of the running code (`dev` in a checkout). */
	currentVersion: string;
	/** Windows: this process is the window the update continues in. */
	inWindow: boolean;
	/** Windows: the terminal has administrator rights. */
	elevated(): boolean;
	/** Each manager's global root, asked read-only. */
	globalRoots(): Promise<GlobalRoot[]>;
	/** Windows: starts this update again in a new console window; false when it could not. */
	openWindow(): Promise<boolean>;
	/** Windows window: true once every process of the first terminal has exited; false when one is still running at the limit. */
	waitForCaller(): Promise<boolean>;
	runManager(manager: PackageManager, args: string[]): Promise<RunResult>;
	/** The version of the mars-ram package in that folder now, read from disk; undefined when it cannot be read. */
	installedVersion(packageDir: string): string | undefined;
	/** Where the manager now has the package, read from disk after the update. */
	installedPackage(manager: PackageManager): Promise<InstalledPackage | undefined>;
	/** Runs `install` of that package as a separate process; its exit code. */
	runInstall(entry: string): Promise<number>;
	waitForEnter(): Promise<void>;
	print(line: string): void;
	printError(line: string): void;
};

const PACKAGE = "mars-ram";
const TAIL_LINES = 20;

/**
 * The manager whose global root holds the running package, compared by real path (without case on Windows). Folder names
 * never decide. No match or several: no manager.
 */
export function managerFor(packageDir: string, roots: GlobalRoot[], platform: NodeJS.Platform): { manager?: PackageManager; matches: PackageManager[] } {
	const key = (path: string) => (platform === "win32" ? path.toLowerCase() : path);
	const matches = roots.filter((root) => root.state === "ok" && root.packages.some((dir) => key(dir) === key(packageDir))).map((root) => root.manager);
	return matches.length === 1 ? { manager: matches[0]!, matches } : { matches };
}

export function managerCommand(manager: PackageManager): string[] {
	return [manager === "npm" ? "install" : "add", "-g", `${PACKAGE}@latest`];
}

const release = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** The highest release among packages found; invalid versions never win. */
export function newestPackage(found: InstalledPackage[]): InstalledPackage | undefined {
	const parts = (version: string) => version.split(".").map(Number);
	return found.filter((item) => release.test(item.version)).reduce<InstalledPackage | undefined>((best, item) => {
		if (!best) return item;
		const [a, b] = [parts(item.version), parts(best.version)];
		for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]! ? item : best;
		return best;
	}, undefined);
}

const MANAGERS: PackageManager[] = ["pnpm", "npm", "bun"];
const commandOf = (manager: PackageManager) => `${manager} ${managerCommand(manager).join(" ")}`;

function messages(spanish: boolean) {
	return spanish ? {
		noAdmin: "Abrí una terminal sin privilegios de administrador para actualizar. No se cambió nada.",
		notPackage: (windows: boolean) => [
			"Este mars-ram no se instaló con un gestor de paquetes (pnpm, npm o Bun), así que mars-ram update no puede actualizarlo. No se cambió nada.",
			...(windows
				? ["Si lo instalaste con el script de PowerShell, ejecutalo de nuevo en PowerShell:", "  irm https://marssall.github.io/mars-ram/install.ps1 | iex"]
				: ["Si lo instalaste con el script curl, ejecutalo de nuevo:", "  curl -fsSL https://marssall.github.io/mars-ram/install.sh | sh"]),
			"Desde un clon del repositorio: actualizalo (git pull) y ejecutá:",
			"  node host/cli/src/main.ts install",
			"O pasate al paquete, que después se actualiza con mars-ram update (un comando por línea):",
			"  pnpm add -g mars-ram",
			"  mars-ram install",
		].join("\n"),
		noManager: (dir: string) => `mars-ram está instalado desde un paquete (${dir}), pero ningún gestor de paquetes lo tiene entre sus paquetes globales, así que mars-ram update no sabe cuál usar. No se cambió nada.`,
		severalManagers: (dir: string, managers: string) => `mars-ram (${dir}) figura en más de un gestor de paquetes (${managers}), así que mars-ram update no sabe cuál usar. No se cambió nada.`,
		notFoundList: (managers: string) => `No se encontró: ${managers}.`,
		failedList: (managers: string) => `No se pudo consultar: ${managers}.`,
		anyManager: "Actualizalo con el gestor con el que lo instalaste. En una terminal normal (no de administrador), ejecutá estos dos comandos, uno por línea:",
		alternatives: (others: string[]) => `   (o: ${others.join(", o: ")})`,
		window: "La actualización sigue en una ventana nueva: Windows no puede reemplazar el comando mars-ram mientras esta terminal lo está ejecutando.",
		byHand: "En una terminal normal (no de administrador), ejecutá estos dos comandos, uno por línea:",
		noWindow: "No se pudo abrir una ventana para actualizar. No se cambió nada.",
		callerRunning: "La primera terminal sigue ejecutando mars-ram, así que la actualización no empezó. No se cambió nada.",
		cannotRun: (manager: string, why: string) => `No se pudo ejecutar ${manager}: ${why} No se cambió nada.`,
		updating: (manager: string, command: string) => `Actualizando mars-ram con ${manager}: ${command}`,
		missing: (manager: string) => `No se encontró ${manager}. mars-ram se instaló con ${manager}: instalalo, o abrí una terminal donde ${manager} funcione, y ejecutá mars-ram update otra vez. No se cambió nada.`,
		pnpmPath: "pnpm no tiene su carpeta de comandos globales en PATH. Ejecutá pnpm setup, abrí una terminal nueva y ejecutá mars-ram update otra vez.",
		failed: (manager: string, code: number) => `${manager} no pudo actualizar mars-ram (código ${code}). ${manager} dijo:`,
		stillInstalled: (version: string, dir: string) => `Sigue instalado mars-ram ${version} (${dir}).`,
		incomplete: (dir: string) => `No se pudo leer el mars-ram instalado (${dir}): la instalación puede haber quedado incompleta. Ejecutá mars-ram update otra vez, o reinstalalo con estos dos comandos, uno por línea:`,
		notFound: (manager: string) => `${manager} terminó, pero no se encontró el mars-ram nuevo. Abrí una terminal nueva y ejecutá mars-ram install.`,
		updated: (from: string, to: string) => `mars-ram se actualizó de ${from} a ${to}.`,
		upToDate: (version: string) => `mars-ram ya estaba en la última versión (${version}).`,
		install: (version: string) => `Ejecutando mars-ram install de la ${version}…`,
		enter: "Pulsá Enter para cerrar esta ventana.",
	} : {
		noAdmin: "Open a non-administrator terminal to update. Nothing changed.",
		notPackage: (windows: boolean) => [
			"This mars-ram was not installed with a package manager (pnpm, npm or Bun), so mars-ram update cannot update it. Nothing changed.",
			...(windows
				? ["Installed with the PowerShell script: run it again in PowerShell:", "  irm https://marssall.github.io/mars-ram/install.ps1 | iex"]
				: ["Installed with the curl script: run it again:", "  curl -fsSL https://marssall.github.io/mars-ram/install.sh | sh"]),
			"From a clone of the repository: update it (git pull) and run:",
			"  node host/cli/src/main.ts install",
			"Or switch to the package, which mars-ram update can update afterwards (one command per line):",
			"  pnpm add -g mars-ram",
			"  mars-ram install",
		].join("\n"),
		noManager: (dir: string) => `mars-ram is installed from a package (${dir}), but no package manager lists it among its global packages, so mars-ram update cannot tell which one to use. Nothing changed.`,
		severalManagers: (dir: string, managers: string) => `mars-ram (${dir}) is listed by more than one package manager (${managers}), so mars-ram update cannot tell which one to use. Nothing changed.`,
		notFoundList: (managers: string) => `Not found: ${managers}.`,
		failedList: (managers: string) => `Could not ask: ${managers}.`,
		anyManager: "Update it with the package manager you installed it with. In a normal terminal (not an administrator one), run these two commands, one per line:",
		alternatives: (others: string[]) => `   (or: ${others.join(", or: ")})`,
		window: "The update continues in a new window: Windows cannot replace the mars-ram command while this terminal is running it.",
		byHand: "In a normal terminal (not an administrator one), run these two commands, one per line:",
		noWindow: "Could not open a window for the update. Nothing changed.",
		callerRunning: "The first terminal is still running mars-ram, so the update did not start. Nothing changed.",
		cannotRun: (manager: string, why: string) => `Could not run ${manager}: ${why} Nothing changed.`,
		updating: (manager: string, command: string) => `Updating mars-ram with ${manager}: ${command}`,
		missing: (manager: string) => `${manager} was not found. mars-ram was installed with ${manager}: install it, or open a terminal where ${manager} works, and run mars-ram update again. Nothing changed.`,
		pnpmPath: "pnpm has no global bin directory on PATH. Run pnpm setup, open a new terminal and run mars-ram update again.",
		failed: (manager: string, code: number) => `${manager} could not update mars-ram (exit code ${code}). ${manager} said:`,
		stillInstalled: (version: string, dir: string) => `mars-ram ${version} is still installed (${dir}).`,
		incomplete: (dir: string) => `The installed mars-ram could not be read (${dir}): the installation may be incomplete. Run mars-ram update again, or reinstall it with these two commands, one per line:`,
		notFound: (manager: string) => `${manager} finished, but the new mars-ram was not found. Open a new terminal and run mars-ram install.`,
		updated: (from: string, to: string) => `mars-ram updated from ${from} to ${to}.`,
		upToDate: (version: string) => `mars-ram was already up to date (${version}).`,
		install: (version: string) => `Running mars-ram install of ${version}…`,
		enter: "Press Enter to close this window.",
	};
}

/** Output pnpm prints when its global bin directory is unset or not on PATH (the S1 report). */
const PNPM_NO_BIN = /ERR_PNPM_NO_GLOBAL_BIN_DIR|is not in PATH/;

function tail(output: string): string[] {
	return output.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean).slice(-TAIL_LINES);
}

/** Exit code: 1 when refused or failed, otherwise the new version's `mars-ram install`. */
export async function update(ports: UpdatePorts, spanish: boolean): Promise<number> {
	const text = messages(spanish);
	const windows = ports.platform === "win32";
	const done = async (code: number) => {
		if (ports.inWindow) { ports.print(text.enter); await ports.waitForEnter(); }
		return code;
	};
	if (windows && ports.elevated()) { ports.printError(text.noAdmin); return done(1); }
	if (!ports.packageBin || !ports.packageDir) { ports.printError(text.notPackage(windows)); return done(1); }
	const packageDir = ports.packageDir;
	const roots = await ports.globalRoots();
	const { manager, matches } = managerFor(packageDir, roots, ports.platform);
	if (!manager) {
		const names = (state: string) => roots.filter((root) => root.state === state).map((root) => root.manager).join(", ");
		const lines = matches.length ? [text.severalManagers(packageDir, matches.join(", "))] : [text.noManager(packageDir), [names("missing") && text.notFoundList(names("missing")), names("failed") && text.failedList(names("failed"))].filter(Boolean).join(" ")];
		const [first, ...others] = (matches.length ? matches : MANAGERS).map(commandOf);
		ports.printError([...lines.filter(Boolean), text.anyManager, `${first}${others.length ? text.alternatives(others) : ""}`, "mars-ram install"].join("\n"));
		return done(1);
	}
	const args = managerCommand(manager);
	const command = commandOf(manager);
	const twoCommands = `${command}\nmars-ram install`;
	const byHand = `${text.byHand}\n${twoCommands}`;
	// cmd.exe reads the running mars-ram.cmd line by line, so the package manager must not replace it under this terminal.
	if (windows && !ports.inWindow) {
		if (await ports.openWindow()) { ports.print(text.window); return 0; }
		ports.printError(`${text.noWindow} ${byHand}`);
		return 1;
	}
	if (ports.inWindow && !await ports.waitForCaller()) { ports.printError(`${text.callerRunning} ${byHand}`); return done(1); }
	ports.print(text.updating(manager, command));
	const result = await ports.runManager(manager, args);
	if (!result.ok) {
		if ("missing" in result) ports.printError(text.missing(manager));
		else if ("error" in result) ports.printError(`${text.cannotRun(manager, result.error)} ${byHand}`);
		else {
			// The manager ran: say what is on disk now, never an unchecked "nothing changed".
			const version = ports.installedVersion(packageDir);
			const now = version ? text.stillInstalled(version, packageDir) : `${text.incomplete(packageDir)}\n${twoCommands}`;
			const why = manager === "pnpm" && PNPM_NO_BIN.test(`${result.stdout}\n${result.stderr}`) ? [text.pnpmPath] : [text.failed(manager, result.code), ...tail(result.stderr.trim() ? result.stderr : result.stdout)];
			ports.printError([...why, now].join("\n"));
		}
		return done(1);
	}
	const installed = await ports.installedPackage(manager);
	if (!installed) { ports.printError(text.notFound(manager)); return done(1); }
	ports.print(installed.version === ports.currentVersion ? text.upToDate(installed.version) : text.updated(ports.currentVersion, installed.version));
	ports.print(text.install(installed.version));
	return done(await ports.runInstall(installed.entry));
}
