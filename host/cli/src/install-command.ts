// Composition: prompts stay outside the install use case and filesystem adapter.
import { createInstallAdapter } from "./adapters/installation.ts";
import { findPrograms } from "./adapters/repos.ts";
import { createPrompter, installText, isYes, spanish } from "./adapters/terminal.ts";
import { Installation, selectHomes } from "./core/installation.ts";
import { pathHint } from "./adapters/cli-installation.ts";
import { homedir } from "node:os";
import { removeLegacyUploads, removeUploadsFolder } from "./adapters/uploads-cleanup.ts";

// Attachment cleanup never fails install or uninstall: report and continue.
async function cleanUploads(steps: (() => Promise<string | undefined> | string | undefined)[]): Promise<void> {
	for (const step of steps) {
		try { const line = await step(); if (line) console.log(line); }
		catch (error) { console.log(spanish ? `No se pudo limpiar la carpeta de adjuntos: ${(error as Error).message}` : `Could not clean up the attachments folder: ${(error as Error).message}`); }
	}
}
const uninstallUploads = () => cleanUploads([() => removeLegacyUploads(homedir(), spanish), () => removeUploadsFolder(spanish)]);

export async function installCommand(command: "install" | "uninstall"): Promise<number> {
	const adapter = createInstallAdapter({ programs: findPrograms });
 const installation = new Installation(adapter);
	const prompter = createPrompter();
	try {
		if (command === "uninstall") {
   const linkWarning = spanish
    ? "Se intentará detener el servidor confirmado antes de borrar la copia; se informarán los errores. Se conserva ~/.mars-ram/links (datos del usuario)."
    : "Uninstall attempts to stop the confirmed server before removing its copy and reports failures. ~/.mars-ram/links (user data) is retained.";
   // From the npm package, uninstall removes what install wrote; the package itself belongs to the package manager.
   const packageNote = () => { if (adapter.packageBin) console.log(spanish ? "El paquete de npm mars-ram queda instalado; quitalo con pnpm remove -g mars-ram (o npm uninstall -g mars-ram)." : "The mars-ram npm package stays installed; remove it with pnpm remove -g mars-ram (or npm uninstall -g mars-ram)."); };
			const record = await installation.record();
			if (!record) { const failures = await installation.uninstall(true); if (failures.length) throw new Error(failures.join("\n")); console.log(linkWarning); console.log(installText.noInstallation); await uninstallUploads(); packageNote(); return 0; }
			console.log([...new Set([...record.homes, ...(record.pending ?? [])])].map((home, index) => `${index + 1}. ${home}`).join("\n"));
			if (!isYes(await prompter.ask(installText.confirmRemove))) { console.log(installText.cancelled); return 0; }
   console.log(linkWarning);
			const failures = await installation.uninstall(true);
			if (failures.length) throw new Error(failures.join("\n"));
			console.log(installText.removed);
   await uninstallUploads();
   packageNote();
   if (process.platform === "win32") console.log(spanish ? "Abrí una terminal nueva para actualizar PATH." : "Open a new terminal to refresh PATH.");
			return 0;
		}
		const homes = await installation.homes();
		if (!homes.length) { console.log(installText.noHomes); return 0; }
		console.log(`${installText.homes}\n${homes.map((home, index) => `${index + 1}. ${home}`).join("\n")}`);
		let selected: string[];
		while (true) {
			const answer = await prompter.ask(installText.exclude);
			if (answer === null) { console.log(installText.cancelled); return 0; }
			try { selected = selectHomes(homes, answer); break; }
			catch { console.error(installText.invalidSelection); }
		}
		if (!selected.length) { console.log(installText.noHomes); return 0; }
		console.log(selected.join("\n"));
		if (!isYes(await prompter.ask(installText.confirmInstall))) { console.log(installText.cancelled); return 0; }
		const skipped = await installation.install(selected, true);
  // From the npm package its bin is the command, already on PATH; install wrote no launcher of its own.
  const hint = adapter.packageBin
   ? (process.platform === "win32" ? (spanish ? "Abrí una terminal nueva para usar mars-ram." : "Open a new terminal to use mars-ram.") : undefined)
   : process.platform === "win32"
   ? (spanish ? "Abrí una terminal nueva para usar mars-ram (PATH de usuario actualizado si faltaba)." : "Open a new terminal to use mars-ram (user PATH updated if missing).")
   : pathHint(homedir(), process.env.PATH ?? "", process.env.SHELL ?? "", spanish);
  if (hint) console.log(hint);
  const kept = adapter.keptLauncher();
  if (kept) console.log(spanish
   ? `Se conservó ${kept}: no lo creó mars-ram install. Si está antes en PATH, se ejecuta en lugar del paquete de npm.`
   : `Kept ${kept}: mars-ram install did not create it. If it comes first on PATH, it runs instead of the npm package.`);
  if (!await adapter.writeHostConfig()) console.log(spanish
   ? "La terminal no se abrirá hasta que instales Herdr y ejecutes mars-ram install de nuevo."
   : "The terminal will not open until Herdr is installed; run mars-ram install again.");
		await cleanUploads([() => removeLegacyUploads(homedir(), spanish)]);
		if (skipped.length) console.log(`${installText.unowned}\n${skipped.join("\n")}`);
		console.log(`${installText.installed}\n${selected.filter((home) => !skipped.includes(home)).join("\n")}\n${installText.reload}`);
		return 0;
	} catch (error) {
		console.error(`${installText.failed}\n${(error as Error).message}`);
		return 1;
	} finally {
		prompter.close();
	}
}
