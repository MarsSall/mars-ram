import type { SavedHost } from "./host-catalog";
import type { HostConnections } from "./host-connections";
import type { HostConnection } from "./ports";
import type { KeyCommandConfig } from "./key-security";
import { buildHerdrCommand } from "./herdr-switcher";
import { readHostRecord } from "./host-record";

// Read-only project browser (odd/tasks/project-files.md L7, L9, L10): the phone names a
// verb and validated options; the host resolves the Herdr workspace's project root.
export type ProjectVerb = "tree" | "file" | "status" | "diff" | "log" | "show" | "branches" | "stage-link";
export type ProjectOptions = { workspace?: string; path?: string; commit?: string; limit?: number };
export type EntryKind = "dir" | "file" | "link" | "other";
export type TreeEntry = { name: string; kind: EntryKind; size: number | null; mtime: number };
export type ProjectTree = { version: 1; root: { name: string; path: string; workspace: string; branch: string | null; git: boolean }; path: string; entries: TreeEntry[]; truncated: boolean };
export type ProjectFile = { version: 1; path: string; size: number; mtime: number; kind: "text" | "image" | "binary"; language: string | null; content: string | null; truncated: boolean };
export type ChangeStatus = "M" | "A" | "D" | "R" | "?";
export type Change = { path: string; status: ChangeStatus; added: number | null; removed: number | null };
export type Commit = { hash: string; subject: string; time: number };
export type ProjectStatus = { version: 1; branch: string | null; ahead: number; behind: number; lastCommit: Commit | null; changes: Change[]; truncated: boolean };
export type ProjectDiff = { version: 1; path: string; commit: string | null; diff: string; truncated: boolean };
export type ProjectLog = { version: 1; commits: Commit[] };
export type ProjectShow = { version: 1; commit: Commit; files: Change[]; truncated: boolean };
export type Branch = { name: string; current: boolean; upstream: string | null; ahead: number | null; behind: number | null };
export type ProjectBranches = { version: 1; current: string | null; branches: Branch[]; truncated: boolean };
export type ProjectStaged = { version: 1; staged: string };
export type ProjectValue = { tree: ProjectTree; file: ProjectFile; status: ProjectStatus; diff: ProjectDiff; log: ProjectLog; show: ProjectShow; branches: ProjectBranches; "stage-link": ProjectStaged };
export type ProjectErrorCode = "HERDR_NOT_FOUND" | "NOT_FOUND" | "NOT_GIT" | "TOO_LARGE" | "PROJECT_FAILED" | "CLI_MISSING" | "CLI_OUTDATED";
export type ProjectResult<V extends ProjectVerb> = { ok: true; value: ProjectValue[V] } | { ok: false; code: ProjectErrorCode };

