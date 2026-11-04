import { describe, expect, it } from "vitest";
import { WINDOWS_ACL_SCRIPT, windowsPermissionsWith, type PowerShellRunner } from "../../src/adapters/file-permissions.ts";

describe("Windows registry permissions", () => {
	it("writes only the access list through .NET, because Set-Acl also needs SeSecurityPrivilege on a folder an elevated bridge created", () => {
		expect(WINDOWS_ACL_SCRIPT).toContain("SetAccessControl");
		expect(WINDOWS_ACL_SCRIPT).not.toMatch(/Set-Acl/i);
	});

	it("passes the path in the environment, never inside the script", () => {
		const calls: { path: string }[] = [];
		const run: PowerShellRunner = (script, path) => {
			calls.push({ path });
			expect(script).not.toContain(path);
		};
		windowsPermissionsWith(run).restrictDirectory("C:\\Users\\me\\.mars-ram\\bridges");
		expect(calls).toEqual([{ path: "C:\\Users\\me\\.mars-ram\\bridges" }]);
	});

	it("explains a failure with PowerShell's own message instead of hiding it", () => {
		const run: PowerShellRunner = () => {
			throw Object.assign(new Error("Command failed: powershell.exe -NoLogo ..."), {
				stderr: "Exception calling \"SetAccessControl\": Attempted to perform an unauthorized operation.\r\nAt line:1 char:1\r\n",
			});
		};
		expect(() => windowsPermissionsWith(run).restrictFile("C:\\x\\entry.json.tmp")).toThrow(
			'Could not restrict access to C:\\x\\entry.json.tmp: Exception calling "SetAccessControl": Attempted to perform an unauthorized operation.',
		);
	});
});
