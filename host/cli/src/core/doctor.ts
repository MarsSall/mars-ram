// Diagnostic policy: ports expose observations only, never repairs.
export type Finding = { status: "ok" | "warning" | "problem"; finding: string; fix?: string };
export type RegistryObservation = { exists: boolean; entries: { name: string; pid?: number }[]; directoryMode?: number; modes: (number | undefined)[] };
export type WindowsDefaultShell = "cmd" | "powershell" | "other";
export interface DoctorPorts {
	platform: NodeJS.Platform;
	spanish: boolean;
	piVersion(): Promise<string>;
 herdr(): Promise<boolean>;
 /** command: the first mars-ram on PATH (path only). packageMode: install.json records that `mars-ram install` ran from the npm package. */
 cli(): Promise<{ resolved: boolean; command?: string; current: boolean; localBin: boolean; packageMode?: boolean }>;
 linkServer(): Promise<{ present: boolean; current: boolean; configured: boolean; validLinks: number; listener: boolean; notificationsRegistered?: boolean }>;
	installation(): Promise<{ present: boolean; current: boolean; homes: { path: string; registered: boolean }[] }>;
	registry(): Promise<RegistryObservation>;
	alive(pid: number): boolean;
	acl(): Promise<{ safe: boolean; administratorOwner: boolean }>;
	tailscale(): Promise<string>;
 keyLocks(): Promise<(string | { path: string; diagnostic: string })[]>;
	forwarding(): Promise<{ allowed: boolean | undefined; keysAllowed: boolean | undefined }>;
	windows(): Promise<{ service: boolean; shell: WindowsDefaultShell }>;
}
const say = (p: DoctorPorts, en: string, es: string) => p.spanish ? es : en;
const result = (status: Finding["status"], finding: string, fix?: string): Finding => ({ status, finding, ...(fix ? { fix } : {}) });
const installFix = (p: DoctorPorts) => say(p, "Run mars-ram install from this checkout.", "Ejecutá mars-ram install desde este repositorio.");

export async function checkPi(p: DoctorPorts): Promise<Finding[]> {
	let version: string;
	try { version = (await p.piVersion()).trim(); } catch {
		return [result("problem", say(p, "Pi is unavailable on PATH.", "Pi no está disponible en PATH."), say(p, "Install Pi and add it to PATH.", "Instalá Pi y agregalo a PATH."))];
	}
	const match = version.match(/\b(\d+)\.(\d+)\.(\d+)(-[\w.-]+)?/);
	const supported = !!match && (Number(match[1]) > 1 || (Number(match[1]) === 1 && (Number(match[2]) > 2 || (Number(match[2]) === 2 && (Number(match[3]) > 0 || !match[4])))));
	return [result(supported ? "ok" : "warning", `Pi: ${version.replace(/[\r\n]+/g, " ")}`, supported ? undefined : say(p, "Update Pi to 1.2.0 or newer; the bridge needs getSettings.", "Actualizá Pi a 1.2.0 o posterior; el bridge necesita getSettings."))];
}

export async function checkCli(p: DoctorPorts): Promise<Finding[]> {
 const state = await p.cli();
 const copy = result(state.current ? "ok" : "warning", say(p, state.current ? "CLI copy matches current sources." : "CLI copy is outdated or missing.", state.current ? "La copia del CLI coincide con el código actual." : "La copia del CLI está desactualizada o ausente."), state.current ? undefined : state.packageMode ? say(p, "Run mars-ram install.", "Ejecutá mars-ram install.") : installFix(p));
 // From the package, install writes no launcher of its own. Doctor only names the command PATH finds; it warns
 // only for what it can prove: nothing found, or the installer's own launcher, which install retires.
 if (state.packageMode) return [
  !state.command ? result("warning", say(p, "mars-ram is not on PATH.", "mars-ram no está en PATH."), say(p, "Open a new terminal or check the pnpm/npm install (pnpm setup).", "Abrí una terminal nueva o revisá la instalación de pnpm/npm (pnpm setup)."))
   : state.resolved ? result("warning", say(p, "mars-ram on PATH is the old launcher from mars-ram install;", "mars-ram en PATH es el lanzador anterior de mars-ram install;"), say(p, "run mars-ram install again to retire it.", "ejecutá mars-ram install de nuevo para retirarlo."))
   : result("ok", say(p, `mars-ram on PATH: ${state.command}`, `mars-ram en PATH: ${state.command}`)),
  copy,
 ];
 const results = [
  result(state.resolved ? "ok" : "warning", say(p, state.resolved ? "mars-ram on PATH resolves to the installed launcher." : "mars-ram on PATH does not resolve to the installed launcher.", state.resolved ? "mars-ram en PATH corresponde al lanzador instalado." : "mars-ram en PATH no corresponde al lanzador instalado."), state.resolved ? undefined : say(p, "Run install from a clone, check PATH order and open a new terminal.", "Ejecutá install desde un clon, revisá el orden de PATH y abrí una terminal nueva.")),
  copy,
 ];
 if (p.platform === "linux") results.push(result(state.localBin ? "ok" : "warning", say(p, `~/.local/bin ${state.localBin ? "is" : "is not"} on PATH.`, `~/.local/bin ${state.localBin ? "está" : "no está"} en PATH.`), state.localBin ? undefined : "fish: fish_add_path ~/.local/bin; bash/zsh: export PATH=\"$HOME/.local/bin:$PATH\""));
 return results;
}

