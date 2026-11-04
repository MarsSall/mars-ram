// Session shortcuts and the versioned host CLI contract. No platform dependencies.
import type { SavedHost } from "./host-catalog";
import type { HostConnections } from "./host-connections";
import type { HostConnection } from "./ports";
import type { KeyCommandConfig } from "./key-security";
import { buildHerdrCommand } from "./herdr-switcher";
import { readHostRecord } from "./host-record";
export type Program = "gentle-shell" | "pi" | "opencode";
export type Shortcut = { id: string; computerId: string; repoPath: string; repoName: string; program: Program };
export type Repo = { path: string; name: string; root: string };
export type ShortcutError = { version: 1; ok: false; code: string; message: string };
export type ReposResponse = { version: 1; ok: true; roots: string[]; repos: Repo[]; truncated: boolean } | ShortcutError;
export type LaunchResponse = { version: 1; ok: true; reused: boolean; workspace: string; tab: string } | ShortcutError;
export const isProgram = (v: unknown): v is Program => v === "gentle-shell" || v === "pi" || v === "opencode";
export const programNames: Record<Program, string> = { "gentle-shell": "Gentle Shell", pi: "Pi", opencode: "OpenCode" };
export const shortcutLabel = (v: Shortcut) => `${v.repoName} · ${programNames[v.program]}`;
export const SHORTCUT_LIMIT = 500;
export function addShortcut(rows: readonly Shortcut[], item: Shortcut): Shortcut[] {
 if (!isProgram(item.program)) throw Error("Invalid program");
 if (rows.some(v => v.computerId === item.computerId && v.repoPath === item.repoPath && v.program === item.program)) return [...rows];
 if (rows.length >= SHORTCUT_LIMIT) throw Error("SHORTCUT_LIMIT");
 return [...rows, item];
}
export const removeShortcut = (rows: readonly Shortcut[], id: string): Shortcut[] => rows.filter(v => v.id !== id);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const text = (v: unknown, max = 4096): v is string => typeof v === "string" && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f-\x9f]/.test(v);
const absolute = (v: unknown): v is string => text(v) && /^(?:\/|[A-Za-z]:[\\/])/.test(v) && !v.split(/[\\/]/).includes("..");
export function parseStoredShortcuts(raw: string): Shortcut[] {
 try {
  const value: unknown = JSON.parse(raw);
  if (!object(value) || !keys(value, ["version", "shortcuts"]) || value.version !== 1 || !Array.isArray(value.shortcuts)) return [];
  const ids = new Set<string>(); const identities = new Set<string>();
  for (const row of value.shortcuts) {
   if (!object(row) || !keys(row, ["id", "computerId", "repoPath", "repoName", "program"]) || !text(row.id, 256) || !text(row.computerId, 256) || !absolute(row.repoPath) || !text(row.repoName, 1024) || !isProgram(row.program)) return [];
   const identity = JSON.stringify([row.computerId, row.repoPath, row.program]);
   if (ids.has(row.id) || identities.has(identity)) return [];
   ids.add(row.id); identities.add(identity);
  }
  return value.shortcuts as Shortcut[];
 } catch { return []; }
}
const codes = ["BAD_ARGUMENT", "PROGRAM_NOT_ALLOWED", "PROGRAM_NOT_FOUND", "REPO_NOT_ALLOWED", "HERDR_UNAVAILABLE", "CONFIG_FAILED", "LOCAL_ONLY"];
function decode(stdout: string): Record<string, unknown> {
 if (stdout.length > 4 * 1024 * 1024) throw Error("Output too large");
 const data: unknown = JSON.parse(stdout);
 if (!object(data) || data.version !== 1 || typeof data.ok !== "boolean") throw Error("Invalid response");
 return data;
}
function failure(v: Record<string, unknown>): ShortcutError {
 if (!keys(v, ["version", "ok", "code", "message"]) || v.ok !== false || !codes.includes(v.code as string) || !text(v.message, 1024)) throw Error("Invalid error");
 return v as ShortcutError;
}
export function parseRepos(stdout: string): ReposResponse {
 const v = decode(stdout); if (!v.ok) return failure(v);
 if (!keys(v, ["version", "ok", "roots", "repos", "truncated"]) || !Array.isArray(v.roots) || v.roots.length > 500 || !v.roots.every(absolute) || !Array.isArray(v.repos) || v.repos.length > 500 || typeof v.truncated !== "boolean" || !v.repos.every(r => object(r) && keys(r, ["path", "name", "root"]) && absolute(r.path) && text(r.name, 1024) && absolute(r.root))) throw Error("Invalid repos");
 return v as ReposResponse;
}
export const shortcutInitialStep = (computers: number): "computer" | "repo" => computers === 1 ? "repo" : "computer";
export function shortcutErrorKind(code: string): "programMissing" | "repoUnavailable" | "herdrUnavailable" | "hostOutdated" | "storageFailed" | "locked" | "failed" {
 if (code === "STORAGE_FAILED") return "storageFailed";
 if (code === "HOST_OUTDATED") return "hostOutdated";
 if (code === "PROGRAM_NOT_FOUND") return "programMissing";
 if (code === "REPO_NOT_ALLOWED") return "repoUnavailable";
 if (code === "HERDR_UNAVAILABLE") return "herdrUnavailable";
 if (code === "UNLOCK_REQUIRED") return "locked";
 return "failed";
}
/** The SSH port accepts a command string; only the repo path is variable. On POSIX,
 * single-quote it as one shell word. Windows accepts a conservative subset, because
 * cmd and PowerShell cannot share a safe quoting scheme for arbitrary characters. */
