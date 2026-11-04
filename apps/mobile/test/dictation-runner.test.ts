import { describe, expect, it, vi } from "vitest";
import { DictationRunner, type DictationEngine } from "../src/core/dictation";

// The hook's effect runner (verify mvyl83hd-d-kw31 H1–H4): cancellation is never queued behind a
// start-up, and nothing is delivered after the owner left.
function fakeEngine() {
 let release!: () => void;
 const calls: string[] = [];
 const engine: DictationEngine = {
  modelReady: async () => true, warm: async () => {}, removeModel: async () => {},
  download: () => ({ promise: Promise.resolve({ ok: true }), cancel: async () => {} }),
  start: vi.fn(async () => { calls.push("start"); await new Promise<void>(resolve => { release = resolve; }); calls.push("opened"); return { ok: true as const }; }),
  cancel: vi.fn(async () => { calls.push("cancel"); }),
  abortTranscription: vi.fn(async () => { calls.push("abort"); }),
  finish: vi.fn(async () => { calls.push("finish"); return { ok: true as const, text: "git status", seconds: 1 }; }),
 };
 return { engine, calls, open: () => release() };
}
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe("DictationRunner", () => {
 it("never starts the microphone when disposed before the queued start runs", async () => {
  const { engine } = fakeEngine(); const runner = new DictationRunner(engine, () => {});
  runner.dispatch({ type: "pressIn", now: 0 });
  runner.dispose();
  await tick();
  expect(engine.start).not.toHaveBeenCalled();
  expect(engine.cancel).toHaveBeenCalled();
 });
 it("cancels at once when the app leaves the foreground during a slow start-up", async () => {
  const { engine, calls, open } = fakeEngine(); const runner = new DictationRunner(engine, () => {});
  runner.dispatch({ type: "pressIn", now: 0 });
  await tick();
  runner.dispatch({ type: "abort", now: 10 });
  expect(calls).toEqual(["start", "cancel"]); // Not queued behind the start-up.
  open(); await tick();
  expect(runner.state).toEqual({ phase: "idle" });
 });
 it("delivers the text of a finished dictation, but nothing after dispose", async () => {
  const delivered: string[] = [];
  const { engine, open } = fakeEngine(); const runner = new DictationRunner(engine, text => delivered.push(text));
  runner.dispatch({ type: "pressIn", now: 0 }); await tick(); open();
  runner.dispatch({ type: "pressOut", now: 1000 });
  await vi.waitFor(() => expect(delivered).toEqual(["git status"]));
  expect(runner.state).toEqual({ phase: "idle" });
  const late = fakeEngine(); const gone: string[] = [];
  const second = new DictationRunner(late.engine, text => gone.push(text));
  second.dispatch({ type: "pressIn", now: 0 }); await tick(); late.open();
  second.dispatch({ type: "pressOut", now: 1000 });
  second.dispose();
  await tick(); await tick();
  expect(gone).toEqual([]);
 });
 it("stops a transcription that outlives its limit and reports where it stalled", async () => {
  vi.useFakeTimers();
  try {
   const { engine, open } = fakeEngine();
   (engine.finish as ReturnType<typeof vi.fn>).mockImplementation((_owner: symbol, step?: (s: "transcribing") => void) => { step?.("transcribing"); return new Promise(() => {}); });
   const runner = new DictationRunner(engine, () => {}, 30_000);
   runner.dispatch({ type: "pressIn", now: 0 }); await tick(); open();
   runner.dispatch({ type: "pressOut", now: 1000 });
   await vi.advanceTimersByTimeAsync(30_001);
   expect(engine.abortTranscription).toHaveBeenCalledOnce();
   expect(runner.error).toBe("ENGINE_FAILED"); expect(runner.stalled).toBe("transcribing");
   expect(runner.state).toEqual({ phase: "idle" });
  } finally { vi.useRealTimers(); }
 });
 it("drops a dictation released just before the app left the foreground, even if its start-up is still pending", async () => {
  const delivered: string[] = [];
  const { engine, open } = fakeEngine(); const runner = new DictationRunner(engine, text => delivered.push(text));
  runner.dispatch({ type: "pressIn", now: 0 }); await tick();
  runner.dispatch({ type: "pressOut", now: 1000 }); // transcribing, start-up still pending
  runner.dispatch({ type: "abort", now: 1100 });
  expect(engine.cancel).toHaveBeenCalled();
  open(); await tick(); await tick();
  expect(engine.finish).not.toHaveBeenCalled();
  expect(delivered).toEqual([]);
  expect(runner.state).toEqual({ phase: "idle" });
 });
 it("stops its timer when an effect fails unexpectedly", async () => {
  vi.useFakeTimers();
  try {
   const { engine } = fakeEngine();
   (engine.start as ReturnType<typeof vi.fn>).mockImplementation(async () => { throw Error("native"); });
   const runner = new DictationRunner(engine, () => {});
   const tickSpy = vi.spyOn(runner, "dispatch");
   runner.dispatch({ type: "pressIn", now: Date.now() });
   await vi.advanceTimersByTimeAsync(10);
   expect(runner.error).toBe("ENGINE_FAILED"); expect(runner.state).toEqual({ phase: "idle" });
   tickSpy.mockClear();
   await vi.advanceTimersByTimeAsync(1000);
   expect(tickSpy).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
 });
 it("aborts a native transcription still running when the mic leaves the screen", async () => {
  vi.useFakeTimers();
  try {
   const { engine, open } = fakeEngine();
   (engine.finish as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));
   const runner = new DictationRunner(engine, () => {}, 30_000);
   runner.dispatch({ type: "pressIn", now: 0 }); await tick(); open();
   runner.dispatch({ type: "pressOut", now: 1000 });
   await vi.advanceTimersByTimeAsync(10);
   runner.dispose();
   expect(engine.abortTranscription).toHaveBeenCalledOnce();
   await vi.advanceTimersByTimeAsync(30_001);
   expect(engine.abortTranscription).toHaveBeenCalledTimes(2); // The timeout still stops it, even after dispose.
  } finally { vi.useRealTimers(); }
 });
});
