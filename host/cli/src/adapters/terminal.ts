// Messages, the QR, and the confirmation question in the computer's terminal, in Spanish or English.
import { createInterface } from "node:readline/promises";
import { renderUnicodeCompact } from "uqr";

// An empty locale variable counts as unset, as in POSIX.
export const spanish = (process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale).toLowerCase().startsWith("es");

export const text = spanish
	? {
			scan: "Escaneá este código con la app en tu teléfono:",
			orOpen: "O abrí este enlace en el teléfono:",
			expires: (minutes: number) => `El código vence en ${minutes} minutos y sirve para un solo teléfono.`,
			waiting: "Esperando al teléfono… (Ctrl+C para cancelar)",
			question: (device: string, fingerprint: string) => `¿Autorizar el teléfono "${device}" (${fingerprint})? [s/N] `,
			paired: (device: string) => `Listo: "${device}" ya puede conectarse a esta computadora.`,
			notPaired: (message: string) => `No se emparejó ningún teléfono: ${message}`,
			expired: "El código venció sin que se emparejara ningún teléfono.",
			cancelled: "Emparejamiento cancelado.",
			elevate: "Tu usuario es administrador: abrí la terminal como administrador para autorizar el teléfono.",
			usage: "Uso: mars-ram pair [--ssh-port <puerto>] | pair-zt [--ssh-port <puerto>] [--address <ipv4 de ZeroTier>] | install | uninstall | doctor",
		}
	: {
			scan: "Scan this code with the app on your phone:",
			orOpen: "Or open this link on the phone:",
			expires: (minutes: number) => `The code expires in ${minutes} minutes and works for one phone.`,
			waiting: "Waiting for the phone… (Ctrl+C to cancel)",
			question: (device: string, fingerprint: string) => `Authorize the phone "${device}" (${fingerprint})? [y/N] `,
			paired: (device: string) => `Done: "${device}" can now connect to this computer.`,
			notPaired: (message: string) => `No phone was paired: ${message}`,
			expired: "The code expired without pairing a phone.",
			cancelled: "Pairing cancelled.",
			elevate: "Your user is an administrator: open the terminal as administrator to authorize the phone.",
			usage: "Usage: mars-ram pair [--ssh-port <port>] | pair-zt [--ssh-port <port>] [--address <ZeroTier ipv4>] | install | uninstall | doctor",
		};

export const installText = spanish ? {
	homes: "Entornos Pi detectados:",
	exclude: "Números a excluir (separados por espacios o comas); Enter incluye todos: ",
	invalidSelection: "Selección inválida. Usá los números de la lista.",
	confirmInstall: "¿Instalar o actualizar el bridge en estos entornos? [s/N] ",
	confirmRemove: "¿Desinstalar el bridge de estos entornos? [s/N] ",
	cancelled: "Operación cancelada. No se cambió nada.",
	noHomes: "No hay entornos Pi seleccionados. No se cambió nada.",
	noInstallation: "No hay una instalación registrada.",
	installed: "Bridge instalado o actualizado en:",
	reload: "Las sesiones Pi abiertas lo cargarán en su próximo inicio o con /reload.",
	removed: "Bridge desinstalado. Teléfonos, claves, registro de sesiones y archivos compartidos no se tocaron.",
	failed: "No se completó la operación:",
	missingPi: "No se encontró pi en PATH. Instalá Pi y volvé a intentarlo; no se cambió nada.",
	noAdmin: "Abrí una terminal sin privilegios de administrador para instalar o desinstalar.",
	unsupportedShim: "El lanzador pi.cmd no es compatible. No se pudo resolver su entrada Node sin usar un shell.",
	invalidRecord: "install.json no es válido. No se modificó la instalación.",
	unsafePaths: "Revisá ~/.mars-ram, pi-bridge, install.json y las rutas staging/previous/temporales: no deben ser enlaces ni uniones y ~/.mars-ram debe estar dentro de tu directorio personal real. No se cambió nada.",
	unowned: "Registro existente sin propiedad de Mars-RAM: se dejó como estaba y no se registró para desinstalar:",
} : {
	homes: "Detected Pi environments:",
	exclude: "Numbers to exclude (spaces or commas); Enter includes all: ",
	invalidSelection: "Invalid selection. Use numbers from the list.",
	confirmInstall: "Install or update the bridge in these environments? [y/N] ",
	confirmRemove: "Uninstall the bridge from these environments? [y/N] ",
	cancelled: "Operation cancelled. Nothing changed.",
	noHomes: "No Pi environments selected. Nothing changed.",
	noInstallation: "No recorded installation found.",
	installed: "Bridge installed or updated in:",
	reload: "Open Pi sessions load it on their next start or with /reload.",
	removed: "Bridge uninstalled. Phones, keys, session registry and shared files were not touched.",
	failed: "The operation did not complete:",
	missingPi: "pi was not found on PATH. Install Pi and try again; nothing changed.",
	noAdmin: "Open a non-administrator terminal to install or uninstall.",
	unsupportedShim: "Unsupported pi.cmd launcher. Cannot resolve its Node entry point without a shell.",
	invalidRecord: "Invalid install.json. The installation was not modified.",
	unsafePaths: "Check ~/.mars-ram, pi-bridge, install.json and staging/previous/temporary paths: none may be symlinks or junctions, and ~/.mars-ram must be inside your real home directory. Nothing changed.",
	unowned: "Existing registration not owned by Mars-RAM: left unchanged and not recorded for uninstall:",
};

/**
 * One reader for every question of a command. Answers typed ahead (or piped) are queued, so a
 * second question never loses its line to the first. null means Ctrl+C or end of input.
 */
export function createPrompter(): { ask(question: string): Promise<string | null>; close(): void } {
	const reader = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
	const lines: string[] = [];
	const waiting: ((line: string | null) => void)[] = [];
	let ended = false;
	const finish = () => {
		ended = true;
		for (const resolve of waiting.splice(0)) resolve(null);
	};
	reader.on("line", (line) => {
		const resolve = waiting.shift();
		if (resolve) resolve(line);
		else lines.push(line);
	});
	reader.on("close", finish);
	reader.on("SIGINT", () => {
		finish();
		reader.close();
	});
	return {
		ask(question) {
			process.stdout.write(question);
			if (lines.length) return Promise.resolve(lines.shift()!);
			if (ended) return Promise.resolve(null);
			return new Promise((resolve) => waiting.push(resolve));
		},
		close: () => reader.close(),
	};
}

export function isYes(answer: string | null): boolean {
	return answer !== null && ["s", "si", "sí", "y", "yes"].includes(answer.trim().toLowerCase());
}

export function renderQr(data: string): string {
	return renderUnicodeCompact(data, { border: 2 });
}

/**
 * Only an explicit yes authorizes; anything else, including Enter, refuses. While the question is
 * shown, the terminal's Ctrl+C reaches readline instead of the process, so it is turned into a
 * refusal plus onCancel, which cancels the whole pairing.
 */
export async function askConfirmation(question: string, onCancel: () => void): Promise<boolean> {
	const prompt = createInterface({ input: process.stdin, output: process.stdout });
	const abort = new AbortController();
	prompt.on("SIGINT", () => {
		abort.abort();
		onCancel();
	});
	try {
		const answer = (await prompt.question(question, { signal: abort.signal })).trim().toLowerCase();
		return ["s", "si", "sí", "y", "yes"].includes(answer);
	} catch {
		return false;
	} finally {
		prompt.close();
	}
}
