// Composition: prompts stay outside the install use case and filesystem adapter.
import { createInstallAdapter } from "./adapters/installation.ts";
import { findPrograms } from "./adapters/repos.ts";
import { createPrompter, installText, isYes, spanish } from "./adapters/terminal.ts";
import { Installation, selectHomes } from "./core/installation.ts";
import { pathHint } from "./adapters/cli-installation.ts";
import { homedir } from "node:os";
import { APP_ID } from "@workspace/protocol";
import { removeLegacyUploads, removeUploadsFolder } from "./adapters/uploads-cleanup.ts";

// Attachment cleanup never fails install or uninstall: report and continue.
async function cleanUploads(steps: (() => Promise<string | undefined> | string | undefined)[]): Promise<void> {
	for (const step of steps) {
		try { const line = await step(); if (line) console.log(line); }
		catch (error) { console.log(spanish ? `No se pudo limpiar la carpeta de adjuntos: ${(error as Error).message}` : `Could not clean up the attachments folder: ${(error as Error).message}`); }
	}
}
const say = (en: string, es: string) => spanish ? es : en;

/** The hook config of one agent (Claude Code, Codex), as install and uninstall use it. */
type HookStep = { settingsPath(): string; install(): Promise<{ changed: boolean; backup?: string }>; uninstall(): Promise<{ changed: boolean }> };
type AgentHooks = { step: HookStep; name: string; installed?: (step: HookStep) => string };

/** Codex runs a user hook only after it is trusted in Codex (`/hooks`), and again after the command changes. */
const codexTrust = () => say(
	"Codex runs these hooks only after you trust them: open Codex, type /hooks, review the mars-ram hooks and trust them (once, and again after an update changes them).",
	"Codex ejecuta estos hooks solo después de que los apruebes: abrí Codex, escribí /hooks, revisá los hooks de mars-ram y aprobalos (una vez, y de nuevo si una actualización los cambia).");

