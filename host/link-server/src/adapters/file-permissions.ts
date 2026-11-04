import { execFileSync } from "node:child_process";
import { chmodSync } from "node:fs";

// Minimal user-only ACL adapter copied from pi-bridge; no cross-package runtime import.
const ACL_SCRIPT = `
$ErrorActionPreference = 'Stop'
$path = $env:LINKS_ACL_PATH
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
export function restrict(path: string, directory: boolean): void {
	if (process.platform !== "win32") { chmodSync(path, directory ? 0o700 : 0o600); return; }
	try {
		execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", ACL_SCRIPT], {
			env: { ...process.env, LINKS_ACL_PATH: path }, stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
		});
	} catch { throw new Error("Could not restrict link storage to the current user."); }
}