export async function checkHerdr(p: DoctorPorts): Promise<Finding[]> {
 let present = false;
 try { present = await p.herdr(); } catch { /* Missing, unreadable or invalid host record. */ }
 return [result(present ? "ok" : "warning", say(p, present ? "Herdr executable recorded in host.json." : "Herdr is missing or moved (host.json).", present ? "Ejecutable Herdr registrado en host.json." : "Herdr no está instalado o se movió (host.json)."), present ? undefined : say(p, "Install Herdr and run mars-ram install again.", "Instalá Herdr y ejecutá mars-ram install de nuevo."))];
}

export async function checkInstallation(p: DoctorPorts): Promise<Finding[]> {
	const install = await p.installation();
	const results = [result(install.present ? "ok" : "warning", say(p, `Bridge install.json ${install.present ? "present" : "missing"}.`, `install.json del bridge ${install.present ? "presente" : "ausente"}.`), install.present ? undefined : installFix(p))];
	for (const home of install.homes) results.push(result(home.registered ? "ok" : "warning", say(p, `Bridge registration in ${home.path}: ${home.registered ? "installed" : "missing"}.`, `Registro del bridge en ${home.path}: ${home.registered ? "instalado" : "ausente"}.`), home.registered ? undefined : installFix(p)));
	if (!install.homes.length) results.push(result("warning", say(p, "No Pi homes found.", "No se encontraron entornos Pi."), say(p, "Start Pi once, then run mars-ram install.", "Iniciá Pi una vez y después ejecutá mars-ram install.")));
	if (install.present) results.push(result(install.current ? "ok" : "warning", say(p, install.current ? "Bridge copy matches current sources." : "Bridge copy is outdated or missing.", install.current ? "La copia del bridge coincide con el código actual." : "La copia del bridge está desactualizada o ausente."), install.current ? undefined : installFix(p)));
	return results;
}

export async function checkRegistry(p: DoctorPorts): Promise<Finding[]> {
	const registry = await p.registry();
	const live = registry.entries.filter((entry) => entry.pid !== undefined && p.alive(entry.pid));
	const results = [result(live.length ? "ok" : "warning", say(p, `Bridge loaded: ${live.length} live registry entries.`, `Bridge cargado: ${live.length} entradas activas en el registro.`), live.length ? undefined : say(p, "Start Pi with the installed bridge, or use /reload.", "Iniciá Pi con el bridge instalado o usá /reload."))];
	for (const entry of registry.entries.filter((entry) => !live.includes(entry))) results.push(result("warning", say(p, `Stale or invalid bridge entry: ${entry.name}.`, `Entrada del bridge obsoleta o inválida: ${entry.name}.`), say(p, "Start a Pi session; stale entries are pruned on the next bridge start.", "Iniciá una sesión Pi; el próximo inicio del bridge limpia las entradas obsoletas.")));
	return results;
}

