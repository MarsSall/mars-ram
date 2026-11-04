// Restrict registry files to the host user. One adapter per platform.
import { execFileSync } from "node:child_process";
import { chmodSync } from "node:fs";

export type FilePermissions = {
	restrictDirectory(path: string): void;
	restrictFile(path: string): void;
};

export const posixPermissions: FilePermissions = {
	restrictDirectory: (path) => chmodSync(path, 0o700),
	restrictFile: (path) => chmodSync(path, 0o600),
};

// Replaces the whole access list with one rule for the current user's SID,
// dropping inherited and explicit rules for anyone else. The path travels in
// an environment variable, never inside the script text. SetAccessControl
// writes only the access list: Set-Acl also rewrites the audit list, which
// needs SeSecurityPrivilege when an elevated bridge created and restricted
// the folder before, so a normal Pi session could not start its bridge.
export const WINDOWS_ACL_SCRIPT = `
$ErrorActionPreference = 'Stop'
$path = $env:BRIDGE_ACL_PATH
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$item = Get-Item -LiteralPath $path -Force
if ($item -is [System.IO.DirectoryInfo]) {
	$acl = New-Object System.Security.AccessControl.DirectorySecurity
	$inherit = 'ContainerInherit, ObjectInherit'
} else {
	$acl = New-Object System.Security.AccessControl.FileSecurity
	$inherit = 'None'
}
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inherit, 'None', 'Allow')))
$item.SetAccessControl($acl)
`;

/** Runs the script with the path in BRIDGE_ACL_PATH; throws with PowerShell's stderr on failure. */
export type PowerShellRunner = (script: string, path: string) => void;

const runPowerShell: PowerShellRunner = (script, path) => {
	execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
		env: { ...process.env, BRIDGE_ACL_PATH: path },
		stdio: ["ignore", "ignore", "pipe"],
		windowsHide: true,
	});
};

export function windowsPermissionsWith(run: PowerShellRunner): FilePermissions {
	const grantOnlyCurrentUser = (path: string) => {
		try {
			run(WINDOWS_ACL_SCRIPT, path);
		} catch (error) {
			const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim().split(/\r?\n/)[0];
			throw new Error(`Could not restrict access to ${path}: ${stderr || (error as Error).message}`);
		}
	};
	return { restrictDirectory: grantOnlyCurrentUser, restrictFile: grantOnlyCurrentUser };
}

export const windowsPermissions: FilePermissions = windowsPermissionsWith(runPowerShell);

export function platformPermissions(platform: NodeJS.Platform = process.platform): FilePermissions {
	return platform === "win32" ? windowsPermissions : posixPermissions;
}
