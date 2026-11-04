import { describe, expect, it } from "vitest";
import { buildProjectCommand, formatAge, formatSize, textLines, highlightLine, hostFilePath, parseProject, ProjectBrowser, summarizeChanges } from "../src/core/project";
import { savedHost } from "./fakes";

const record = { node: "/usr/bin/node", cli: "/work/host cli/main.ts" };
const connections = { connection: async () => ({ ok: true as const, connectionId: "ssh" }) };
const tree = { version: 1, root: { name: "mars-ram", path: "/home/alex/Work/mars-ram", workspace: "w2", branch: "main", git: true }, path: "", entries: [{ name: "host", kind: "dir", size: null, mtime: 1 }, { name: "package.json", kind: "file", size: 20, mtime: 2 }], truncated: false };

describe("project command (L7, L10)", () => {
 it("sends only fixed verbs, validated options and the path as base64url", () => {
  expect(buildProjectCommand(record, ["tree"])).toBe("'/usr/bin/node' '/work/host cli/main.ts' project tree");
  expect(buildProjectCommand(record, ["file"], { path: "it's $HOME %PATH%.ts" })).toBe(`'/usr/bin/node' '/work/host cli/main.ts' project file --path-b64 ${Buffer.from("it's $HOME %PATH%.ts").toString("base64url")}`);
  expect(buildProjectCommand({ node: "C:\\node\\node.exe", cli: "C:\\mr\\main.ts" }, ["log"], { limit: 50 })).toBe('"C:\\node\\node.exe" "C:\\mr\\main.ts" project log --limit 50');
  expect(buildProjectCommand(record, ["show"], { commit: "0673e5a" })).toMatch(/ project show --commit 0673e5a$/);
  expect(buildProjectCommand(record, ["status"], { workspace: "w2" })).toMatch(/ project status --workspace w2$/);
  expect(() => buildProjectCommand(record, ["status"], { workspace: "w2;id" })).toThrow();
  for (const bad of [{ path: "../x" }, { path: "a\nb" }, { path: "GIT~1/config" }, { path: ".git./x" }, { path: "a:b" }, { commit: "HEAD;id" }, { limit: 0 }, { limit: 101 }]) expect(() => buildProjectCommand(record, ["log"], bad)).toThrow();
  expect(() => buildProjectCommand(record, ["rm" as never])).toThrow();
 });
});

describe("project parsing (L7)", () => {
 it("accepts every verb's exact shape and refuses extra or malformed fields", () => {
  expect(parseProject("tree", JSON.stringify(tree))).toEqual(tree);
  expect(() => parseProject("tree", JSON.stringify({ ...tree, extra: 1 }))).toThrow();
  expect(() => parseProject("tree", JSON.stringify({ ...tree, entries: [{ name: "a/b", kind: "file", size: 1, mtime: 1 }] }))).toThrow();
  expect(() => parseProject("tree", JSON.stringify({ ...tree, root: { ...tree.root, path: "relative" } }))).toThrow();
  const file = { version: 1, path: "a.ts", size: 3, mtime: 1, kind: "text", language: "typescript", content: "abc", truncated: false };
  expect(parseProject("file", JSON.stringify(file))).toEqual(file);
  expect(() => parseProject("file", JSON.stringify({ ...file, kind: "exe" }))).toThrow();
  const status = { version: 1, branch: "main", ahead: 1, behind: 0, lastCommit: { hash: "0673e5a", subject: "fix", time: 3 }, changes: [{ path: "a.ts", status: "M", added: 2, removed: 1 }, { path: "n.txt", status: "?", added: null, removed: null }], truncated: false };
  expect(parseProject("status", JSON.stringify(status))).toEqual(status);
  expect(() => parseProject("status", JSON.stringify({ ...status, changes: [{ path: "a", status: "X", added: 1, removed: 1 }] }))).toThrow();
  expect(parseProject("diff", JSON.stringify({ version: 1, path: "a.ts", commit: null, diff: "@@", truncated: false }))).toMatchObject({ diff: "@@" });
  expect(parseProject("log", JSON.stringify({ version: 1, commits: [{ hash: "abc1234", subject: "s", time: 1 }] }))).toMatchObject({ commits: [{ hash: "abc1234" }] });
  expect(parseProject("show", JSON.stringify({ version: 1, commit: { hash: "abc1234", subject: "s", time: 1 }, files: [], truncated: false }))).toMatchObject({ files: [] });
  expect(parseProject("branches", JSON.stringify({ version: 1, current: "main", branches: [{ name: "main", current: true, upstream: null, ahead: null, behind: null }], truncated: false }))).toMatchObject({ current: "main" });
  expect(parseProject("stage-link", JSON.stringify({ version: 1, staged: "20261031-120000-abcdef-a.ts" }))).toEqual({ version: 1, staged: "20261031-120000-abcdef-a.ts" });
  expect(() => parseProject("stage-link", JSON.stringify({ version: 1, staged: "../x" }))).toThrow();
  expect(() => parseProject("tree", "x".repeat(4 * 1024 * 1024 + 1))).toThrow();
 });
});

