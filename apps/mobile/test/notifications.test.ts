import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationRegistration, NotificationSettings, buildNotifyCommand, parseNotifyRegistration, type NotificationPorts } from "../src/core/notifications";
import { decodeNotificationLink, notificationDestination } from "../src/core/notification-routing";
import type { SavedHost } from "../src/core/host-catalog";

const host: SavedHost = { id: "pc", name: "PC", address: "100.64.0.2", sshPort: 22, user: "me", hostKey: `SHA256:${"a".repeat(43)}`, keyAlias: "app-ssh-key-2", addedAt: 0 };
function fake() {
 const calls: string[] = []; let stored: unknown = "off"; let allowed = true; let visible = true;
 const ports: NotificationPorts = {
  read: () => stored, write: async mode => { stored = mode; calls.push(`save:${mode}`); },
  permission: async () => { calls.push("permission"); return allowed; }, visible: () => visible,
  connect: async h => { calls.push(`connect:${h.id}`); return { ok: true }; },
  hosts: async () => [host], start: async config => { calls.push(`start:${config.mode}`); return { ok: true }; }, stop: async () => { calls.push("stop"); },
  status: () => ({ state: "running", hosts: {} }), register: async h => { calls.push(`register:${h.id}`); return "ok"; },
  unregister: async h => { calls.push(`unregister:${h.id}`); }, forget: async id => { calls.push(`forget:${id}`); },
 };
 return { calls, ports, allow: (v: boolean) => { allowed = v; }, visible: (v: boolean) => { visible = v; }, stored: (v: unknown) => { stored = v; } };
}
afterEach(() => vi.useRealTimers());
describe("notification preparation deadlines", () => {
 it.each(["while-working", "always"] as const)("settles hung %s preparation and allows a queued Off", async mode => {
  vi.useFakeTimers(); const f = fake();
  f.ports.hosts = async () => [host, { ...host, id: "pc2" }];
  f.ports.connect = async () => new Promise(() => {});
  f.ports.register = async () => new Promise(() => {});
  const model = new NotificationSettings(f.ports);
  const choosing = model.choose(mode);
  await vi.advanceTimersByTimeAsync(0); expect(model.snapshot().busy).toBe(true);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(model.snapshot()).toMatchObject({ busy: false, error: "WATCH_TIMEOUT", computers: [{ hostId: "pc", result: "PREPARATION_TIMEOUT" }, { hostId: "pc2", result: "PREPARATION_TIMEOUT" }] });
  expect(f.calls).not.toContain(`start:${mode}`);
  await choosing;
  // Remote revocation also cannot hold the transition queue forever.
  f.ports.unregister = async () => new Promise(() => {});
  const off = model.choose("off"); await vi.advanceTimersByTimeAsync(60_000); await off;
  expect(model.snapshot()).toMatchObject({ mode: "off", busy: false });
 });
 it("ignores a connection resolving after timeout and after Off", async () => {
  vi.useFakeTimers(); const f = fake(); let resolve!: (result: { ok: true }) => void;
  f.ports.connect = () => new Promise(r => { resolve = r; });
  const model = new NotificationSettings(f.ports); const choosing = model.choose("while-working");
  await vi.advanceTimersByTimeAsync(30_000);
  expect(model.snapshot().busy).toBe(false); await choosing; await model.choose("off");
  resolve({ ok: true }); await vi.advanceTimersByTimeAsync(0);
  expect(model.snapshot().mode).toBe("off"); expect(f.calls).not.toContain("start:while-working");
 });
 it.each(["permission", "stop", "write", "hosts", "start"] as const)("also bounds a hung %s port", async port => {
  vi.useFakeTimers(); const f = fake();
  Object.assign(f.ports, { [port]: () => new Promise(() => {}) });
  const model = new NotificationSettings(f.ports); const choosing = model.choose("while-working");
  await vi.advanceTimersByTimeAsync(30_000);
  expect(model.snapshot()).toMatchObject({ busy: false, error: "WATCH_TIMEOUT" });
  await choosing;
 });
 it("settles cancelled unlock as a per-computer failure", async () => {
  const f = fake(); f.ports.connect = async () => ({ ok: false, code: "UNLOCK_REQUIRED" });
  const model = new NotificationSettings(f.ports); await model.choose("while-working");
  expect(model.snapshot()).toMatchObject({ busy: false, error: "UNLOCK_REQUIRED", computers: [{ hostId: "pc", result: "CONNECTION_FAILED" }] });
 });
});
describe("notification opt-in state machine", () => {
 it("starts only prepared computers and reports failures independently", async () => {
  const f = fake(); const second = { ...host, id: "offline", name: "Offline" }; const third = { ...host, id: "broken", name: "Broken" };
  f.ports.hosts = async () => [host, second, third];
  f.ports.connect = async h => {
   if (h.id === "broken") throw Error("transport");
   return h.id === "pc" ? { ok: true } : { ok: false, code: "UNLOCK_REQUIRED" };
  };
  let config: unknown; f.ports.start = async c => { config = c; return { ok: true }; };
  const model = new NotificationSettings(f.ports); await model.choose("while-working");
  expect(config).toMatchObject({ mode: "while-working", hosts: [{ hostId: "pc" }] });
  expect((config as { hosts: unknown[] }).hosts).toHaveLength(1);
  expect(model.snapshot().computers).toEqual([
   { hostId: "pc", name: "PC", result: "ok" },
   { hostId: "offline", name: "Offline", result: "CONNECTION_FAILED" },
   { hostId: "broken", name: "Broken", result: "CONNECTION_FAILED" },
  ]);
  expect(model.snapshot().error).toBeUndefined();
 });
 it("aborts only when no computers prepared, then replaces results on retry", async () => {
  const f = fake(); f.ports.connect = async () => ({ ok: false, code: "UNLOCK_REQUIRED" });
  const model = new NotificationSettings(f.ports); await model.choose("while-working");
  expect(f.calls).not.toContain("start:while-working");
  expect(model.snapshot().computers).toEqual([{ hostId: "pc", name: "PC", result: "CONNECTION_FAILED" }]);
  f.ports.connect = async () => ({ ok: true }); await model.choose("while-working");
  expect(model.snapshot().computers).toEqual([{ hostId: "pc", name: "PC", result: "ok" }]);
  expect(f.calls).toContain("start:while-working");
 });
 it("prepares a UI connection before starting or rearming while visible", async () => {
  const f = fake();
  const model = new NotificationSettings(f.ports);
  await model.choose("while-working");
  expect(f.calls.indexOf("connect:pc")).toBeGreaterThan(-1);
  expect(f.calls.indexOf("connect:pc")).toBeLessThan(f.calls.indexOf("start:while-working"));
  f.calls.length = 0; f.ports.status = () => ({ state: "stopped", hosts: {} });
  await model.ensureWatching();
  expect(f.calls).toEqual(["connect:pc", "start:while-working"]);
 });
 it("does not start after cancelled unlock or after preparation loses visibility", async () => {
  const f = fake();
  f.ports.connect = async () => ({ ok: false, code: "UNLOCK_REQUIRED" });
  const model = new NotificationSettings(f.ports); await model.choose("while-working");
  expect(f.calls).not.toContain("start:while-working");
  expect(model.snapshot().error).toBe("UNLOCK_REQUIRED");
  f.ports.connect = async () => { f.visible(false); return { ok: true }; };
  await model.choose("while-working");
  expect(f.calls).not.toContain("start:while-working");
 });
 it("defaults off; denial persists off without registration or service", async () => {
  const f = fake(); f.stored("broken"); f.allow(false); const model = new NotificationSettings(f.ports);
  expect(model.snapshot().mode).toBe("off"); await model.choose("always");
  expect(model.snapshot()).toMatchObject({ mode: "off", error: "NOTIFICATIONS_DENIED" });
  expect(f.calls).toEqual(["permission", "stop", "save:off"]);
 });
 it("returns to Off if Android reports notifications disabled at native start", async () => {
  const f = fake(); f.ports.start = async () => ({ ok: false, code: "NOTIFICATIONS_DENIED" });
  const model = new NotificationSettings(f.ports); await model.choose("while-working");
  expect(model.snapshot()).toMatchObject({ mode: "off", error: "NOTIFICATIONS_DENIED" });
 });
 it("starts with every saved host's actual alias and pin, only when visible", async () => {
  const f = fake(); let config: unknown; f.ports.start = async c => { config = c; return { ok: true }; };
  const model = new NotificationSettings(f.ports); await model.choose("while-working");
  expect(config).toMatchObject({ mode: "while-working", language: "en", hosts: [{ hostId: "pc", connection: { keyAlias: "app-ssh-key-2", expectedFingerprint: host.hostKey } }] });
  f.visible(false); config = null; await model.ensureWatching(); expect(config).toBeNull();
  await model.choose("off"); expect(f.calls).toContain("stop");
 });
 it("reconfigures a running watch after saved computers change", async () => {
  const f = fake(); const model = new NotificationSettings(f.ports);
  await model.choose("while-working"); f.calls.length = 0;
  await model.computersChanged();
  expect(f.calls).toEqual(["stop", "connect:pc", "start:while-working"]);
 });
 it("reports registration independently, starts only confirmed computers, and revokes when leaving always", async () => {
  const f = fake(); f.ports.hosts = async () => [host, { ...host, id: "old", name: "Old" }];
  f.ports.register = async h => h.id === "old" ? "UPDATE_REQUIRED" : "ok";
  let config: unknown; f.ports.start = async c => { config = c; return { ok: true }; };
  const model = new NotificationSettings(f.ports); await model.choose("always");
  expect(model.snapshot().computers).toEqual([{ hostId: "pc", name: "PC", result: "ok" }, { hostId: "old", name: "Old", result: "UPDATE_REQUIRED" }]);
  expect(config).toMatchObject({ mode: "always", hosts: [{ hostId: "pc", hostKeyId: host.hostKey }] });
  await model.choose("off"); expect(f.calls).toContain("unregister:pc"); expect(f.calls).toContain("forget:pc");
 });
 it("serializes rapid mode changes and rechecks visibility after registration", async () => {
  const f = fake(); let release!: () => void;
  f.ports.register = async () => { await new Promise<void>(resolve => { release = resolve; }); return "ok"; };
  const model = new NotificationSettings(f.ports);
  const enable = model.choose("always");
  await new Promise(resolve => setTimeout(resolve, 0));
  const disable = model.choose("off"); f.visible(false); release();
  await Promise.all([enable, disable]);
  expect(model.snapshot().mode).toBe("off"); expect(f.calls).not.toContain("start:always");
  expect(f.calls).toContain("forget:pc");
 });
 it("local revocation survives a failed remote unregister, including deletion", async () => {
  const f = fake(); f.ports.unregister = async () => { throw Error("offline"); };
  const model = new NotificationSettings(f.ports); await model.removeComputer(host);
  expect(f.calls).toContain("forget:pc");
 });
 it("does not permit deletion to proceed when local revocation fails", async () => {
  const f = fake(); f.ports.forget = async () => { throw Error("storage failed"); };
  const model = new NotificationSettings(f.ports);
  await expect(model.removeComputer(host)).rejects.toThrow();
 });
 it("does not claim a running watch after a start failure; retries only explicitly or for working sessions", async () => {
  const f = fake(); f.ports.start = async () => ({ ok: false, code: "START_NOT_ALLOWED" });
  const model = new NotificationSettings(f.ports); await model.choose("while-working");
  expect(model.snapshot().error).toBe("START_NOT_ALLOWED");
  f.ports.status = () => ({ state: "error", hosts: {}, code: "TAILSCALE_REQUIRED" }); model.refreshStatus();
  expect(model.snapshot().error).toBe("TAILSCALE_REQUIRED");
 });
});
describe("notification registration boundary", () => {
 it("does not register or send credentials after a timed-out connection resolves late", async () => {
  let resolve!: (result: { ok: true; connectionId: string }) => void;
  const register = vi.fn(); const exec = vi.fn(); const readFile = vi.fn();
  const registrar = new NotificationRegistration({
   connections: { connection: () => new Promise(r => { resolve = r; }) },
   host: { readFile, execWithInput: exec }, local: { register },
  });
  const controller = new AbortController(); const pending = registrar.register(host, controller.signal);
  controller.abort(); resolve({ ok: true, connectionId: "late" });
  expect(await pending).toBe("REGISTRATION_FAILED");
  expect(readFile).not.toHaveBeenCalled(); expect(register).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
 });
 it("sends registration secrets only on SSH stdin and rejects a mismatched reply", async () => {
  const writes: { command: string; input: string }[] = [];
  const registrar = new NotificationRegistration({
   connections: { connection: async () => ({ ok: true, connectionId: "c" }) },
   host: { readFile: async () => ({ ok: true, content: JSON.stringify({ node: "/bin/node", cli: "/app/main.ts" }) }),
    execWithInput: async (_id, command, input) => { writes.push({ command, input }); return { ok: true, stdout: JSON.stringify({ v: 1, ok: true, hostKeyId: "wrong", port: 47812 }), stderr: "", exitStatus: 0 }; } },
   local: { register: async () => ({ secret: "test-only-secret", port: 47812 }) },
  });
  expect(await registrar.register(host)).toBe("REGISTRATION_FAILED");
  expect(writes).toEqual([{ command: "'/bin/node' '/app/main.ts' notify register --json", input: '{"secret":"test-only-secret","port":47812}\n' }]);
 });
 it("uses fixed verbs and installed node/CLI paths on both shells; no secret in argv", () => {
  expect(buildNotifyCommand({ node: "/usr/bin/node", cli: "/home/me/main.ts" }, "register")).toBe("'/usr/bin/node' '/home/me/main.ts' notify register --json");
  expect(buildNotifyCommand({ node: "C:\\Program Files\\node.exe", cli: "C:\\app\\main.ts" }, "unregister")).toBe('"C:\\Program Files\\node.exe" "C:\\app\\main.ts" notify unregister');
  expect(() => buildNotifyCommand({ node: "/bin/node;evil", cli: "/main.ts" }, "register")).toThrow();
 });
 it("requires versioned success, matching pinned identity and port; never trusts arbitrary stdout", () => {
  const data = { v: 1, ok: true, hostKeyId: host.hostKey, port: 47812 };
  expect(parseNotifyRegistration(JSON.stringify(data), host.hostKey, 47812)).toBe(true);
  for (const value of [{ ...data, v: 2 }, { ...data, hostKeyId: "other" }, { ...data, port: 1 }, { ...data, ok: false }]) expect(parseNotifyRegistration(JSON.stringify(value), host.hostKey, 47812)).toBe(false);
  expect(parseNotifyRegistration("old command help", host.hostKey, 47812)).toBe(false);
 });
});
const hex = (s: string) => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i).toString(16).padStart(4, "0")).join("");
describe("notification tap boundary", () => {
 it("decodes UTF-16 exactly once, retaining slashes, Unicode and lone surrogates", async () => {
  const bridge = "a/💚\ud800"; const path = `mars-ram://notice?h=${hex("pc")}&b=${hex(bridge)}&encoding=utf16-hex`;
  expect(decodeNotificationLink(path)).toEqual({ hostId: "pc", bridgeInstanceId: bridge });
  const routable = path.replace(hex(bridge), hex("session/💚"));
  expect(await notificationDestination(routable, async () => [{ hostId: "pc", bridgeInstanceId: "session/💚", key: "pc/session/💚" }])).toBe(`/session/open/${encodeURIComponent("pc/session/💚")}`);
 });
 it("fails closed for unknown hosts, ended sessions, malformed/extra parameters and non-notification links", async () => {
  const good = `mars-ram-preview://notice?h=${hex("pc")}&b=${hex("s")}&encoding=utf16-hex`;
  expect(await notificationDestination(good, async () => [])).toBe("/");
  for (const path of [good + "&x=1", good.replace("0073", "%30%30%37%33"), good.replace("0073", "073"), "https://notice?h=0070&b=0073&encoding=utf16-hex", "/session/secret"]) expect(decodeNotificationLink(path)).toBeNull();
 });
});
