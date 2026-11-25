import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const f = vi.hoisted(() => ({
 effects: [] as (() => void | (() => void))[], state: [] as unknown[], window: { width: 412, height: 915 },
 appState: [] as ((value: string) => void)[], removed: 0,
}));
vi.mock("react", async importOriginal => ({
 ...await importOriginal<typeof import("react")>(),
 useState: (initial: unknown) => {
  const index = 0; if (f.state.length === 0) f.state.push(typeof initial === "function" ? (initial as () => unknown)() : initial);
  return [f.state[index], (value: unknown) => { f.state[index] = value; }];
 },
 useRef: (initial: unknown) => ({ current: initial }),
 useEffect: (effect: () => void | (() => void)) => { f.effects.push(effect); },
}));
vi.mock("react-native", () => ({
 Platform: { OS: "android" },
 useWindowDimensions: () => f.window,
 AppState: { addEventListener: (_type: string, listener: (value: string) => void) => { f.appState.push(listener); return { remove: () => { f.removed++; } }; } },
}));
vi.mock("../modules/ssh/src/SshModule", () => ({ default: {} }));
vi.mock("../src/services", () => ({ systemGestureInsets: { read: async () => null } }));
import { createSystemGestureInsets, parseSystemGestureInsets } from "../src/adapters/native-system-gesture-insets";
import { useSystemGestureInset } from "../src/ui/system-gesture-inset";

afterEach(() => { f.effects.length = 0; f.state.length = 0; f.appState.length = 0; f.removed = 0; });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("native system gesture insets adapter", () => {
 it("passes real dp numbers through", async () => {
  const native = { systemGestureInsets: vi.fn(async () => ({ mandatoryBottom: 32, navigationBottom: 15 })) };
  expect(await createSystemGestureInsets(native).read()).toEqual({ mandatoryBottom: 32, navigationBottom: 15 });
 });
 it("is unavailable (null) off Android, on older Android, on a failed call or a damaged answer", async () => {
  expect(await createSystemGestureInsets(null).read()).toBeNull();
  expect(await createSystemGestureInsets({ systemGestureInsets: async () => null }).read()).toBeNull();
  expect(await createSystemGestureInsets({ systemGestureInsets: async () => { throw new Error("no activity"); } }).read()).toBeNull();
  expect(await createSystemGestureInsets({ systemGestureInsets: () => { throw new Error("missing function"); } }).read()).toBeNull();
  for (const raw of [{ mandatoryBottom: "32", navigationBottom: 15 }, { mandatoryBottom: -1, navigationBottom: 15 }, { mandatoryBottom: Number.NaN, navigationBottom: 0 }, { navigationBottom: 15 }, 7])
   expect(parseSystemGestureInsets(raw)).toBeNull();
 });
});

describe("useSystemGestureInset", () => {
 // Runs the effect of the latest render, as React would after commit.
 const run = () => [f.effects.at(-1)!()];
 it("starts with the fallback, then uses the native reading", async () => {
  const source = { read: vi.fn(async () => ({ mandatoryBottom: 32, navigationBottom: 15 })) };
  expect(useSystemGestureInset(15, source)).toBe(32);
  expect(useSystemGestureInset(48, source)).toBe(48);
  run(); await flush();
  expect(source.read).toHaveBeenCalledTimes(1);
  expect(useSystemGestureInset(15, source)).toBe(32);
  f.state[0] = { mandatoryBottom: 40, navigationBottom: 15 };
  expect(useSystemGestureInset(15, source)).toBe(40);
 });
 it("re-reads when the app comes back (navigation mode changed in Settings) and stops on unmount", async () => {
  const source = { read: vi.fn(async () => ({ mandatoryBottom: 32, navigationBottom: 15 })) };
  useSystemGestureInset(15, source);
  const cleanups = run();
  f.appState[0]("background"); expect(source.read).toHaveBeenCalledTimes(1);
  f.appState[0]("active"); expect(source.read).toHaveBeenCalledTimes(2);
  for (const cleanup of cleanups) cleanup?.();
  expect(f.removed).toBe(1);
 });
 it("ignores an answer that arrives after unmount", async () => {
  let answer!: (value: unknown) => void;
  const source = { read: vi.fn(() => new Promise<any>(resolve => { answer = resolve; })) };
  useSystemGestureInset(15, source);
  const cleanups = run(); for (const cleanup of cleanups) cleanup?.();
  answer({ mandatoryBottom: 99, navigationBottom: 0 }); await flush();
  expect(f.state[0]).toBeNull();
 });
 it("re-reads on rotation and on a safe-area change", () => {
  // The read effect depends on the window size and the safe-area bottom, so either change runs it again.
  const hook = readFileSync(new URL("../src/ui/system-gesture-inset.ts", import.meta.url), "utf8");
  expect(hook).toMatch(/\}, \[window\.width, window\.height, safeBottom, source\]\);/);
 });
});