const VERBS: readonly ProjectVerb[] = ["tree", "file", "status", "diff", "log", "show", "branches", "stage-link"];
const MAX_OUTPUT = 4 * 1024 * 1024;
const gitAlias = (segment: string) => segment.toLowerCase().replace(/[. ]+$/, "") === ".git" || /^git~\d+$/i.test(segment);
/** Same rules as the host (L7, L11): relative POSIX segments, no `.git` alias, no `:`. */
const validPath = (path: string) => path.length > 0 && path.length <= 4096 && !path.includes("\\") && !path.includes(":") && !/[\x00-\x1f\x7f-\x9f]/.test(path) && path.split("/").every(s => s !== "" && s !== "." && s !== ".." && !gitAlias(s));
const workspaceId = (id: string) => /^w[A-Za-z0-9]{1,63}$/.test(id);
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function base64url(text: string): string {
 const bytes = new TextEncoder().encode(text); let out = "";
 for (let i = 0; i < bytes.length; i += 3) {
  const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2];
  out += ALPHABET[a >> 2]! + ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]! + (b === undefined ? "" : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]!) + (c === undefined ? "" : ALPHABET[c & 63]!);
 }
 return out;
}
/** Fixed verb plus validated options; the path travels as base64url so no remote shell reinterprets it. */
export function buildProjectCommand(record: KeyCommandConfig, [verb]: [ProjectVerb], options: ProjectOptions = {}): string {
 if (!VERBS.includes(verb)) throw Error("Invalid project verb");
 const args: string[] = [verb];
 // The sheet pins the workspace `tree` resolved: Herdr focus is shared with the computer and may move.
 if (options.workspace !== undefined) { if (!workspaceId(options.workspace)) throw Error("Invalid workspace"); args.push("--workspace", options.workspace); }
 if (options.path !== undefined) { if (!validPath(options.path)) throw Error("Invalid project path"); args.push("--path-b64", base64url(options.path)); }
 if (options.commit !== undefined) { if (!/^[0-9a-fA-F]{7,64}$/.test(options.commit)) throw Error("Invalid commit"); args.push("--commit", options.commit); }
 if (options.limit !== undefined) { if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) throw Error("Invalid limit"); args.push("--limit", String(options.limit)); }
 return buildHerdrCommand(record, "list").replace(/ herdr list$/, ` project ${args.join(" ")}`);
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max && !/[\x00-\x1f\x7f-\x9f]/.test(v);
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const time = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k)) && allowed.every(k => k in v);
const nullable = <T>(v: unknown, check: (v: unknown) => v is T): v is T | null => v === null || check(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{4,64}$/.test(v);
const commit = (v: unknown): v is Commit => object(v) && keys(v, ["hash", "subject", "time"]) && hash(v.hash) && text(v.subject, 1024) && time(v.time);
const relative = (v: unknown): v is string => typeof v === "string" && v.length <= 4096 && !/[\x00-\x1f\x7f-\x9f]/.test(v);
const change = (v: unknown): v is Change => object(v) && keys(v, ["path", "status", "added", "removed"]) && relative(v.path) && ["M", "A", "D", "R", "?"].includes(v.status as string) && nullable(v.added, count) && nullable(v.removed, count);
const absolute = (v: unknown): v is string => typeof v === "string" && v.length <= 4096 && !/[\x00-\x1f]/.test(v) && /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(v);
const checks: { [V in ProjectVerb]: (v: Record<string, unknown>) => boolean } = {
 tree: v => keys(v, ["version", "root", "path", "entries", "truncated"]) && object(v.root) && keys(v.root, ["name", "path", "workspace", "branch", "git"]) && text(v.root.name, 256) && absolute(v.root.path) && typeof v.root.workspace === "string" && workspaceId(v.root.workspace) && nullable(v.root.branch, (b): b is string => text(b, 256)) && typeof v.root.git === "boolean"
  && (v.path === "" || (typeof v.path === "string" && validPath(v.path))) && typeof v.truncated === "boolean" && Array.isArray(v.entries) && v.entries.length <= 500
  && v.entries.every(e => object(e) && keys(e, ["name", "kind", "size", "mtime"]) && text(e.name, 1024) && e.name !== "" && !/[\\/]/.test(e.name as string) && ["dir", "file", "link", "other"].includes(e.kind as string) && nullable(e.size, count) && time(e.mtime)),
 file: v => keys(v, ["version", "path", "size", "mtime", "kind", "language", "content", "truncated"]) && typeof v.path === "string" && validPath(v.path) && count(v.size) && time(v.mtime) && ["text", "image", "binary"].includes(v.kind as string)
  && nullable(v.language, (l): l is string => text(l, 32)) && (v.kind === "binary" ? v.content === null : typeof v.content === "string") && typeof v.truncated === "boolean",
 status: v => keys(v, ["version", "branch", "ahead", "behind", "lastCommit", "changes", "truncated"]) && nullable(v.branch, (b): b is string => text(b, 256)) && count(v.ahead) && count(v.behind) && nullable(v.lastCommit, commit) && Array.isArray(v.changes) && v.changes.length <= 500 && v.changes.every(change) && typeof v.truncated === "boolean",
 diff: v => keys(v, ["version", "path", "commit", "diff", "truncated"]) && typeof v.path === "string" && validPath(v.path) && nullable(v.commit, hash) && typeof v.diff === "string" && typeof v.truncated === "boolean",
 log: v => keys(v, ["version", "commits"]) && Array.isArray(v.commits) && v.commits.length <= 100 && v.commits.every(commit),
 show: v => keys(v, ["version", "commit", "files", "truncated"]) && commit(v.commit) && Array.isArray(v.files) && v.files.length <= 500 && v.files.every(change) && typeof v.truncated === "boolean",
 branches: v => keys(v, ["version", "current", "branches", "truncated"]) && typeof v.truncated === "boolean" && nullable(v.current, (b): b is string => text(b, 256)) && Array.isArray(v.branches) && v.branches.length <= 500 && v.branches.every(b => object(b) && keys(b, ["name", "current", "upstream", "ahead", "behind"]) && text(b.name, 256) && typeof b.current === "boolean" && nullable(b.upstream, (u): u is string => text(u, 256)) && nullable(b.ahead, count) && nullable(b.behind, count)),
 "stage-link": v => keys(v, ["version", "staged"]) && typeof v.staged === "string" && v.staged.length <= 200 && /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(v.staged) && !v.staged.includes(".."),
};
export function parseProject<V extends ProjectVerb>(verb: V, stdout: string): ProjectValue[V] {
 if (stdout.length > MAX_OUTPUT) throw Error("Project output too large");
 const data: unknown = JSON.parse(stdout);
 if (!object(data) || data.version !== 1 || !checks[verb](data)) throw Error("Invalid project contract");
 return data as ProjectValue[V];
}
const HOST_CODES = ["HERDR_NOT_FOUND", "NOT_FOUND", "NOT_GIT", "TOO_LARGE", "PROJECT_FAILED"] as const;

export class ProjectBrowser {
 constructor(private readonly deps: { host: Pick<HostConnection, "readFile" | "exec">; connections: Pick<HostConnections, "connection"> }) {}
 async run<V extends ProjectVerb>(computer: SavedHost, verb: V, options: ProjectOptions = {}): Promise<ProjectResult<V>> {
  try {
   const connection = await this.deps.connections.connection(computer);
   if (!connection.ok) return { ok: false, code: "PROJECT_FAILED" };
   const record = await readHostRecord(this.deps.host, connection.connectionId);
   let command: string;
   try { command = buildProjectCommand(record as KeyCommandConfig, [verb], options); } catch { return { ok: false, code: "CLI_MISSING" }; }
   const result = await this.deps.host.exec(connection.connectionId, command);
   if (!result.ok) return { ok: false, code: "PROJECT_FAILED" };
   if (result.exitStatus === 127 || result.exitStatus === 9009) return { ok: false, code: "CLI_MISSING" };
   // An older host CLI prints its usage and exits 2 for an unknown command.
   if (result.exitStatus === 2) return { ok: false, code: "CLI_OUTDATED" };
   if (result.exitStatus !== 0) {
    try {
     const error: unknown = JSON.parse(result.stdout);
     const code = object(error) ? error.code : undefined;
     if (code === "BAD_ARGUMENT") return { ok: false, code: "CLI_OUTDATED" }; // The app sends only valid options.
     if (HOST_CODES.includes(code as never)) return { ok: false, code: code as ProjectErrorCode };
    } catch { /* Fall through. */ }
    return { ok: false, code: "PROJECT_FAILED" };
   }
   return { ok: true, value: parseProject(verb, result.stdout) };
  } catch { return { ok: false, code: "PROJECT_FAILED" }; }
 }
}

/** Age as in Moshi's tree: ahora, 2m, 11h, 8d, 3sem, 1a. */
export function formatAge(mtime: number, now: number): string {
 const s = Math.max(0, Math.floor((now - mtime) / 1000));
 if (s < 60) return "ahora";
 if (s < 3600) return `${Math.floor(s / 60)}m`;
 if (s < 86400) return `${Math.floor(s / 3600)}h`;
 if (s < 14 * 86400) return `${Math.floor(s / 86400)}d`;
 if (s < 365 * 86400) return `${Math.floor(s / (7 * 86400))}sem`;
 return `${Math.floor(s / (365 * 86400))}a`;
}
export type Token = { kind: "plain" | "keyword" | "string" | "comment" | "number"; text: string };
const KEYWORDS = /\b(?:export|import|from|async|await|function|const|let|var|return|try|catch|finally|throw|if|else|while|for|of|in|new|class|extends|type|interface|public|private|static|readonly|def|fun|val|package|func|struct|impl|fn|use|mut|true|false|null|undefined|None|nil)\b/;
const COMMENT: Record<string, RegExp> = { python: /#.*$/, shell: /#.*$/, yaml: /#.*$/, toml: /#.*$/, powershell: /#.*$/, ruby: /#.*$/ };
/** Lightweight, line-local highlighting: keywords, strings, comments and numbers. */
export function highlightLine(line: string, language: string | null): Token[] {
 if (!language || language === "markdown") return [{ kind: "plain", text: line }];
 const comment = COMMENT[language] ?? /\/\/.*$/;
 const pattern = new RegExp(`(${comment.source})|('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*"|\`[^\`]*\`)|(${KEYWORDS.source})|(\\b\\d+(?:\\.\\d+)?\\b)`, "g");
 const tokens: Token[] = []; let last = 0;
 for (const match of line.matchAll(pattern)) {
  if (match.index! > last) tokens.push({ kind: "plain", text: line.slice(last, match.index) });
  tokens.push({ kind: match[1] ? "comment" : match[2] ? "string" : match[3] ? "keyword" : "number", text: match[0] });
  last = match.index! + match[0].length;
 }
 if (last < line.length) tokens.push({ kind: "plain", text: line.slice(last) });
 return tokens;
}
/** Absolute host path for the terminal paste, quoted like the attachment paths. */
export function hostFilePath(root: string, path: string): string {
 const windows = /^[A-Za-z]:[\\/]/.test(root) || root.startsWith("\\\\");
 const separator = windows ? "\\" : "/";
 const absolute = `${root.replace(/[\\/]$/, "")}${separator}${windows ? path.replace(/\//g, "\\") : path}`;
 return !/[ '"]/.test(absolute) ? absolute : windows ? `"${absolute}"` : `'${absolute.replace(/'/g, "'\\''")}'`;
}
export function summarizeChanges(changes: readonly Change[]): { count: number; added: number; removed: number } {
 return changes.reduce((sum, c) => ({ count: sum.count + 1, added: sum.added + (c.added ?? 0), removed: sum.removed + (c.removed ?? 0) }), { count: 0, added: 0, removed: 0 });
}
/** Lines as an editor shows them: a final newline ends the last line, it does not add one. */
export function textLines(content: string): string[] {
 const lines = content.split("\n");
 if (lines.length > 1 && lines.at(-1) === "") lines.pop();
 return lines;
}
export function formatSize(bytes: number): string {
 return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