/** An agent's hooks, only where the agent is installed; never fails the Pi side of install or uninstall. */
async function agentHooks(agent: AgentHooks | undefined, action: "install" | "uninstall"): Promise<boolean> {
	if (!agent) return true;
	const { step, name } = agent;
	try {
		if (action === "uninstall") {
			const { changed } = await step.uninstall();
			if (changed) console.log(say(`Removed the ${APP_ID} hooks from ${step.settingsPath()}; your other settings and hooks were kept.`, `Se quitaron los hooks de ${APP_ID} de ${step.settingsPath()}; tus otras configuraciones y hooks se conservaron.`));
			return true;
		}
		const { changed, backup } = await step.install();
		console.log(changed
			? say(`${name} hooks installed in ${step.settingsPath()}${backup ? ` (previous file saved as ${backup})` : ""}. ${name} sessions started from now on appear in the app.`, `Hooks de ${name} instalados en ${step.settingsPath()}${backup ? ` (archivo anterior guardado como ${backup})` : ""}. Las sesiones de ${name} que se inicien desde ahora aparecen en la app.`)
			: say(`${name} hooks already up to date in ${step.settingsPath()}.`, `Los hooks de ${name} ya están al día en ${step.settingsPath()}.`));
		if (agent.installed) console.log(agent.installed(step));
		return true;
	} catch (error) {
		console.error(say(`${name} hooks were not changed: ${(error as Error).message}`, `No se cambiaron los hooks de ${name}: ${(error as Error).message}`));
		return false;
	}
}
const claudeHooks = (step: HookStep | undefined, action: "install" | "uninstall") => agentHooks(step && { step, name: "Claude Code" }, action);
const codexHooks = (step: HookStep | undefined, action: "install" | "uninstall") => agentHooks(step && { step, name: "Codex", installed: codexTrust }, action);
/** Both agents' hooks, Claude Code first; each runs even when the other failed. */
const allHooks = async (claude: HookStep | undefined, codex: HookStep | undefined, action: "install" | "uninstall") => {
	const first = await claudeHooks(claude, action);
	const second = await codexHooks(codex, action);
	return first && second;
};

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
			if (!record) { const hooks = await allHooks(adapter.claude, adapter.codex, "uninstall"); const failures = await installation.uninstall(true); if (failures.length) throw new Error(failures.join("\n")); console.log(linkWarning); console.log(installText.noInstallation); await uninstallUploads(); packageNote(); return hooks ? 0 : 1; }
			console.log([...new Set([...record.homes, ...(record.pending ?? [])])].map((home, index) => `${index + 1}. ${home}`).join("\n"));
			if (!isYes(await prompter.ask(installText.confirmRemove))) { console.log(installText.cancelled); return 0; }
   console.log(linkWarning);
			// Hooks first: they run the CLI copy uninstall removes.
			const hooks = await allHooks(adapter.claude, adapter.codex, "uninstall");
			const failures = await installation.uninstall(true);
			if (failures.length) throw new Error(failures.join("\n"));
			console.log(installText.removed);
   await uninstallUploads();
   packageNote();
   if (process.platform === "win32") console.log(spanish ? "Abrí una terminal nueva para actualizar PATH." : "Open a new terminal to refresh PATH.");
			return hooks ? 0 : 1;
		}
		const found = await installation.homes();
		// Without Pi, the Pi homes cannot be registered; Claude Code or Codex alone still get their hooks.
		const homes = adapter.piAvailable?.() === false ? [] : found;
		const claude = adapter.claude && await adapter.claude.detected() ? adapter.claude : undefined;
		const codex = adapter.codex && await adapter.codex.detected() ? adapter.codex : undefined;
		if (!homes.length && !claude && !codex) {
			if (adapter.piAvailable?.() === false) throw new Error(installText.missingPi);
			console.log(installText.noHomes); return 0;
		}
		let selected: string[] = [];
		if (homes.length) {
			console.log(`${installText.homes}\n${homes.map((home, index) => `${index + 1}. ${home}`).join("\n")}`);
			while (true) {
				const answer = await prompter.ask(installText.exclude);
				if (answer === null) { console.log(installText.cancelled); return 0; }
				try { selected = selectHomes(homes, answer); break; }
				catch { console.error(installText.invalidSelection); }
			}
			if (selected.length) {
				console.log(selected.join("\n"));
				if (!isYes(await prompter.ask(installText.confirmInstall))) { console.log(installText.cancelled); return 0; }
			}
		}
		const withClaude = !!claude && isYes(await prompter.ask(say(
			`Claude Code found. Add the ${APP_ID} hooks to ${claude.settingsPath()} (your other settings and hooks are kept)? [y/N] `,
			`Se encontró Claude Code. ¿Agregar los hooks de ${APP_ID} a ${claude.settingsPath()} (tus otras configuraciones y hooks se conservan)? [s/N] `)));
		const withCodex = !!codex && isYes(await prompter.ask(say(
			`Codex found. Add the ${APP_ID} hooks to ${codex.settingsPath()} (your other hooks are kept)? [y/N] `,
			`Se encontró Codex. ¿Agregar los hooks de ${APP_ID} a ${codex.settingsPath()} (tus otros hooks se conservan)? [s/N] `)));
		if (!selected.length && !withClaude && !withCodex) { console.log(homes.length ? installText.noHomes : installText.cancelled); return 0; }
		const skipped = await installation.install(selected, true, { hostOnly: withClaude || withCodex });
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
		if (selected.length) console.log(`${installText.installed}\n${selected.filter((home) => !skipped.includes(home)).join("\n")}\n${installText.reload}`);
		const claudeDone = !withClaude || await claudeHooks(claude, "install");
		const codexDone = !withCodex || await codexHooks(codex, "install");
		return claudeDone && codexDone ? 0 : 1;
	} catch (error) {
		console.error(`${installText.failed}\n${(error as Error).message}`);
		return 1;
	} finally {
		prompter.close();
	}
}
