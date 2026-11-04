// Composition: prompts stay outside the install use case and filesystem adapter.
import { createInstallAdapter } from "./adapters/installation.ts";
import { findPrograms } from "./adapters/repos.ts";
import { createPrompter, installText, isYes, spanish } from "./adapters/terminal.ts";
import { Installation, selectHomes } from "./core/installation.ts";
import { pathHint } from "./adapters/cli-installation.ts";
import { homedir } from "node:os";

export async function installCommand(command: "install" | "uninstall"): Promise<number> {
	const adapter = createInstallAdapter({ programs: findPrograms });
 const installation = new Installation(adapter);
	const prompter = createPrompter();
	try {
		if (command === "uninstall") {
   const linkWarning = spanish
    ? "Se intentará detener el servidor confirmado antes de borrar la copia; se informarán los errores. Se conserva ~/.mars-ram/links (datos del usuario)."
    : "Uninstall attempts to stop the confirmed server before removing its copy and reports failures. ~/.mars-ram/links (user data) is retained.";
			const record = await installation.record();
			if (!record) { const failures = await installation.uninstall(true); if (failures.length) throw new Error(failures.join("\n")); console.log(linkWarning); console.log(installText.noInstallation); return 0; }
			console.log([...new Set([...record.homes, ...(record.pending ?? [])])].map((home, index) => `${index + 1}. ${home}`).join("\n"));
			if (!isYes(await prompter.ask(installText.confirmRemove))) { console.log(installText.cancelled); return 0; }
   console.log(linkWarning);
			const failures = await installation.uninstall(true);
			if (failures.length) throw new Error(failures.join("\n"));
			console.log(installText.removed);
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
  const hint = process.platform === "win32"
   ? (spanish ? "Abrí una terminal nueva para usar mars-ram (PATH de usuario actualizado si faltaba)." : "Open a new terminal to use mars-ram (user PATH updated if missing).")
   : pathHint(homedir(), process.env.PATH ?? "", process.env.SHELL ?? "", spanish);
  if (hint) console.log(hint);
  if (!await adapter.writeHostConfig()) console.log(spanish
   ? "La terminal no se abrirá hasta que instales Herdr y ejecutes mars-ram install de nuevo."
   : "The terminal will not open until Herdr is installed; run mars-ram install again.");
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