export async function checkPermissions(p: DoctorPorts): Promise<Finding[]> {
	if (p.platform === "win32") {
		const acl = await p.acl();
		const results = [result(acl.safe ? "ok" : "problem", say(p, `Mars-RAM ACL and owner: ${acl.safe ? "restricted" : "unsafe"}.`, `ACL y propietario de Mars-RAM: ${acl.safe ? "restringidos" : "inseguros"}.`), acl.safe ? undefined : say(p, "Use Windows Security advanced permissions to allow only your account, SYSTEM and Administrators, including ownership and child entries.", "Usá los permisos avanzados de Seguridad de Windows para permitir solo tu cuenta, SYSTEM y Administradores, también en el propietario y las entradas hijas."))];
		if (acl.administratorOwner) results.push(result("warning", say(p, "Mars-RAM is owned by Administrators (L9).", "Mars-RAM pertenece a Administradores (L9)."), say(p, "If the folder is empty, remove it yourself and start Pi in a non-elevated terminal so it is recreated as your user; otherwise ask an administrator to transfer ownership without deleting paired data.", "Si la carpeta está vacía, eliminala vos e iniciá Pi sin elevar para recrearla como tu usuario; si no, pedí a un administrador que transfiera la propiedad sin borrar datos emparejados.")));
		return results;
	}
	const registry = await p.registry();
	if (!registry.exists) return [result("warning", say(p, "Bridge registry does not exist yet.", "El registro del bridge todavía no existe."), say(p, "Start Pi with the installed bridge to create it securely.", "Iniciá Pi con el bridge instalado para crearlo con permisos seguros."))];
	const safe = registry.directoryMode === 0o700 && registry.modes.every((mode) => mode === 0o600);
	return [result(safe ? "ok" : "problem", say(p, `Registry/token permissions: ${safe ? "0700 directory, 0600 entries" : "unsafe or unreadable"}.`, `Permisos de registro/tokens: ${safe ? "directorio 0700, entradas 0600" : "inseguros o ilegibles"}.`), safe ? undefined : say(p, "Set ~/.mars-ram/bridges to mode 0700 and each registry/token file inside to 0600 with chmod.", "Usá chmod para poner ~/.mars-ram/bridges en 0700 y cada archivo de registro/token dentro en 0600."))];
}
export async function checkLinkServer(p: DoctorPorts): Promise<Finding[]> {
	const state = await p.linkServer();
 const installed = state.present && state.current;
 return [
  ...(state.notificationsRegistered && !state.listener ? [result('warning', say(p, 'Always-attentive notifications need the link server running.', 'Los avisos de Siempre atento necesitan el servidor de enlaces en ejecución.'), say(p, 'Enable the mode again from the phone to ensure the server. No permanent service is installed.', 'Activá de nuevo el modo desde el teléfono para iniciar el servidor. No se instala un servicio permanente.'))] : []),
  result(installed ? "ok" : "warning", say(p, installed ? "Link-server copy matches current sources." : "Link-server copy missing or outdated.", installed ? "La copia del servidor de enlaces coincide con el código actual." : "Copia del servidor de enlaces ausente o desactualizada."), installed ? undefined : installFix(p)),
  result(state.configured ? "ok" : "warning", say(p, state.configured ? "Link-server host.json paths and port valid." : "Link-server host.json paths or port missing/invalid.", state.configured ? "Rutas y puerto del servidor de enlaces válidos en host.json." : "Rutas o puerto del servidor de enlaces ausentes o inválidos en host.json."), state.configured ? undefined : installFix(p)),
  result(!state.listener && state.validLinks ? "warning" : "ok", say(p,
   `Link server: ${state.validLinks} valid links; ${state.listener ? "serving identity confirmed" : "no confirmed listener (idle/offline)"}.`,
   `Servidor de enlaces: ${state.validLinks} enlaces vigentes; ${state.listener ? "identidad del servidor confirmada" : "sin listener confirmado (inactivo/desconectado)"}.`),
   !state.listener && state.validLinks ? say(p, "Connect the phone to ensure serving. Doctor status never prunes expired links or starts the server.", "Conectá el teléfono para asegurar el servicio. El estado no limpia enlaces vencidos ni inicia el servidor.") : undefined),
 ];
}
export async function checkTailscale(p: DoctorPorts): Promise<Finding[]> {
	try { return [result("ok", `Tailscale: ${await p.tailscale()}`)]; } catch {
		return [result("problem", say(p, "Tailscale IPv4 unavailable.", "IPv4 de Tailscale no disponible."), say(p, "Install Tailscale, sign in and connect; verify tailscale ip -4.", "Instalá Tailscale, iniciá sesión y conectalo; verificá tailscale ip -4."))];
	}
}
export async function checkForwarding(p: DoctorPorts): Promise<Finding[]> {
	const unknown = () => result("warning", say(p, "Could not determine SSH TCP forwarding.", "No se pudo determinar el reenvío TCP SSH."), say(p, "Check sshd_config, its Includes and Match blocks; ask an administrator to inspect sshd -T.", "Revisá sshd_config, sus Include y bloques Match; pedí a un administrador revisar sshd -T."));
	let state: Awaited<ReturnType<DoctorPorts["forwarding"]>>;
	try { state = await p.forwarding(); } catch { return [unknown()]; }
	return [state.allowed === undefined ? unknown() : result(state.allowed ? "ok" : "problem", say(p, `SSH TCP forwarding: ${state.allowed ? "allowed" : "disabled"}.`, `Reenvío TCP SSH: ${state.allowed ? "permitido" : "deshabilitado"}.`), state.allowed ? undefined : say(p, "Ask an administrator to set AllowTcpForwarding yes and DisableForwarding no in sshd_config (including Match blocks), then reload sshd.", "Pedí a un administrador AllowTcpForwarding yes y DisableForwarding no en sshd_config (también en bloques Match) y recargar sshd.")),
		state.keysAllowed === undefined ? result("warning", say(p, "Paired SSH keys: unreadable; forwarding unknown.", "Claves SSH emparejadas: ilegibles; reenvío desconocido."), say(p, "Check read access to authorized_keys, then run doctor again.", "Verificá acceso de lectura a authorized_keys y volvé a ejecutar doctor.")) : result(state.keysAllowed ? "ok" : "warning", say(p, `Paired SSH keys: forwarding ${state.keysAllowed ? "allowed (or no paired keys)" : "restricted"}.`, `Claves SSH emparejadas: reenvío ${state.keysAllowed ? "permitido (o sin claves)" : "restringido"}.`), state.keysAllowed ? undefined : say(p, "Review the mars-ram: lines in authorized_keys; after a backup, allow port-forwarding and remove no-port-forwarding only for trusted paired keys.", "Revisá las líneas mars-ram: en authorized_keys; con un respaldo, permití port-forwarding y quitá no-port-forwarding solo para claves emparejadas confiables."))];
}
export async function checkKeyLocks(p: DoctorPorts): Promise<Finding[]> {
 try {
  return (await p.keyLocks()).map(entry => {
   if (typeof entry !== 'string') return result('warning', `${entry.path}: ${entry.diagnostic}`, entry.diagnostic);
   const path = entry;
   return result('warning', say(p, `Stale authorized_keys lock: ${path}`, `Bloqueo obsoleto de authorized_keys: ${path}`),
    say(p, `A previous key change was interrupted; delete ${path} and try again`, `Un cambio de clave anterior se interrumpió; eliminá ${path} y reintentá`));
  });
 } catch {
  return [result('warning', say(p, 'Could not inspect authorized_keys locks.', 'No se pudieron inspeccionar los bloqueos de authorized_keys.'), say(p, 'Check read access and run doctor again.', 'Verificá acceso de lectura y volvé a ejecutar doctor.'))];
 }
}
export async function checkWindows(p: DoctorPorts): Promise<Finding[]> {
	if (p.platform !== "win32") return [];
	const state = await p.windows();
	return [result(state.service ? "ok" : "problem", say(p, `OpenSSH Server (sshd): ${state.service ? "running" : "missing or stopped"}.`, `OpenSSH Server (sshd): ${state.service ? "en ejecución" : "ausente o detenido"}.`), state.service ? undefined : say(p, "Install the Windows OpenSSH Server optional feature, then run Start-Service sshd as administrator.", "Instalá la característica opcional OpenSSH Server y ejecutá Start-Service sshd como administrador.")),
		state.shell === "cmd"
			? result("ok", say(p, "SSH default shell: cmd (explicit or default); required by the phone terminal.", "Shell SSH predeterminado: cmd (explícito o por defecto); es el que necesita la terminal del teléfono."))
			: result("warning", state.shell === "powershell"
				? say(p, "SSH default shell: PowerShell; the phone terminal will not open.", "Shell SSH predeterminado: PowerShell; la terminal del teléfono no abrirá.")
				: say(p, "SSH default shell: other shell; untested with the phone terminal.", "Shell SSH predeterminado: otro shell; no probado con la terminal del teléfono."),
				say(p, "Run in administrator PowerShell: Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\OpenSSH' -Name DefaultShell", "Ejecutá en PowerShell como administrador: Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\OpenSSH' -Name DefaultShell"))];
}
export async function diagnose(p: DoctorPorts): Promise<{ code: number; results: Finding[] }> {
	const results: Finding[] = [];
	for (const check of [checkPi, checkHerdr, checkCli, checkInstallation, checkRegistry, checkPermissions, checkLinkServer, checkTailscale, checkForwarding, checkKeyLocks, checkWindows]) {
		try { results.push(...await check(p)); } catch {
			results.push(result("problem", say(p, `Cannot read diagnostic data (${check.name}).`, `No se pudo leer el diagnóstico (${check.name}).`), say(p, "Check read access to the relevant configuration and diagnostic commands, then run doctor again.", "Verificá acceso de lectura a la configuración y los comandos de diagnóstico y volvé a ejecutar doctor.")));
		}
	}
	return { code: results.some((r) => r.status === "problem") ? 1 : 0, results };
}
