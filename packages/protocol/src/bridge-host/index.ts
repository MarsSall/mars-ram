// Host-only adapters shared by the Pi bridge (host/pi-bridge) and the CLI's agent bridges (host/cli). Node only:
// the app never imports this entry point. Installed with the protocol package, so both installed copies carry it.
export { createToken, tokensMatch } from "./token.ts";
export { type FilePermissions, platformPermissions, posixPermissions, type PowerShellRunner, WINDOWS_ACL_SCRIPT, windowsPermissions, windowsPermissionsWith } from "./file-permissions.ts";
export { preparePrivateDirectory, processIsAlive, publishEntry, publishPrivateJson, pruneStaleEntries, removeEntry } from "./registry.ts";
export { createHerdrTerminal, type TerminalExecFile, type TerminalPort, type TerminalResult } from "./herdr-terminal.ts";
export { type HookChannel, type HttpBridgeServer, type HttpServerOptions, type HttpSession, type Result, startHttpServer } from "./http-server.ts";
export { type RunningInstance, stopInstance } from "./lifecycle.ts";
