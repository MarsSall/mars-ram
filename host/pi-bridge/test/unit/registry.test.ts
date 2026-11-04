import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type RegistryEntry } from "@workspace/protocol";
import { platformPermissions, posixPermissions } from "../../src/adapters/file-permissions.ts";
import { publishEntry, pruneStaleEntries, removeEntry } from "../../src/adapters/registry.ts";
import { createToken, tokensMatch } from "../../src/adapters/token.ts";

const entry = (instanceId: string, pid: number): RegistryEntry => ({
	protocolVersion: PROTOCOL_VERSION,
	bridgeInstanceId: instanceId,
	sessionId: "sess-1",
	port: 40000,
	token: "a".repeat(64),
	pid,
	cwd: "/work",
	startedAt: 1,
});

const roots: string[] = [];
const freshDir = () => {
	const root = mkdtempSync(join(tmpdir(), "registry-test-"));
	roots.push(root);
	return join(root, "bridges");
};
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("registry on POSIX hosts", () => {
	it("publishes an entry readable only by the owner, in a directory only the owner can enter", () => {
		const dir = freshDir();
		const path = publishEntry(dir, entry("inst-1", process.pid), posixPermissions);
		expect(path).toBe(join(dir, "inst-1.json"));
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(entry("inst-1", process.pid));
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(statSync(dir).mode & 0o777).toBe(0o700);
	});

	it("leaves no temporary files behind", () => {
		const dir = freshDir();
		publishEntry(dir, entry("inst-1", process.pid), posixPermissions);
		expect(readdirSync(dir)).toEqual(["inst-1.json"]);
	});

	it("rejects an instance id that could escape the registry directory", () => {
		const dir = freshDir();
		expect(() => publishEntry(dir, entry("../evil", process.pid), posixPermissions)).toThrow("Invalid bridge instance id");
	});

	it("removes an entry and tolerates removing it twice", () => {
		const dir = freshDir();
		const path = publishEntry(dir, entry("inst-1", process.pid), posixPermissions);
		removeEntry(path);
		removeEntry(path);
		expect(readdirSync(dir)).toEqual([]);
	});

	it("removes the temporary file when publishing fails, so no token is left behind", () => {
		const dir = freshDir();
		mkdirSync(join(dir, "inst-1.json"), { recursive: true });
		expect(() => publishEntry(dir, entry("inst-1", process.pid), posixPermissions)).toThrow();
		expect(readdirSync(dir)).toEqual(["inst-1.json"]);
	});

	it("removes the temporary file when restricting it fails", () => {
		const dir = freshDir();
		const failing = { ...posixPermissions, restrictFile: () => { throw new Error("denied"); } };
		expect(() => publishEntry(dir, entry("inst-1", process.pid), failing)).toThrow("denied");
		expect(readdirSync(dir)).toEqual([]);
	});

	it("prunes temporary files left by dead processes and keeps those of live ones", () => {
		const dir = freshDir();
		publishEntry(dir, entry("live", process.pid), posixPermissions);
		writeFileSync(join(dir, "a.json.20.tmp"), "token");
		writeFileSync(join(dir, "b.json.10.tmp"), "token");
		pruneStaleEntries(dir, (pid) => pid === 10 || pid === process.pid);
		expect(readdirSync(dir).sort()).toEqual(["b.json.10.tmp", "live.json"]);
	});

	it("prunes entries whose process is gone and keeps live and unreadable ones", () => {
		const dir = freshDir();
		publishEntry(dir, entry("live", 10), posixPermissions);
		publishEntry(dir, entry("dead", 20), posixPermissions);
		writeFileSync(join(dir, "notes.txt"), "not an entry");
		pruneStaleEntries(dir, (pid) => pid === 10);
		expect(readdirSync(dir).sort()).toEqual(["live.json", "notes.txt"]);
	});
});

describe("tokens", () => {
	it("creates 64 hex characters of randomness, different each time", () => {
		const a = createToken();
		expect(a).toMatch(/^[0-9a-f]{64}$/);
		expect(createToken()).not.toBe(a);
	});

	it.each([
		["the same token", "abc", "abc", true],
		["a different token", "abd", "abc", false],
		["a prefix", "ab", "abc", false],
		["an empty token", "", "abc", false],
	])("compares %s", (_name, given, expected, result) => {
		expect(tokensMatch(given, expected)).toBe(result);
	});
});

describe.runIf(process.platform === "win32")("registry on Windows hosts", () => {
	const powershell = (script: string, path: string) =>
		execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
			env: { ...process.env, TARGET: path },
			encoding: "utf8",
		}).trim();
	const ruleSids = (path: string) =>
		powershell(
			"(Get-Acl -LiteralPath $env:TARGET).Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } | Sort-Object -Unique",
			path,
		);
	const currentSid = () => powershell("[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value", ".");

	it("leaves only the current user on the directory and the entry, even if others had explicit access", () => {
		const dir = freshDir();
		mkdirSync(dir, { recursive: true });
		execFileSync("icacls", [dir, "/grant", "*S-1-1-0:(OI)(CI)F"], { stdio: "ignore" });
		const path = publishEntry(dir, entry("inst-1", process.pid), platformPermissions());
		expect(ruleSids(dir)).toBe(currentSid());
		expect(ruleSids(path)).toBe(currentSid());
	});
});
