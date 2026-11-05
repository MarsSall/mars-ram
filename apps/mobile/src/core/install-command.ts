/** The computer's shell family; Mac and Linux share the POSIX script. */
export type InstallSystem = "unix" | "windows";

const SCRIPTS = "https://marssall.github.io/mars-ram";

/** The one-line install shown on the welcome screen, run in a terminal on the computer. */
export function installCommand(system: InstallSystem): string {
 return system === "windows"
  ? `powershell -ExecutionPolicy Bypass -c "irm ${SCRIPTS}/install.ps1 | iex"`
  : `curl -fsSL ${SCRIPTS}/install.sh | sh`;
}
