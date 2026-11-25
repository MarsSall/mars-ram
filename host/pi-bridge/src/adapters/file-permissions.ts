// Restrict registry files to the host user. Moved to the protocol package's host-only entry point,
// shared with the CLI's agent bridges.
export {
	type FilePermissions,
	platformPermissions,
	posixPermissions,
	type PowerShellRunner,
	WINDOWS_ACL_SCRIPT,
	windowsPermissions,
	windowsPermissionsWith,
} from "@workspace/protocol/bridge-host";
