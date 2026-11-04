import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { buildShortcutCommand, shortcutErrorKind, shortcutInitialStep, ShortcutHost } from "../src/core/shortcuts";

const record = { node: "/usr/bin/node", cli: "/opt/mars/main.ts" };
describe("shortcut launch commands", () => {
 it("passes a repo with spaces and quotes as one literal argument", () => {
  const path = `/home/me/Work/a 'quoted' \"repo\" $(false); $HOME`;
  const command = buildShortcutCommand(record, "launch", { repoPath: path, program: "pi" });
  const prefix = `'${record.node}' '${record.cli}'`;
  expect(command.startsWith(prefix)).toBe(true);
  const output = execFileSync("sh", ["-c", `printf '%s\\n' ${command.slice(prefix.length)}`], { encoding: "utf8" });
  expect(output.trimEnd().split("\n")).toEqual(["launch", "--repo", path, "--program", "pi", "--json"]);
 });
 it("sends the literal path through the SSH host and rejects malformed responses", async () => {
  const path = `/home/me/a 'strange' repo`;
  let command = ""; let stdout = JSON.stringify({ version: 1, ok: true, reused: false, workspace: "w1", tab: "w1:t1" });
  const service = new ShortcutHost({ connections: { connection: async () => ({ ok: true as const, connectionId: "c" }) }, host: { readFile: async () => ({ ok: true as const, content: JSON.stringify(record) }), exec: async (_id: string, value: string) => { command = value; return { ok: true as const, exitStatus: 0, stdout, stderr: "" }; } } } as never);
  const result = await service.launch({ id: "computer" } as never, path, "pi");
  expect(result.ok).toBe(true);
  const prefix = `'${record.node}' '${record.cli}'`;
  const args = execFileSync("sh", ["-c", `printf '%s\\n' ${command.slice(prefix.length)}`], { encoding: "utf8" }).trimEnd().split("\n");
  expect(args[2]).toBe(path);
  stdout = JSON.stringify({ version: 1, ok: true, reused: false, workspace: "w1", tab: "w2:t1" });
  expect((await service.launch({ id: "computer" } as never, path, "pi")).ok).toBe(false);
 });
 it("recognizes old host usage and unknown commands without masking transport failures", async () => {
  let stdout = "Usage: mars-ram <command>"; let stderr = ""; let exitStatus = 0; let transport = false;
  const service = new ShortcutHost({ connections: { connection: async () => ({ ok: true as const, connectionId: "c" }) }, host: { readFile: async () => ({ ok: true as const, content: JSON.stringify(record) }), exec: async () => transport ? { ok: false as const, code: "OFFLINE" } : { ok: true as const, exitStatus, stdout, stderr } } } as never);
  expect(await service.repos({} as never)).toEqual({ ok: false, code: "HOST_OUTDATED" });
  stdout = ""; stderr = "Unknown command: launch"; exitStatus = 1;
  expect(await service.launch({} as never, "/repo", "pi")).toEqual({ ok: false, code: "HOST_OUTDATED" });
  transport = true;
  expect(await service.repos({} as never)).toEqual({ ok: false, code: "OFFLINE" });
  expect(shortcutErrorKind("HOST_OUTDATED")).toBe("hostOutdated");
 });
 it("rejects unsafe Windows command arguments and unknown programs", () => {
  const windows = { node: "C:\\node\\node.exe", cli: "C:\\app\\main.ts" };
  expect(() => buildShortcutCommand(windows, "launch", { repoPath: "C:\\Work\\%TEMP%", program: "pi" })).toThrow();
  expect(() => buildShortcutCommand(windows, "launch", { repoPath: "C:\\Work\\", program: "pi" })).toThrow();
  expect(buildShortcutCommand(windows, "launch", { repoPath: "C:\\Work\\my repo", program: "pi" })).toContain('"C:\\Work\\my repo"');
  expect(() => buildShortcutCommand(record, "launch", { repoPath: "/x", program: "bad" as never })).toThrow();
  expect(() => buildShortcutCommand(record, "launch", { repoPath: "/x\\evil", program: "pi" })).toThrow();
 });
 it("selects the initial guided step and maps errors", () => {
  expect(shortcutInitialStep(1)).toBe("repo");
  expect(shortcutInitialStep(2)).toBe("computer");
  expect(shortcutInitialStep(0)).toBe("computer");
  expect(shortcutErrorKind("PROGRAM_NOT_FOUND")).toBe("programMissing");
  expect(shortcutErrorKind("REPO_NOT_ALLOWED")).toBe("repoUnavailable");
  expect(shortcutErrorKind("HERDR_UNAVAILABLE")).toBe("herdrUnavailable");
  expect(shortcutErrorKind("unexpected")).toBe("failed");
 });
});