describe("ProjectBrowser", () => {
 it("runs over the computer's connection and maps host errors and missing CLI", async () => {
  const commands: string[] = []; let reply = { ok: true as const, stdout: JSON.stringify(tree), stderr: "", exitStatus: 0 };
  const browser = new ProjectBrowser({ connections, host: { readFile: async () => ({ ok: true, content: JSON.stringify(record) }), exec: async (_id, command) => { commands.push(command); return reply; } } });
  expect(await browser.run(savedHost("a"), "tree", { path: "host" })).toEqual({ ok: true, value: tree });
  expect(commands).toEqual([buildProjectCommand(record, ["tree"], { path: "host" })]);
  reply = { ok: true, stdout: '{"version":1,"ok":false,"code":"NOT_GIT","message":"x"}\n', stderr: "", exitStatus: 1 };
  expect(await browser.run(savedHost("a"), "status")).toEqual({ ok: false, code: "NOT_GIT" });
  reply = { ok: true, stdout: "", stderr: "", exitStatus: 127 };
  expect(await browser.run(savedHost("a"), "status")).toEqual({ ok: false, code: "CLI_MISSING" });
  reply = { ok: true, stdout: '{"version":1,"ok":false,"code":"BAD_ARGUMENT","message":"Expected"}', stderr: "", exitStatus: 1 };
  expect(await browser.run(savedHost("a"), "tree")).toEqual({ ok: false, code: "CLI_OUTDATED" });
 });
});

describe("project presentation", () => {
 it("formats ages like the design: 2m, 11h, 8d, 3sem", () => {
  const now = Date.UTC(2026, 9, 31, 12);
  expect([now - 30_000, now - 2 * 60_000, now - 11 * 3600_000, now - 8 * 86400_000, now - 21 * 86400_000, now - 400 * 86400_000].map(t => formatAge(t, now))).toEqual(["ahora", "2m", "11h", "8d", "3sem", "1a"]);
 });
 it("highlights keywords, strings, comments and numbers without losing text", () => {
  const line = "const a = 'x'; // b 12";
  const tokens = highlightLine(line, "typescript");
  expect(tokens.map(t => t.text).join("")).toBe(line);
  expect(tokens.filter(t => t.kind !== "plain").map(t => [t.kind, t.text])).toEqual([["keyword", "const"], ["string", "'x'"], ["comment", "// b 12"]]);
  expect(highlightLine("x = 1", null)).toEqual([{ kind: "plain", text: "x = 1" }]);
 });
 it("builds the host path pasted into the terminal, quoting spaces per platform", () => {
  expect(hostFilePath("/home/alex/Work/mars-ram", "host/cli/main.ts")).toBe("/home/alex/Work/mars-ram/host/cli/main.ts");
  expect(hostFilePath("/home/alex/my repo", "it's.ts")).toBe("'/home/alex/my repo/it'\\''s.ts'");
  expect(hostFilePath("C:\\Users\\alex\\OS", "src/a b.ts")).toBe('"C:\\Users\\alex\\OS\\src\\a b.ts"');
 });
 it("summarizes changes for the header and the tab badge", () => {
  expect(summarizeChanges([{ path: "a", status: "M", added: 2, removed: 1 }, { path: "b", status: "?", added: null, removed: null }, { path: "c", status: "D", added: 0, removed: 4 }])).toEqual({ count: 3, added: 2, removed: 5 });
 });
});

describe("project file meta (phone check L19)", () => {
 it("counts lines without the empty one after a final newline, and sizes small files in bytes", () => {
  expect(textLines("a\nb\n")).toEqual(["a", "b"]); expect(textLines("a\nb")).toEqual(["a", "b"]); expect(textLines("")).toEqual([""]); expect(textLines("\n")).toEqual([""]);
  expect([0, 51, 1023, 1024, 3174, 2 * 1024 * 1024].map(formatSize)).toEqual(["0 B", "51 B", "1023 B", "1.0 KB", "3.1 KB", "2.0 MB"]);
 });
});
