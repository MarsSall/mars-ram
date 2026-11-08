import { describe, expect, it } from "vitest";
import { buildHerdrCommand, parseHerdrList, HerdrSwitcher, filterWorkspaces, agentGroups } from "../src/core/herdr-switcher";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";
import { savedHost } from "./fakes";

const config = { node: "/usr/bin/node", cli: "/home/dev/host cli/main.ts" };
const tab = { id: "w2G:t2", label: "Pi", focused: true, status: "blocked", kind: "pi" };
const workspace = { id: "w2G", label: "Project", focused: true, status: "working", branch: "feat/drawer", tabs: [tab] };
const output = (workspaces = [workspace]) => JSON.stringify({ version: 1, workspaces });
function setup() {
 const commands: string[] = [];
 let response = { ok: true as const, stdout: output(), stderr: "", exitStatus: 0 };
 const service = new HerdrSwitcher({ connections: { connection: async () => ({ ok: true, connectionId: "ssh" }) }, host: {
  readFile: async () => ({ ok: true, content: JSON.stringify(config) }),
  exec: async (_id, command) => { commands.push(command); return response; },
 } });
 return { service, commands, respond: (value: typeof response) => { response = value; } };
}
describe("Herdr switcher", () => {
 it("preserves optional panes and rejects unsafe, duplicate and cross-workspace ids", () => {
  const panes = [{ id: "w2G:p2", focused: true }];
  const payload = (value: unknown) => JSON.stringify({ version: 1, workspaces: [{ ...workspace, tabs: [{ ...tab, panes: value }] }] });
  expect(parseHerdrList(payload(panes)).workspaces[0].tabs[0].panes).toEqual(panes);
  for (const value of [null, [{ id: "wOther:p2", focused: true }], [...panes, ...panes], [{ id: "w2G:p2;id", focused: true }], [{ id: "w2G:p2", focused: 1 }], Array(129).fill(panes[0])]) expect(() => parseHerdrList(payload(value))).toThrow();
 });
 it("drops Pi's own \"π - \" title prefix from agent tabs: the icon already says it", () => {
  const tabs = [{ ...tab, id: "w2G:t2", label: "π - lnedev", kind: "pi" }, { ...tab, id: "w2G:t3", label: "π - gentle-shell", kind: "gentle-shell" }, { ...tab, id: "w2G:t4", label: "π - notes", kind: "shell" }, { ...tab, id: "w2G:t5", label: "π - ", kind: "pi" }];
  expect(parseHerdrList(output([{ ...workspace, tabs }])).workspaces[0]!.tabs.map(t => t.label)).toEqual(["lnedev", "gentle-shell", "π - notes", "π - "]);
 });
 it("quotes fixed commands for POSIX and Windows cmd", () => {
  expect(buildHerdrCommand(config, "list")).toBe("'/usr/bin/node' '/home/dev/host cli/main.ts' herdr list");
  expect(buildHerdrCommand({ node: "C:\\Program Files\\nodejs\\node.exe", cli: "C:\\host cli\\main.ts" }, "focus", "w2G", "w2G:t2")).toBe('"C:\\Program Files\\nodejs\\node.exe" "C:\\host cli\\main.ts" herdr focus "w2G" "w2G:t2"');
 });
 it("rejects injected ids, verbs, mixed platforms and unsafe paths", () => {
  for (const id of ["", "-x", "w;id", "w%PATH%", "w\n", "a".repeat(129)]) expect(() => buildHerdrCommand(config, "focus", id)).toThrow();
  expect(() => buildHerdrCommand(config, "list", "w")).toThrow();
  expect(() => buildHerdrCommand(config, "focus", "w2G", "wOther:t2")).toThrow();
  expect(() => buildHerdrCommand(config, "focus", "w2G", "t2")).toThrow();
  expect(() => buildHerdrCommand(config, "evil" as "list")).toThrow();
  for (const node of ["/bin/../node", "/bin/$(node)", "C:\\node.exe"]) expect(() => buildHerdrCommand({ ...config, node }, "list")).toThrow();
 });
 it("parses version 1 and normalizes unknown enums", () => {
  expect(parseHerdrList(output())).toEqual({ workspaces: [workspace], truncated: false });
  const result = parseHerdrList(output([{ ...workspace, status: "future", tabs: [{ ...tab, status: "future", kind: "future" }] }]));
  expect(result.workspaces[0].status).toBe("unknown"); expect(result.workspaces[0].tabs[0]).toMatchObject({ status: "unknown", kind: "agent" });
 });
 it("accepts explicit truncation, defaults absence to false and rejects non-booleans", () => {
  for (const truncated of [true, false]) expect(parseHerdrList(JSON.stringify({ version: 1, workspaces: [workspace], truncated }))).toEqual({ workspaces: [workspace], truncated });
  for (const truncated of [null, 1, "true"]) expect(() => parseHerdrList(JSON.stringify({ version: 1, workspaces: [], truncated }))).toThrow();
 });
 it("preserves the host truncation warning through the use case in both languages", async () => {
  const f = setup();
  f.respond({ ok: true, stdout: JSON.stringify({ version: 1, workspaces: [workspace], truncated: true }), stderr: "", exitStatus: 0 });
  expect(await f.service.list(savedHost("a"))).toEqual({ ok: true, value: { workspaces: [workspace], truncated: true } });
  expect(es.switcher.truncated).toBe("Herdr tiene más espacios de los que se muestran");
  expect(en.switcher.truncated).toBe("Herdr has more workspaces than are shown");
 });
 it("rejects malformed, oversized, duplicate and wrong-version payloads", () => {
  for (const value of ["bad", "{}", output().replace('"version":1', '"version":2'), output([{ ...workspace, label: "x".repeat(513) }]), output([workspace, workspace]), output([{ ...workspace, focused: "yes" as unknown as boolean }]), " ".repeat(1048577)]) expect(() => parseHerdrList(value)).toThrow();
 });
 it("reads installed paths, lists and confirms focus", async () => {
  const f = setup(); expect(await f.service.list(savedHost("a"))).toEqual({ ok: true, value: { workspaces: [workspace], truncated: false } });
  f.respond({ ok: true, stdout: '{"version":1,"ok":true}', stderr: "", exitStatus: 0 });
  expect(await f.service.focus(savedHost("a"), "w2G", "w2G:t2")).toEqual({ ok: true, value: undefined });
  expect(f.commands[1]).toBe("'/usr/bin/node' '/home/dev/host cli/main.ts' herdr focus 'w2G' 'w2G:t2'");
 });
 it("maps host errors without exposing remote text and rejects false success", async () => {
  const f = setup();
  for (const [code, expected] of [["HERDR_NOT_FOUND", "HERDR_NOT_FOUND"], ["BAD_ID", "HERDR_FAILED"], ["NOT_FOUND", "HERDR_FAILED"]]) {
   f.respond({ ok: true, stdout: JSON.stringify({ version: 1, ok: false, code, message: "private host text" }), stderr: "", exitStatus: 1 });
   expect(await f.service.list(savedHost("a"))).toEqual({ ok: false, code: expected });
  }
  f.respond({ ok: true, stdout: "unknown command", stderr: "", exitStatus: 1 });
  expect(await f.service.list(savedHost("a"))).toEqual({ ok: false, code: "CLI_MISSING" });
  f.respond({ ok: true, stdout: '{"version":1,"ok":false}', stderr: "", exitStatus: 0 });
  expect((await f.service.focus(savedHost("a"), "w2G")).ok).toBe(false);
 });
 it("rejects malformed host records and transport failures", async () => {
  for (const record of [null, { node: "/bad;node", cli: config.cli }]) {
   const service = new HerdrSwitcher({ connections: { connection: async () => ({ ok: true, connectionId: "ssh" }) }, host: { readFile: async () => ({ ok: true, content: JSON.stringify(record) }), exec: async () => { throw Error("must not execute"); } } });
   expect(await service.list(savedHost("a"))).toEqual({ ok: false, code: "CLI_MISSING" });
  }
 });
 it("refuses invalid focus before any remote operation and handles connection/exec failure", async () => {
  const f = setup();
  expect(await f.service.focus(savedHost("a"), "w2G", "wOther:t2")).toEqual({ ok: false, code: "HERDR_FAILED" });
  expect(f.commands).toEqual([]);
  const service = new HerdrSwitcher({ connections: { connection: async () => ({ ok: false, code: "HOST_KEY_CHANGED", message: "private" }) }, host: { readFile: async () => { throw Error("must not read"); }, exec: async () => { throw Error("must not run"); } } });
  expect(await service.list(savedHost("a"))).toEqual({ ok: false, code: "HERDR_FAILED" });
  const throwing = new HerdrSwitcher({ connections: { connection: async () => ({ ok: true, connectionId: "ssh" }) }, host: { readFile: async () => ({ ok: true, content: JSON.stringify(config) }), exec: async () => { throw Error("private"); } } });
  expect(await throwing.list(savedHost("a"))).toEqual({ ok: false, code: "HERDR_FAILED" });
 });
 it("rejects cross-workspace tabs, duplicate tabs, oversized arrays and control characters", () => {
  for (const tabs of [[{ ...tab, id: "wOther:t2" }], [tab, tab], [{ ...tab, label: "bad\nlabel" }], Array.from({ length: 257 }, (_, i) => ({ ...tab, id: `w2G:t${i}` }))]) expect(() => parseHerdrList(output([{ ...workspace, tabs }]))).toThrow();
  expect(() => parseHerdrList(output(Array.from({ length: 257 }, (_, i) => ({ ...workspace, id: `w${i}`, tabs: [] }))))).toThrow();
 });
 it("filters branches and tabs, groups every agent tab by status", () => {
  const { workspaces } = parseHerdrList(output());
  expect(filterWorkspaces(workspaces, "DRAWER")).toHaveLength(1);
  expect(filterWorkspaces(workspaces, "Pi")[0].tabs).toHaveLength(1);
  expect(filterWorkspaces(workspaces, "missing")).toEqual([]);
  expect(agentGroups([{ computer: savedHost("a"), workspaces }], "").blocked).toHaveLength(1);
  const other = { ...workspaces[0], tabs: [{ ...workspaces[0].tabs[0], kind: "shell" as const }, { ...workspaces[0].tabs[0], id: "w2G:t3", status: "unknown" as const }] };
  expect(agentGroups([{ computer: savedHost("b"), workspaces: [other] }], "").blocked).toEqual([]);
  // Every agent tab is listed: idle and unknown ones wait in their own group; shells are not agents.
  const all = { ...workspaces[0], tabs: [{ ...workspaces[0].tabs[0], id: "w2G:t4", status: "idle" as const }, { ...workspaces[0].tabs[0], id: "w2G:t5", status: "unknown" as const }, { ...workspaces[0].tabs[0], id: "w2G:t6", kind: "shell" as const, status: "idle" as const }] };
  expect(agentGroups([{ computer: savedHost("c"), workspaces: [all] }], "").idle.map(row => row.tab.id)).toEqual(["w2G:t4", "w2G:t5"]);
  expect(agentGroups([{ computer: savedHost("a"), workspaces }], "COMPUTER A").blocked).toHaveLength(1);
 });
});
