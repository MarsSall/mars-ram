import type { Change, TreeEntry } from "./project";

export type ProjectFileState = "modified" | "deleted" | "uncommitted" | "last-commit";
const priority: Record<ProjectFileState, number> = { "last-commit": 1, uncommitted: 2, modified: 3, deleted: 4 };
/** Rename records name the destination. Working-tree evidence always wins over HEAD. */
export function projectFileState(path: string, changes: readonly Change[], lastCommit: readonly Change[], folder = false): ProjectFileState | null {
 const matches = (candidate: string) => candidate === path || (folder && (path === "" || candidate.startsWith(`${path}/`)));
 let result: ProjectFileState | null = lastCommit.some(c => matches(c.path)) ? "last-commit" : null;
 for (const change of changes) {
  if (!matches(change.path)) continue;
  const state = change.status === "D" ? "deleted" : change.status === "A" || change.status === "?" ? "uncommitted" : "modified";
  if (!result || priority[state] > priority[result]) result = state;
 }
 return result;
}

export type ProjectTreeEntry = TreeEntry & { missing?: boolean };
/** Keep deletions discoverable even when their entire parent directory is gone. */
export function projectTreeEntries(path: string, entries: readonly TreeEntry[], changes: readonly Change[]): ProjectTreeEntry[] {
 const result = new Map<string, ProjectTreeEntry>(entries.map(entry => [entry.name, entry]));
 const prefix = path ? `${path}/` : "";
 for (const change of changes) {
  if (change.status !== "D" || !change.path.startsWith(prefix)) continue;
  const parts = change.path.slice(prefix.length).split("/");
  const name = parts[0];
  // Match the tree's safe relative path contract; never synthesize traversal entries.
  if (!name || parts.some(p => !p || p === "." || p === ".." || p.toLowerCase() === ".git") || /[\\:\x00-\x1f]/.test(change.path)) continue;
  if (!result.has(name)) result.set(name, { name, kind: parts.length > 1 ? "dir" : "file", size: null, mtime: 0, missing: true });
 }
 return [...result.values()].sort((a, b) => Number(b.kind === "dir") - Number(a.kind === "dir") || a.name.localeCompare(b.name));
}
