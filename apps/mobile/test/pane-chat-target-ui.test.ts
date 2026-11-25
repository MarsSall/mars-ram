import { afterEach, describe, expect, it, vi } from "vitest";

// claude-codex L20: the floating chat retargeted to lnedev when its «terminó» notice arrived.
// Minimal stateful hook runtime: state survives re-renders, effects run when the test calls them.
const runtime = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, focusEffects: [] as (() => void | (() => void))[], appState: [] as ((value: string) => void)[] }));
vi.mock("react", () => ({
 useState: (initial: unknown) => {
  const i = runtime.index++;
  if (!(i in runtime.slots)) runtime.slots[i] = typeof initial === "function" ? (initial as () => unknown)() : initial;
  return [runtime.slots[i], (next: unknown) => { runtime.slots[i] = typeof next === "function" ? (next as (v: unknown) => unknown)(runtime.slots[i]) : next; }];
 },
 useRef: (current: unknown) => { const i = runtime.index++; if (!(i in runtime.slots)) runtime.slots[i] = { current }; return runtime.slots[i]; },
 useCallback: (fn: unknown) => fn,
}));
vi.mock("expo-router", () => ({ useFocusEffect: (effect: () => void | (() => void)) => { runtime.focusEffects.push(effect); } }));
vi.mock("react-native", () => ({ AppState: { currentState: "active", addEventListener: (_: string, listener: (value: string) => void) => { runtime.appState.push(listener); return { remove() {} }; } } }));

type Pane = { id: string; focused: boolean };
const world = vi.hoisted(() => ({ focusedPane: "w:p2", lnedevStatus: "working" }));
const services = vi.hoisted(() => ({
 catalog: { list: vi.fn(async () => [{ id: "host", name: "linux" }]) },
 herdrSwitcher: { list: vi.fn(async () => {
  const panes: Pane[] = [{ id: "w:p2", focused: world.focusedPane === "w:p2" }];
  const other: Pane[] = [{ id: "w:p9", focused: world.focusedPane === "w:p9" }];
  return { ok: true, value: { truncated: false, workspaces: [{ id: "w", label: "w", focused: true, status: "idle", branch: null, tabs: [
   { id: "w:t1", label: "claude", focused: world.focusedPane === "w:p2", status: "idle", kind: "agent", panes },
   { id: "w:t2", label: "pi", focused: world.focusedPane === "w:p9", status: "done", kind: "pi", panes: other },
  ] }] } };
 }) },
 sessions: { list: vi.fn(async () => ({ computers: [{ hostId: "host", state: "ok", sessions: [
  { key: "host/claude", hostId: "host", bridgeInstanceId: "c", terminalPane: "w:p2", project: "mars-ram", cwd: "/m", status: "working", lastActivityAt: 1, lastMessage: null, agent: "claude-code" },
  { key: "host/lnedev", hostId: "host", bridgeInstanceId: "l", terminalPane: "w:p9", project: "lnedev", cwd: "/l", status: world.lnedevStatus, lastActivityAt: 2, lastMessage: null },
 ] }] })) },
}));
vi.mock("../src/services", () => services);

import { usePaneChat } from "../src/ui/use-pane-chat";

function render() { runtime.index = 0; runtime.focusEffects.length = 0; return usePaneChat("host", "host/claude", true); }
async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

afterEach(() => { runtime.slots = []; runtime.appState.length = 0; world.focusedPane = "w:p2"; world.lnedevStatus = "working"; vi.clearAllMocks(); vi.useRealTimers(); });

describe("floating chat target", () => {
 it("keeps Claude Code as the target when lnedev finishes and Herdr focuses its tab", async () => {
  vi.useFakeTimers();
  render(); const cleanup = runtime.focusEffects.map(effect => effect()); await vi.advanceTimersByTimeAsync(0); await settle();
  expect(render().sessionKey).toBe("host/claude");
  world.focusedPane = "w:p9"; world.lnedevStatus = "done";
  await vi.advanceTimersByTimeAsync(10_000); await settle();
  expect(render().sessionKey).toBe("host/claude");
  runtime.appState.forEach(listener => listener("active")); await settle();
  const after = render();
  // The draft is keyed by the target (`chat:<key>`) and send goes to the live session of this key.
  expect(after.sessionKey).toBe("host/claude");
  expect(after.session?.project).toBe("mars-ram");
  cleanup.forEach(off => typeof off === "function" && off());
 });
 it("switches only when the user explicitly picks another session", async () => {
  vi.useFakeTimers();
  render(); const cleanup = runtime.focusEffects.map(effect => effect()); await vi.advanceTimersByTimeAsync(0); await settle();
  world.focusedPane = "w:p9";
  render().refresh(); await settle();
  const after = render();
  expect(after.sessionKey).toBe("host/lnedev");
  expect(after.session?.project).toBe("lnedev");
  cleanup.forEach(off => typeof off === "function" && off());
 });
});
