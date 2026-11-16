import { afterEach, describe, expect, it, vi } from "vitest";

// Minimal hook runtime: effects run when the test calls them, so each hook's decisions are observable.
const focusEffects = vi.hoisted(() => [] as (() => void | (() => void))[]);
vi.mock("react", () => ({
 useState: (initial: unknown) => [typeof initial === "function" ? (initial as () => unknown)() : initial, () => {}],
 useRef: (current: unknown) => ({ current }),
 useCallback: (fn: unknown) => fn,
}));
vi.mock("expo-router", () => ({ useFocusEffect: (effect: () => void | (() => void)) => { focusEffects.push(effect); } }));
vi.mock("react-native", () => ({ AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) } }));
const services = vi.hoisted(() => ({
 catalog: { list: vi.fn(async () => []) },
 herdrSwitcher: { list: vi.fn(async () => ({ ok: false })) },
 sessions: { list: vi.fn(async () => ({ computers: [] })) },
}));
vi.mock("../src/services", () => services);

import { HerdrTerminal } from "../src/core/herdr-terminal";
import { HostConnections } from "../src/core/host-connections";
import type { HostConnection } from "../src/core/ports";
import { useShellBlurClose } from "../src/ui/use-shell-blur-close";
import { usePaneChat } from "../src/ui/use-pane-chat";
import { FakeSsh, FakeTerminalChannel, FakeUploadsFolder, savedHost } from "./fakes";

afterEach(() => { focusEffects.length = 0; vi.clearAllMocks(); vi.useRealTimers(); });

describe("pane chat in the plain shell", () => {
 it("never lists Herdr panes, Pi sessions or the catalog when disabled, even over time", async () => {
  vi.useFakeTimers();
  const result = usePaneChat("one", undefined, false);
  const cleanup = focusEffects.map(effect => effect());
  await vi.advanceTimersByTimeAsync(30_000);
  expect(services.catalog.list).not.toHaveBeenCalled();
  expect(services.herdrSwitcher.list).not.toHaveBeenCalled();
  expect(services.sessions.list).not.toHaveBeenCalled();
  expect(result.sessionKey).toBeUndefined(); expect(result.session).toBeUndefined();
  cleanup.forEach(off => typeof off === "function" && off());
 });
 it("still discovers for Herdr terminals", async () => {
  usePaneChat("one", undefined, true);
  const cleanup = focusEffects.map(effect => effect()); await Promise.resolve();
  expect(services.catalog.list).toHaveBeenCalled();
  cleanup.forEach(off => typeof off === "function" && off());
 });
});

describe("plain shell blur", () => {
 async function openShell() {
  const host = new FakeSsh(); const channel = new FakeTerminalChannel();
  const connections = new HostConnections({ host: host as unknown as HostConnection, keyAlias: "key", unlock: async () => false });
  const terminal = new HerdrTerminal({ connections, channel, host: host as unknown as HostConnection, uploadsFolder: new FakeUploadsFolder(), clock: () => 0, random: () => 0 }, savedHost("one"), { cols: 80, rows: 24, shell: true });
  await terminal.open();
  return { terminal, channel };
 }
 it("closes the shell's SSH channel when the screen is blurred and asks for a fresh shell on return", async () => {
  const { terminal, channel } = await openShell(); const close = vi.spyOn(channel, "close"); const restart = vi.fn();
  useShellBlurClose(true, { current: terminal }, restart);
  const blur = focusEffects.map(effect => effect());
  expect(close).not.toHaveBeenCalled();
  blur.forEach(off => typeof off === "function" && off());
  await Promise.resolve();
  expect(close).toHaveBeenCalledWith("terminal-1"); expect(terminal.state).toMatchObject({ status: "closed" });
  expect(restart).toHaveBeenCalledOnce();
 });
 it("keeps a Herdr terminal's channel on blur", async () => {
  const { terminal, channel } = await openShell(); const close = vi.spyOn(channel, "close"); const restart = vi.fn();
  useShellBlurClose(false, { current: terminal }, restart);
  focusEffects.map(effect => effect()).forEach(off => typeof off === "function" && off());
  expect(close).not.toHaveBeenCalled(); expect(restart).not.toHaveBeenCalled();
 });
});