export function buildShortcutCommand(record: KeyCommandConfig, verb: "repos" | "launch", options?: { repoPath: string; program: Program }): string {
 const prefix = buildHerdrCommand(record, "list").replace(/ herdr list$/, "");
 if (verb === "repos") { if (options) throw Error("Unexpected options"); return `${prefix} repos --json`; }
 if (verb !== "launch" || !options || !absolute(options.repoPath) || !isProgram(options.program)) throw Error("Invalid launch arguments");
 const windows = !record.node.startsWith("/");
 if (windows && (!/^[A-Za-z]:[\\\\/][A-Za-z0-9._ \\\\/-]*$/.test(options.repoPath) || options.repoPath.endsWith("\\"))) throw Error("Unsafe Windows path");
 // fish treats backslashes specially inside single quotes, unlike POSIX sh.
 if (!windows && (!options.repoPath.startsWith("/") || options.repoPath.includes("\\"))) throw Error("Unsafe POSIX path");
 const path = windows ? `"${options.repoPath}"` : `'${options.repoPath.replace(/'/g, "'\\''")}'`;
 return `${prefix} launch --repo ${path} --program ${options.program} --json`;
}
export type ShortcutResult<T> = { ok: true; value: T } | { ok: false; code: string };
export class ShortcutHost {
 constructor(private readonly deps: { host: Pick<HostConnection, "readFile" | "exec">; connections: Pick<HostConnections, "connection"> }) {}
 private async run<T extends ReposResponse | LaunchResponse>(computer: SavedHost, verb: "repos" | "launch", parse: (stdout: string) => T, options?: { repoPath: string; program: Program }): Promise<ShortcutResult<Extract<T, { ok: true }>>> {
  try {
   const connection = await this.deps.connections.connection(computer);
   if (!connection.ok) return { ok: false, code: connection.code };
   const record = await readHostRecord(this.deps.host, connection.connectionId);
   let command: string;
   try { command = buildShortcutCommand(record as KeyCommandConfig, verb, options); } catch { return { ok: false, code: "INVALID_COMMAND" }; }
   const result = await this.deps.host.exec(connection.connectionId, command);
   if (!result.ok) return { ok: false, code: result.code };
   if (result.exitStatus === 127 || result.exitStatus === 9009) return { ok: false, code: "CLI_MISSING" };
   const output = `${result.stdout}\n${result.stderr}`.trim();
   if (/^Usage:\s*mars-ram\b/i.test(output) || /^(?:error:\s*)?(?:unknown|unrecognized|invalid) command\b/i.test(output)) return { ok: false, code: "HOST_OUTDATED" };
   const value = parse(result.stdout);
   if (!value.ok) return result.exitStatus !== 0 ? { ok: false, code: value.code } : { ok: false, code: "INVALID_RESPONSE" };
   if (result.exitStatus !== 0) return { ok: false, code: "INVALID_RESPONSE" };
   return { ok: true, value: value as Extract<T, { ok: true }> };
  } catch { return { ok: false, code: "FAILED" }; }
 }
 repos(computer: SavedHost) { return this.run(computer, "repos", parseRepos); }
 launch(computer: SavedHost, repoPath: string, program: Program) { return this.run(computer, "launch", parseLaunch, { repoPath, program }); }
}
export function parseLaunch(stdout: string): LaunchResponse {
 const v = decode(stdout); if (!v.ok) return failure(v);
 if (!keys(v, ["version", "ok", "reused", "workspace", "tab"]) || typeof v.reused !== "boolean" || typeof v.workspace !== "string" || !/^w[A-Za-z0-9]{1,63}$/.test(v.workspace) || typeof v.tab !== "string" || !/^w[A-Za-z0-9]{1,63}:t[A-Za-z0-9]{1,63}$/.test(v.tab) || !v.tab.startsWith(`${v.workspace}:`)) throw Error("Invalid launch");
 return v as LaunchResponse;
}
