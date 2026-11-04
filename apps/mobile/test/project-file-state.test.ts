import { describe, expect, it } from "vitest";
import { projectFileState, projectTreeEntries } from "../src/core/project-file-state";
import type { Change, ChangeStatus } from "../src/core/project";
const change = (path: string, status: ChangeStatus): Change => ({ path, status, added: null, removed: null });
describe("project file states", () => {
 it.each([["M", "modified"], ["D", "deleted"], ["A", "uncommitted"], ["?", "uncommitted"], ["R", "modified"]] as const)("maps %s and overrides last commit", (status, state) => {
  expect(projectFileState("src/new name.ts", [change("src/new name.ts", status)], [change("src/new name.ts", "M")])).toBe(state);
 });
 it("marks last commit files, including rename destinations", () => {
  expect(projectFileState("new name.ts", [], [change("new name.ts", "R")])).toBe("last-commit");
  expect(projectFileState("old name.ts", [], [change("new name.ts", "R")])).toBeNull();
 });
 it("leaves unrelated files neutral and respects path boundaries", () => {
  expect(projectFileState("src", [change("src-other/a", "M")], [], true)).toBeNull();
  expect(projectFileState("src", [change("src/a", "M")], [])).toBeNull();
 });
 it("rolls folders up by deleted, modified, uncommitted, last commit priority", () => {
  const changes = [change("src/deep/a", "D"), change("src/b", "M"), change("src/c", "?")];
  const last = [change("src/d", "M")];
  expect(projectFileState("src", changes, last, true)).toBe("deleted");
  expect(projectFileState("src", changes.slice(1), last, true)).toBe("modified");
  expect(projectFileState("src", changes.slice(2), last, true)).toBe("uncommitted");
  expect(projectFileState("src", [], last, true)).toBe("last-commit");
  expect(projectFileState("", changes, last, true)).toBe("deleted");
 });
 it("does not invent absent modified or last-commit files", () => {
  expect(projectTreeEntries("", [], [change("new.ts", "?"), change("renamed.ts", "R"), change("edited.ts", "M")])).toEqual([]);
 });
 it("does not synthesize unsafe deleted paths", () => {
  expect(projectTreeEntries("", [], [change("../outside", "D"), change(".git/config", "D"), change("dir\\\\file", "D")])).toEqual([]);
 });
 it("keeps a real entry's metadata and leaves the input unchanged", () => {
  const entries = [{ name: "kept.ts", kind: "file" as const, size: 12, mtime: 42 }];
  const result = projectTreeEntries("", entries, [change("kept.ts", "D"), change("gone.ts", "D")]);
  expect(result.find(e => e.name === "kept.ts")).toBe(entries[0]);
  expect(entries).toHaveLength(1);
  expect(result.find(e => e.name === "gone.ts")?.missing).toBe(true);
 });
 it("adds missing deleted files and folders without duplicating real entries", () => {
  const changes = [change("gone dir/old name.ts", "D"), change("gone dir/other.ts", "D"), change("kept.ts", "D")];
  const kept = { name: "kept.ts", kind: "file" as const, size: 1, mtime: 123 };
  expect(projectTreeEntries("", [kept], changes).map(e => e.name)).toEqual(["gone dir", "kept.ts"]);
  expect(projectTreeEntries("gone dir", [], changes).map(e => e.name)).toEqual(["old name.ts", "other.ts"]);
  expect(projectTreeEntries("gone", [], changes)).toEqual([]);
 });
});
