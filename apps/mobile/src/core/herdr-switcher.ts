// R2/R6/R7: whole-computer Herdr discovery and shared focus through HostConnection.
import type { SavedHost } from "./host-catalog";
import type { HostConnections } from "./host-connections";
import { readHostRecord } from "./host-record";
import type { HostConnection } from "./ports";
import type { KeyCommandConfig } from "./key-security";

export type HerdrStatus = "working" | "blocked" | "done" | "idle" | "unknown";
export type HerdrTab = { id: string; label: string; focused: boolean; status: HerdrStatus; kind: "pi" | "gentle-shell" | "shell" | "agent"; panes?: { id: string; focused: boolean }[] };
export type HerdrWorkspace = { id: string; label: string; focused: boolean; status: HerdrStatus; branch: string | null; tabs: HerdrTab[] };
export type HerdrSnapshot = { workspaces: HerdrWorkspace[]; truncated: boolean };
export type SwitcherError = "CLI_MISSING" | "HERDR_NOT_FOUND" | "HERDR_FAILED";
export type SwitcherResult<T> = { ok: true; value: T } | { ok: false; code: SwitcherError };
// A successful empty snapshot is cached data too. Refresh failures must never
// replace the last known list with an empty/error-only view.
export type HerdrEntry = { state: "loading" } | { state: "error"; code: SwitcherError } | ({ state: "ok"; refreshError?: boolean } & HerdrSnapshot);
export function beginHerdrRefresh(previous?: HerdrEntry): HerdrEntry {
 return previous?.state === "ok" ? previous : { state: "loading" };
}
export function finishHerdrRefresh(previous: HerdrEntry | undefined, result: SwitcherResult<HerdrSnapshot>): HerdrEntry {
 if (result.ok) return { state: "ok", ...result.value };
 return previous?.state === "ok" ? { ...previous, refreshError: true } : { state: "error", code: result.code };
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const workspaceId = (v: unknown): v is string => typeof v === "string" && /^w[A-Za-z0-9]{1,63}$/.test(v);
const tabId = (v: unknown, workspace: string): v is string => typeof v === "string" && /^w[A-Za-z0-9]{1,63}:t[A-Za-z0-9]{1,63}$/.test(v) && v.split(":")[0] === workspace;
export const validHerdrId = (v: unknown): v is string => workspaceId(v) || (typeof v === "string" && tabId(v, v.split(":")[0]));
// Match key-security's conservative sh/fish/cmd path allow-list, with no escapes/expansion.
function path(v: unknown, name: RegExp): v is string {
 return typeof v === "string" && (/^\/[A-Za-z0-9._/ -]+$/.test(v) || /^[A-Za-z]:\\[A-Za-z0-9._\\ -]+$/.test(v))
  && !v.split(/[/\\]/).includes("..") && name.test(v.split(/[/\\]/).at(-1) ?? "");
}
function config(v: unknown): v is KeyCommandConfig {
 return object(v) && path(v.node, /^(?:node|node\.exe)$/) && path(v.cli, /^main\.ts$/) && v.node.startsWith("/") === v.cli.startsWith("/");
}
/** Shared conservative executable-path validation and POSIX/cmd quoting. */
export function hostCliPrefix(record: unknown): string {
 if (!config(record)) throw Error('Invalid host CLI paths');
 const q = record.node.startsWith('/') ? "'" : '"';
 return `${q}${record.node}${q} ${q}${record.cli}${q}`;
}
export function buildHerdrCommand(record: KeyCommandConfig, verb: "list" | "focus", workspace?: string, tab?: string): string {
 if (!config(record) || !["list", "focus"].includes(verb) || (verb === "list" ? workspace !== undefined || tab !== undefined : !workspaceId(workspace) || (tab !== undefined && !tabId(tab, workspace)))) throw Error("Invalid Herdr command");
 const q = record.node.startsWith("/") ? "'" : '"';
 return `${hostCliPrefix(record)} herdr ${verb}${verb === "focus" ? ` ${q}${workspace}${q}${tab === undefined ? "" : ` ${q}${tab}${q}`}` : ""}`;
}
function decode(text: string): Record<string, unknown> {
 if (text.length > 1_048_576) throw Error("Herdr output too large");
 const value: unknown = JSON.parse(text);
 if (!object(value) || value.version !== 1) throw Error("Invalid Herdr version");
 return value;
}
const text = (v: unknown, max = 512): v is string => typeof v === "string" && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const status = (v: unknown): HerdrStatus => ["working", "blocked", "done", "idle"].includes(v as string) ? v as HerdrStatus : "unknown";
function base(v: unknown): { id: string; label: string; focused: boolean; status: HerdrStatus } {
 if (!object(v) || !validHerdrId(v.id) || !text(v.label) || typeof v.focused !== "boolean" || typeof v.status !== "string") throw Error("Invalid Herdr row");
 return { id: v.id, label: v.label, focused: v.focused, status: status(v.status) };
}
export function parseHerdrList(stdout: string): HerdrSnapshot {
 const data = decode(stdout);
 if (data.truncated !== undefined && typeof data.truncated !== "boolean") throw Error("Invalid Herdr truncation");
 if (!Array.isArray(data.workspaces) || data.workspaces.length > 256) throw Error("Invalid Herdr workspaces");
 const ids = new Set<string>(); let tabCount = 0;
 const workspaces = data.workspaces.map((w: unknown) => {
  const row = base(w);
  if (!object(w) || !workspaceId(row.id) || ids.has(row.id) || !(w.branch === null || text(w.branch)) || !Array.isArray(w.tabs) || w.tabs.length > 256) throw Error("Invalid Herdr workspace");
  ids.add(row.id);
  const tabs = w.tabs.map((t: unknown): HerdrTab => {
   const tab = base(t);
   if (!object(t) || !tabId(tab.id, row.id) || ids.has(tab.id) || typeof t.kind !== "string" || ++tabCount > 2048) throw Error("Invalid Herdr tab");
   ids.add(tab.id);
   const kind = ["pi", "gentle-shell", "shell"].includes(t.kind) ? t.kind as HerdrTab["kind"] : "agent";
   // Pi titles its terminal "π - <folder>"; the tab icon already says Pi.
   const label = kind === "pi" || kind === "gentle-shell" ? tab.label.replace(/^π\s*-\s*/u, "") || tab.label : tab.label;
   let panes: HerdrTab["panes"];
   if (t.panes !== undefined) {
    if (!Array.isArray(t.panes) || t.panes.length > 128) throw Error("Invalid Herdr panes");
    panes = t.panes.map((p: unknown) => {
     if (!object(p) || typeof p.id !== "string" || !/^w[A-Za-z0-9]{1,63}:p[A-Za-z0-9]{1,63}$/.test(p.id) || p.id.split(":")[0] !== row.id || ids.has(p.id) || typeof p.focused !== "boolean") throw Error("Invalid Herdr pane");
     ids.add(p.id);
     return { id: p.id, focused: p.focused };
    });
   }
   return { ...tab, label, kind, ...(panes === undefined ? {} : { panes }) };
  });
  return { ...row, branch: w.branch as string | null, tabs };
 });
 return { workspaces, truncated: data.truncated === true };
}
export class HerdrSwitcher {
 constructor(private readonly deps: { host: Pick<HostConnection, "readFile" | "exec">; connections: Pick<HostConnections, "connection"> }) {}
 private async run<T>(computer: SavedHost, verb: "list" | "focus", parse: (stdout: string) => T, workspace?: string, tab?: string): Promise<SwitcherResult<T>> {
  try {
   const connection = await this.deps.connections.connection(computer);
   if (!connection.ok) return { ok: false, code: "HERDR_FAILED" };
   const record = await readHostRecord(this.deps.host, connection.connectionId);
   if (!config(record)) return { ok: false, code: "CLI_MISSING" };
   const result = await this.deps.host.exec(connection.connectionId, buildHerdrCommand(record, verb, workspace, tab));
   if (!result.ok) return { ok: false, code: "HERDR_FAILED" };
   if (result.exitStatus !== 0) {
    if (result.exitStatus === 127 || result.exitStatus === 9009) return { ok: false, code: "CLI_MISSING" };
    try {
     const error = decode(result.stdout);
     return { ok: false, code: error.ok === false && error.code === "HERDR_NOT_FOUND" ? "HERDR_NOT_FOUND" : "HERDR_FAILED" };
    } catch { return { ok: false, code: "CLI_MISSING" }; }
   }
   return { ok: true, value: parse(result.stdout) };
  } catch { return { ok: false, code: "HERDR_FAILED" }; }
 }
 list(computer: SavedHost): Promise<SwitcherResult<HerdrSnapshot>> { return this.run(computer, "list", parseHerdrList); }
 focus(computer: SavedHost, workspace: string, tab?: string): Promise<SwitcherResult<void>> {
  // Reject invalid targets before obtaining a connection or reading metadata.
  if (!workspaceId(workspace) || (tab !== undefined && !tabId(tab, workspace))) return Promise.resolve({ ok: false, code: "HERDR_FAILED" });
  return this.run(computer, "focus", stdout => { const data = decode(stdout); if (data.ok !== true) throw Error("Focus not confirmed"); }, workspace, tab);
 }
}
export function filterWorkspaces(workspaces: HerdrWorkspace[], query: string): HerdrWorkspace[] {
 const q = query.trim().toLocaleLowerCase();
 return workspaces.flatMap(w => {
  if (!q || `${w.label} ${w.branch ?? ""}`.toLocaleLowerCase().includes(q)) return [w];
  const tabs = w.tabs.filter(t => t.label.toLocaleLowerCase().includes(q));
  return tabs.length ? [{ ...w, tabs }] : [];
 });
}
export function agentGroups(computers: { computer: SavedHost; workspaces: HerdrWorkspace[] }[], query: string) {
 const groups: Record<"blocked" | "working" | "done" | "idle", { computer: SavedHost; workspace: HerdrWorkspace; tab: HerdrTab }[]> = { blocked: [], working: [], done: [], idle: [] };
 const q = query.trim().toLocaleLowerCase();
 for (const { computer, workspaces } of computers) for (const workspace of workspaces) for (const tab of workspace.tabs) {
  if (tab.kind === "shell") continue;
  if (q && !`${computer.name} ${workspace.label} ${workspace.branch ?? ""} ${tab.label}`.toLocaleLowerCase().includes(q)) continue;
  groups[tab.status === "blocked" || tab.status === "working" || tab.status === "done" ? tab.status : "idle"].push({ computer, workspace, tab });
 }
 return groups;
}
