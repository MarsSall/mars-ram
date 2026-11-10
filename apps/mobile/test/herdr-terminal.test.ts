import { afterEach, describe, expect, it, vi } from "vitest";
import { HerdrTerminal, terminalKey, validHerdrPath } from "../src/core/herdr-terminal";
import { HostConnections } from "../src/core/host-connections";
import type { HostConnection } from "../src/core/ports";
import { UPDATE_REQUIRED_MESSAGE, parseUploadsFolder } from "../src/core/uploads-folder";
import { FakeSsh, FakeTerminalChannel, FakeUploadsFolder, failure, savedHost } from "./fakes";
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
function setup() {
 const host = new FakeSsh(); const channel = new FakeTerminalChannel(); const folder = new FakeUploadsFolder();
 const connections = new HostConnections({ host: host as unknown as HostConnection, keyAlias: "key", unlock: async () => false });
 const deps = { connections, channel, host: host as unknown as HostConnection, uploadsFolder: folder, clock: () => 0, random: () => 0 };
 const terminal = new HerdrTerminal(deps, savedHost("one"), { cols: 80, rows: 24 });
 return { host, channel, terminal, deps, folder };
}
afterEach(() => vi.useRealTimers());
describe("Herdr path", () => {
 it.each(["herdr", "/home/dev/.local/bin/herdr", "/opt/my tools/herdr.exe", "C:\\Program Files\\Herdr\\herdr.exe"])("accepts %s", path => expect(validHerdrPath(path)).toBe(true));
 it.each(["herdr.exe", "./herdr", "/bin/bash", "/bin/herdr;id", "/bin/../herdr", "C:\\..\\herdr.exe", "/bin/herdr\n", "/bin/$(id)/herdr", "\\\\server\\herdr", "/bin/herdr/", null, 3])("rejects %s", path => expect(validHerdrPath(path)).toBe(false));
});
describe("Herdr terminal", () => {
 it("focuses the session once after each successful PTY open, including reconnect", async () => {
  vi.useFakeTimers(); const { deps, channel } = setup();
  const focusSession = vi.fn(async (key: string) => {
   expect(key).toBe("one/bridge"); expect(channel.opens.length).toBeGreaterThan(0);
  });
  const terminal = new HerdrTerminal({ ...deps, focusSession }, savedHost("one"), { cols: 80, rows: 24, sessionKey: "one/bridge" });
  expect(focusSession).not.toHaveBeenCalled();
  await terminal.open(); await terminal.open(); expect(focusSession).toHaveBeenCalledTimes(1);
  expect(focusSession).toHaveBeenLastCalledWith("one/bridge", false, expect.any(Function));
  channel.pushExit("terminal-1", { exitStatus: null, reason: "disconnected" });
  await vi.advanceTimersByTimeAsync(1000); expect(focusSession).toHaveBeenCalledTimes(2);
  expect(focusSession).toHaveBeenLastCalledWith("one/bridge", true, expect.any(Function));
  await terminal.close();
 });
 it("waits for PTY open and does not focus after an abandoned open", async () => {
  const { deps, channel } = setup(); const focusSession = vi.fn(async () => {});
  let release!: () => void; const original = channel.open.bind(channel);
  channel.open = async (...args) => { await new Promise<void>(resolve => { release = resolve; }); return original(...args); };
  const terminal = new HerdrTerminal({ ...deps, focusSession }, savedHost("one"), { cols: 80, rows: 24, sessionKey: "one/bridge" });
  const opening = terminal.open(); for (let n = 0; n < 30; n++) await Promise.resolve();
  expect(focusSession).not.toHaveBeenCalled(); await terminal.close(); release(); await opening;
  expect(focusSession).not.toHaveBeenCalled();
 });
 it("tells focus when its open is no longer current, so a late focus cannot override another session", async () => {
  const { deps } = setup(); let current: (() => boolean) | undefined;
  const focusSession = vi.fn(async (_key: string, _fresh: boolean, isCurrent: () => boolean) => { current = isCurrent; });
  const terminal = new HerdrTerminal({ ...deps, focusSession }, savedHost("one"), { cols: 80, rows: 24, sessionKey: "one/bridge" });
  await terminal.open(); expect(current?.()).toBe(true);
  await terminal.close(); expect(current?.()).toBe(false);
 });
 it("does not focus a standalone computer terminal", async () => {
  const { deps } = setup(); const focusSession = vi.fn();
  const terminal = new HerdrTerminal({ ...deps, focusSession }, savedHost("one"), { cols: 80, rows: 24 });
  await terminal.open(); expect(focusSession).not.toHaveBeenCalled(); await terminal.close();
 });
 it.each(["reject", "throw", "pending"])("keeps the terminal usable when focus is %s", async mode => {
  const { deps, channel } = setup();
  const focusSession = vi.fn(() => {
   if (mode === "throw") throw new Error("unavailable");
   return mode === "reject" ? Promise.reject(new Error("404")) : new Promise<void>(() => {});
  });
  const terminal = new HerdrTerminal({ ...deps, focusSession }, savedHost("one"), { cols: 80, rows: 24, sessionKey: "one/bridge" });
  await terminal.open(); expect(focusSession).toHaveBeenCalledTimes(1); expect(terminal.state.status).toBe("open");
  expect(await terminal.write(new Uint8Array([65]))).toEqual({ ok: true }); expect(channel.writes).toHaveLength(1); await terminal.close();
 });
 it.each(["/home/dev/.local/bin/herdr", "C:\\Program Files\\Herdr\\herdr.exe"])("reads the bounded host record and opens %s", async path => {
  const { terminal, host, channel } = setup();
  host.readFile = vi.fn(async () => ({ ok: true as const, content: JSON.stringify({ herdr: path }) }));
  await terminal.open(); expect(host.readFile).toHaveBeenCalledWith(expect.any(String), ".mars-ram/host.json", 4096);
  expect(channel.opens[0].command).toEqual([path]);
 });
 it.each(["missing", "{}", "bad json", '{"herdr":"/bin/bash"}'])("falls back for %s and identifies an immediate nonzero exit", async content => {
  const { terminal, host, channel } = setup();
  host.readFile = vi.fn(async () => content === "missing" ? failure("NOT_FOUND") : ({ ok: true as const, content }));
  await terminal.open(); expect(channel.opens[0].command).toEqual(["herdr"]);
  channel.pushExit("terminal-1", { exitStatus: 127, reason: "exited" });
  expect(terminal.state).toMatchObject({ status: "closed", reason: "HERDR_NOT_FOUND" });
 });
 it("does not label a later nonzero exit or a recorded-path exit as missing Herdr", async () => {
  for (const recorded of [false, true]) {
   const { terminal, host, channel, deps } = setup(); let now = 0; deps.clock = () => now;
   if (recorded) host.readFile = async () => ({ ok: true, content: '{"herdr":"/opt/bin/herdr"}' });
   await terminal.open(); if (!recorded) now = 3000;
   channel.pushExit("terminal-1", { exitStatus: 1, reason: "exited" });
   expect(terminal.state).toEqual({ status: "closed", reason: "exited" });
  }
 });
 it("does not open a terminal if closed while reading host.json", async () => {
  const { terminal, host, channel } = setup(); let release!: () => void;
  host.readFile = async () => { await new Promise<void>(resolve => { release = resolve; }); return { ok: true, content: '{"herdr":"/opt/bin/herdr"}' }; };
  const opening = terminal.open(); for (let n = 0; n < 30; n++) await Promise.resolve();
  await terminal.close(); release(); await opening; expect(channel.opens).toEqual([]);
 });
 it("opens Herdr with size and streams ordered bytes", async () => {
  const { terminal, channel } = setup(); const states: string[] = []; terminal.subscribe(s => states.push(s.status));
  await terminal.open(); expect(states).toEqual(["closed", "connecting", "open"]);
  expect(channel.opens[0]).toMatchObject({ command: ["herdr"], cols: 80, rows: 24 });
  const output: number[] = []; terminal.subscribeOutput(b => output.push(...b));
  channel.pushOutput("terminal-1", new Uint8Array([1, 2])); channel.pushOutput("terminal-1", new Uint8Array([3])); expect(output).toEqual([1, 2, 3]);
 });
 it("re-subscribing to an open terminal resets and redraws without replaying a truncated tail", async () => {
  vi.useFakeTimers(); const { terminal, channel } = setup();
  const off = terminal.subscribeOutput(() => {}); await terminal.open(); off();
  channel.pushOutput("terminal-1", new Uint8Array(300000).fill(27));
  const output = vi.fn(); const reset = vi.fn(); terminal.subscribeOutput(output, reset);
  expect(output).not.toHaveBeenCalled(); expect(reset).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(500);
  expect(channel.resizes.map(r => [r.cols, r.rows])).toEqual([[80, 23], [80, 24]]);
  channel.pushOutput("terminal-1", new Uint8Array([7])); expect(output).toHaveBeenCalledWith(new Uint8Array([7]));
  await vi.advanceTimersByTimeAsync(1000); expect(channel.resizes).toHaveLength(2);
 });
 it("first open does not nudge or reset", async () => {
  vi.useFakeTimers(); const { terminal, channel } = setup(); const reset = vi.fn();
  terminal.subscribeOutput(() => {}, reset); await terminal.open();
  await vi.advanceTimersByTimeAsync(500); expect(channel.resizes).toEqual([]); expect(reset).not.toHaveBeenCalled();
 });
 it("two quick re-subscribes nudge once", async () => {
  vi.useFakeTimers(); const { terminal, channel } = setup(); await terminal.open();
  const off = terminal.subscribeOutput(() => {}); off();
  await vi.advanceTimersByTimeAsync(50); terminal.subscribeOutput(() => {});
  await vi.advanceTimersByTimeAsync(500);
  expect(channel.resizes.map(r => [r.cols, r.rows])).toEqual([[80, 23], [80, 24]]);
 });
 it.each(["closed", "reconnecting"])("does not reset or nudge when subscribing while %s", async status => {
  vi.useFakeTimers(); const { terminal, channel } = setup(); await terminal.open();
  if (status === "closed") await terminal.close();
  else channel.pushExit("terminal-1", { exitStatus: null, reason: "disconnected" });
  const reset = vi.fn(); terminal.subscribeOutput(() => {}, reset);
  await vi.advanceTimersByTimeAsync(500);
  expect(reset).not.toHaveBeenCalled(); expect(channel.resizes).toEqual([]);
  await terminal.close();
 });
 it("cancels a pending redraw on close", async () => {
  vi.useFakeTimers(); const { terminal, channel } = setup(); await terminal.open();
  terminal.subscribeOutput(() => {}); await terminal.close(); await vi.advanceTimersByTimeAsync(500);
  expect(channel.resizes).toEqual([]);
 });
 it("nudges even a one-row terminal and restores its latest dimensions", async () => {
  vi.useFakeTimers(); const { terminal, channel } = setup(); await terminal.open();
  terminal.resize(90, 1); await vi.advanceTimersByTimeAsync(100); channel.resizes.length = 0;
  terminal.subscribeOutput(() => {}); await vi.advanceTimersByTimeAsync(500);
  expect(channel.resizes.map(r => [r.cols, r.rows])).toEqual([[90, 2], [90, 1]]);
 });
 it("treats a capture overflow as a gap: stays open and makes Herdr redraw", async () => {
  vi.useFakeTimers(); const { terminal, channel } = setup(); await terminal.open();
  channel.pushOverflow("terminal-1");
  expect(terminal.state).toEqual({ status: "open" });
  await vi.advanceTimersByTimeAsync(500);
  expect(channel.resizes.map(r => [r.cols, r.rows])).toEqual([[80, 23], [80, 24]]);
  const output: number[] = []; terminal.subscribeOutput(b => output.push(...b));
  channel.pushOutput("terminal-1", new Uint8Array([7])); expect(output).toEqual([7]);
  vi.useRealTimers();
 });
 it("debounces resize to latest dimensions and rejects invalid sizes", async () => {
  vi.useFakeTimers(); const { terminal, channel } = setup(); await terminal.open();
  expect(terminal.resize(0, 20).ok).toBe(false); expect(terminal.resize(2.5, 20).ok).toBe(false); expect(terminal.resize(1001, 20).ok).toBe(false);
  terminal.resize(90, 30); terminal.resize(100, 40); await vi.advanceTimersByTimeAsync(100);
  expect(channel.resizes).toEqual([{ terminalId: "terminal-1", cols: 100, rows: 40 }]);
 });
 it("retries drops on fresh connections at 1, 2, 5, 10 seconds and pauses when inactive", async () => {
  vi.useFakeTimers(); const { terminal, channel, host } = setup(); await terminal.open();
  channel.pushExit("terminal-1", { exitStatus: null, reason: "disconnected" }); host.refuse = failure("UNREACHABLE");
  for (const delay of [1000, 2000, 5000, 10000]) { const count = host.connects.length; await vi.advanceTimersByTimeAsync(delay - 1); expect(host.connects).toHaveLength(count); await vi.advanceTimersByTimeAsync(1); expect(host.connects).toHaveLength(count + 1); }
  terminal.setActive(false); const count = host.connects.length; await vi.advanceTimersByTimeAsync(20000); expect(host.connects).toHaveLength(count);
  host.refuse = null; terminal.setActive(true); await vi.advanceTimersByTimeAsync(10000); expect(terminal.state.status).toBe("open"); expect(channel.opens[1].connectionId).not.toBe(channel.opens[0].connectionId);
  await terminal.close(); await vi.advanceTimersByTimeAsync(20000); expect(channel.opens).toHaveLength(2);
 });
 it.each([0, 1])("does not reconnect after process exit %s", async exitStatus => {
  vi.useFakeTimers(); const { terminal, channel } = setup(); await terminal.open(); channel.pushExit("terminal-1", { exitStatus, reason: "exited" });
  await vi.advanceTimersByTimeAsync(20000); expect(channel.opens).toHaveLength(1); expect(terminal.state).toMatchObject({ status: "closed", reason: exitStatus === 0 ? "Herdr se cerró" : "HERDR_NOT_FOUND" });
 });
 it("discards detached output and detects drops while inactive, but waits for activation to reconnect", async () => {
  vi.useFakeTimers(); const { terminal, channel } = setup(); await terminal.open(); terminal.setActive(false);
  channel.pushOutput("terminal-1", new Uint8Array([7])); let output: number[] = []; terminal.subscribeOutput(b => { output = [...b]; }); expect(output).toEqual([]);
  channel.pushExit("terminal-1", { exitStatus: null, reason: "connection_closed" }); await vi.advanceTimersByTimeAsync(20000); expect(channel.opens).toHaveLength(1);
  terminal.setActive(true); await vi.advanceTimersByTimeAsync(1000); expect(channel.opens).toHaveLength(2);
 });
 it("cancels an opening terminal when the screen closes and never retries", async () => {
  vi.useFakeTimers(); const { terminal, host, channel } = setup(); let release!: () => void;
  const original = channel.open.bind(channel); channel.open = async (...args) => { await new Promise<void>(resolve => { release = resolve; }); return original(...args); };
  const opening = terminal.open(); for (let n = 0; n < 30; n++) await Promise.resolve();
  await terminal.close(); release(); await opening; await vi.advanceTimersByTimeAsync(20000);
  expect(terminal.state).toMatchObject({ status: "closed" }); expect(channel.opens).toHaveLength(1); expect(host.connects).toHaveLength(1);
  expect((await channel.write("terminal-1", new Uint8Array([1]))).ok).toBe(false);
 });
 it("rejects invalid initial dimensions", () => { const { deps } = setup(); expect(() => new HerdrTerminal(deps, savedHost("one"), { cols: NaN, rows: 20 })).toThrow(RangeError); });
 it("keeps unlock failure messages", async () => { const { terminal, host } = setup(); host.locked = true; await terminal.open(); expect(terminal.state).toMatchObject({ status: "unlock-required", code: "UNLOCK_REQUIRED", reason: "UNLOCK_REQUIRED" }); });
 it.each(["/tmp/mars-ram-1000/uploads", "/tmp/my temp/mars-ram-1000/uploads", "/tmp/user's files/uploads", "C:\\Users\\dev\\AppData\\Local\\Temp\\mars-ram\\uploads", "C:\\Users\\my user\\AppData\\Local\\Temp\\mars-ram\\uploads"])("uploads into %s and pastes only its quoted absolute paths without Enter", async folderPath => {
  const { terminal, host, channel, folder } = setup(); host.sourceSizes.set("file://a", 1); await terminal.open();
  const looked = parseUploadsFolder({ ok: true, stdout: JSON.stringify({ v: 1, path: folderPath }), stderr: "", exitStatus: 0 });
  if (!looked.ok) throw new Error(looked.message); folder.result = looked;
  const items = [{ id: "a", sourceUri: "file://a", displayName: "a.txt", size: 1, mimeType: "text/plain", kind: "file" as const }];
  expect(await terminal.pasteAttachmentPaths(items)).toEqual({ ok: true }); const [[key, { name }]] = [...host.uploadedFiles.entries()];
  expect(key).toBe(`${looked.folder.sftpPath}/${name}`);
  const windows = folderPath.startsWith("C:");
  const path = `${folderPath}${windows ? "\\" : "/"}${name}`;
  const quoted = !path.includes(" ") ? path : windows ? `"${path}"` : `'${path.replace(/'/g, "'\\''")}'`;
  expect(channel.writes).toHaveLength(1);
  expect(decode(channel.writes[0].bytes)).toBe(`\x1b[200~${quoted}\x1b[201~`); expect(items).toHaveLength(1);
 });
 it("sends nothing for an empty batch or a failure after a successful upload", async () => {
  const { terminal, host, channel } = setup(); await terminal.open();
  expect(await terminal.pasteAttachmentPaths([])).toEqual({ ok: true }); expect(channel.writes).toHaveLength(0);
  host.sourceSizes.set("file://a", 1);
  const items = ["a", "missing"].map(id => ({ id, sourceUri: `file://${id}`, displayName: `${id}.txt`, size: 1, mimeType: "text/plain", kind: "file" as const }));
  expect((await terminal.pasteAttachmentPaths(items)).ok).toBe(false); expect(channel.writes).toHaveLength(0);
 });
 it.each([
  [{ ok: false as const, code: "UPDATE_REQUIRED" as const, message: UPDATE_REQUIRED_MESSAGE }, UPDATE_REQUIRED_MESSAGE],
  [{ ok: false as const, code: "PERMISSION_DENIED" as const, message: "Uploads folder refused: not private." }, "Uploads folder refused: not private."],
 ])("uploads and pastes nothing when the uploads folder lookup fails (%#)", async (result, message) => {
  const { terminal, host, channel, folder } = setup(); folder.result = result; host.sourceSizes.set("file://a", 1); await terminal.open();
  expect(await terminal.pasteAttachmentPaths([{ id: "a", sourceUri: "file://a", displayName: "a.txt", size: 1, mimeType: "text/plain", kind: "file" }])).toEqual({ ok: false, message });
  expect(channel.writes).toHaveLength(0); expect(host.uploadedFiles.size).toBe(0);
 });
 it.each(["too many", "too large"])("keeps upload limits for %s without pasting", async reason => {
  const { terminal, host, channel } = setup(); await terminal.open(); host.sourceSizes.set("file://a", 1);
  const item = { id: "a", sourceUri: "file://a", displayName: "a.txt", size: reason === "too large" ? 25 * 1024 * 1024 + 1 : 1, mimeType: "text/plain", kind: "file" as const };
  const result = await terminal.pasteAttachmentPaths(reason === "too many" ? Array.from({ length: 11 }, () => item) : [item]);
  expect(result).toEqual({ ok: false, message: reason === "too many" ? "Attach at most 10 files." : "a.txt is over 25 MB. Choose a smaller file." });
  expect(channel.writes).toHaveLength(0); expect(host.uploadedFiles.size).toBe(0);
 });
 it("does not paste into a replacement terminal after disconnecting during upload", async () => {
  const { terminal, host, channel } = setup(); await terminal.open(); host.sourceSizes.set("file://a", 1);
  const upload = host.uploadFile.bind(host); let release!: () => void;
  host.uploadFile = async (...args) => { await new Promise<void>(resolve => { release = resolve; }); return upload(...args); };
  const items = [{ id: "a", sourceUri: "file://a", displayName: "a.txt", size: 1, mimeType: "text/plain", kind: "file" as const }];
  const pending = terminal.pasteAttachmentPaths(items); for (let n = 0; n < 30; n++) await Promise.resolve();
  expect((await terminal.pasteAttachmentPaths(items)).ok).toBe(false);
  await terminal.close(); release(); expect((await pending).ok).toBe(false); expect(channel.writes).toHaveLength(0);
 });
});
describe("terminalKey", () => {
 it.each(Object.entries({ esc: "\x1b", tab: "\t", enter: "\r", backspace: "\x7f", up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D", home: "\x1b[H", end: "\x1b[F", pageup: "\x1b[5~", pagedown: "\x1b[6~" }))("maps %s", (key, value) => expect(decode(terminalKey(key, false))).toBe(value));
 it.each(Object.entries({ up: "A", down: "B", right: "C", left: "D", home: "H", end: "F" }))("application mode %s", (key, suffix) => expect(decode(terminalKey(key, true))).toBe(`\x1bO${suffix}`));
 it("maps every control letter and rejects unknown keys", () => { for (let i = 1; i <= 26; i++) expect([...terminalKey(`ctrl+${String.fromCharCode(96 + i)}`, false)]).toEqual([i]); expect([...terminalKey("unknown", false)]).toEqual([]); });
});
