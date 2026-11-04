import { beforeEach, describe, expect, it, vi } from "vitest";

// The adapter's lifecycle rules (verify mvykrju2-c-max1): one owner at a time, a cancel during
// start-up never opens the microphone, and a stalled transcription can be stopped.
const native = vi.hoisted(() => ({
 started: 0, stopped: 0, listener: null as ((data: string) => void) | null,
 permission: Promise.resolve("granted") as Promise<string>,
 transcribe: vi.fn(),
}));
vi.mock("@fugood/react-native-audio-pcm-stream", () => ({ default: {
 init: async () => {}, start: () => { native.started++; }, stop: () => { native.stopped++; },
 on: (_event: string, callback: (data: string) => void) => { native.listener = callback; return { remove() {} }; },
} }));
vi.mock("react-native", () => ({ PermissionsAndroid: { PERMISSIONS: { RECORD_AUDIO: "mic" }, RESULTS: { GRANTED: "granted" }, request: () => native.permission } }));
vi.mock("expo-file-system/legacy", () => ({
 documentDirectory: "file:///docs/",
 getInfoAsync: async () => ({ exists: true, size: 355615679, md5: "6c789286c397aff3cd62c7cc48de3775" }),
 deleteAsync: async () => {}, makeDirectoryAsync: async () => {}, moveAsync: async () => {}, createDownloadResumable: () => ({}),
}));
vi.mock("whisper.rn/index", () => ({ initParakeet: async () => ({ transcribeData: native.transcribe, release: async () => {} }) }));

const { createOnDeviceDictation } = await import("../src/adapters/on-device-dictation");
const speak = (seconds: number) => native.listener?.(Buffer.alloc(Math.round(seconds * 32000)).toString("base64"));

beforeEach(() => {
 native.started = 0; native.stopped = 0; native.permission = Promise.resolve("granted");
 native.transcribe.mockReset().mockReturnValue({ stop: async () => {}, promise: Promise.resolve({ result: "Гит статус." }) });
});

describe("on-device dictation adapter", () => {
 it("never waits more than 3 s for a native job whose stop or result never comes", async () => {
  vi.useFakeTimers();
  try {
   const engine = createOnDeviceDictation(); const mic = Symbol("mic");
   native.transcribe.mockReturnValue({ stop: () => new Promise(() => {}), promise: new Promise(() => {}) });
   await engine.start(mic); speak(1);
   void engine.finish(mic);
   await vi.advanceTimersByTimeAsync(200);
   let done = false; void engine.abortTranscription().then(() => { done = true; });
   await vi.advanceTimersByTimeAsync(3001);
   expect(done).toBe(true);
  } finally { vi.useRealTimers(); }
 });
 it("records for its owner and transcribes in Latin letters", async () => {
  const engine = createOnDeviceDictation(); const terminal = Symbol("terminal");
  expect(await engine.start(terminal)).toEqual({ ok: true });
  speak(1);
  expect(await engine.finish(terminal)).toEqual({ ok: true, text: "Git status.", seconds: 1 });
  expect([native.started, native.stopped]).toEqual([1, 1]);
 });
 it("gives the recorder to one mic at a time; another cannot stop or cancel it", async () => {
  const engine = createOnDeviceDictation(); const terminal = Symbol("terminal"); const chat = Symbol("chat");
  await engine.start(terminal); speak(1);
  expect(await engine.start(chat)).toEqual({ ok: false, code: "BUSY" });
  await engine.cancel(chat);
  expect(await engine.finish(chat)).toEqual({ ok: false, code: "NO_AUDIO" });
  expect(native.stopped).toBe(0);
  expect((await engine.finish(terminal)).ok).toBe(true);
  expect(await engine.start(chat)).toEqual({ ok: true });
 });
 it("never opens the microphone when its owner cancels during start-up", async () => {
  const engine = createOnDeviceDictation(); const mic = Symbol("mic");
  let grant!: (value: string) => void; native.permission = new Promise(resolve => { grant = resolve; });
  const starting = engine.start(mic);
  await engine.cancel(mic); grant("granted");
  expect(await starting).toEqual({ ok: false, code: "CANCELLED" });
  expect(native.started).toBe(0);
  expect(await engine.start(Symbol("next"))).toEqual({ ok: true });
 });
 it("keeps the recorder busy while finishing collects the audio, and honours its owner's cancel", async () => {
  const engine = createOnDeviceDictation(); const terminal = Symbol("terminal"); const chat = Symbol("chat");
  await engine.start(terminal); speak(1);
  const finishing = engine.finish(terminal);
  expect(await engine.start(chat)).toEqual({ ok: false, code: "BUSY" });
  await engine.cancel(terminal);
  expect(await finishing).toEqual({ ok: false, code: "CANCELLED" });
  expect(native.transcribe).not.toHaveBeenCalled();
 });
 it("transcribes nothing when stopped before the transcription began", async () => {
  const engine = createOnDeviceDictation(); const mic = Symbol("mic");
  await engine.start(mic); speak(1);
  const finishing = engine.finish(mic);
  await engine.abortTranscription();
  expect(await finishing).toEqual({ ok: false, code: "CANCELLED" });
  expect(native.transcribe).not.toHaveBeenCalled();
 });
 it("waits for a stopped transcription to settle before freeing the engine", async () => {
  const engine = createOnDeviceDictation(); const mic = Symbol("mic");
  let settle!: () => void; let settled = false;
  native.transcribe.mockReturnValue({ stop: async () => { setTimeout(() => { settled = true; settle(); }, 20); }, promise: new Promise((_resolve, reject) => { settle = () => reject(Error("aborted")); }) });
  await engine.start(mic); speak(1);
  const finishing = engine.finish(mic);
  await vi.waitFor(() => expect(native.transcribe).toHaveBeenCalled());
  await engine.abortTranscription();
  expect(settled).toBe(true);
  expect(await finishing).toEqual({ ok: false, code: "CANCELLED" });
 });
 it("stops a stalled transcription so the engine is free again", async () => {
  const engine = createOnDeviceDictation(); const mic = Symbol("mic");
  let end!: () => void; const stop = vi.fn(async () => { end(); });
  native.transcribe.mockReturnValue({ stop, promise: new Promise((_resolve, reject) => { end = () => reject(Error("aborted")); }) });
  await engine.start(mic); speak(1);
  void engine.finish(mic);
  await vi.waitFor(() => expect(native.transcribe).toHaveBeenCalled());
  await engine.abortTranscription();
  expect(stop).toHaveBeenCalledOnce();
 });
});
