import { describe, expect, it } from "vitest";
import { appendDictation, DICTATION_MODEL, latinize, dictationReduce, formatElapsed, joinPcm, modelReady, terminalDictation, type DictationState } from "../src/core/dictation";

const idle: DictationState = { phase: "idle" };
function run(events: [string, number][], from: DictationState = idle) {
 let state = from; const effects: string[] = [];
 for (const [type, now] of events) {
  const next = dictationReduce(state, { type: type as "pressIn", now });
  state = next.state; if (next.effects) effects.push(...next.effects);
 }
 return { state, effects };
}

describe("dictation gesture (S3: hold to talk, double tap locks)", () => {
 it("records while held and transcribes on release", () => {
  expect(run([["pressIn", 0], ["pressOut", 1200]])).toEqual({ state: { phase: "transcribing" }, effects: ["start", "transcribe"] });
 });
 it("locks on a double tap, ignores the release of the locking tap, and stops on the next tap", () => {
  const locked = run([["pressIn", 0], ["pressOut", 120], ["pressIn", 250], ["pressOut", 330]]);
  expect(locked).toEqual({ state: { phase: "locked", since: 0, armed: true }, effects: ["start"] });
  expect(run([["pressIn", 5000], ["pressOut", 5080]], locked.state)).toEqual({ state: { phase: "transcribing" }, effects: ["transcribe"] });
 });
 it("cancels a single short tap after the double-tap window and asks to hold", () => {
  expect(run([["pressIn", 0], ["pressOut", 100], ["tick", 350], ["tick", 401]])).toEqual({ state: { phase: "idle", hint: true }, effects: ["start", "cancel"] });
  expect(run([["pressIn", 0], ["pressOut", 100], ["tick", 450]]).state).toEqual({ phase: "idle", hint: true });
 });
 it("does not lock when the second tap comes too late", () => {
  expect(run([["pressIn", 0], ["pressOut", 100], ["pressIn", 500]])).toEqual({ state: { phase: "holding", since: 500 }, effects: ["start", "cancel", "start"] });
 });
 it("stops by itself after two minutes, held or locked", () => {
  expect(run([["pressIn", 0], ["tick", 120_001]])).toEqual({ state: { phase: "transcribing" }, effects: ["start", "transcribe"] });
  expect(run([["tick", 130_000]], { phase: "locked", since: 0, armed: true })).toEqual({ state: { phase: "transcribing" }, effects: ["transcribe"] });
 });
 it("drops any recording when the app leaves the foreground, but lets a transcription finish", () => {
  for (const from of [{ phase: "holding", since: 0 }, { phase: "tapped", since: 0, until: 400 }, { phase: "locked", since: 0, armed: true }] as DictationState[]) {
   expect(dictationReduce(from, { type: "abort", now: 10 })).toEqual({ state: { phase: "idle" }, effects: ["cancel"] });
  }
  expect(dictationReduce({ phase: "idle" }, { type: "abort", now: 10 })).toEqual({ state: { phase: "idle" } });
  expect(dictationReduce({ phase: "transcribing" }, { type: "abort", now: 10 })).toEqual({ state: { phase: "transcribing" } });
 });
 it("ignores presses while transcribing and returns to idle when done or failed", () => {
  expect(run([["pressIn", 0], ["pressOut", 50]], { phase: "transcribing" })).toEqual({ state: { phase: "transcribing" }, effects: [] });
  expect(dictationReduce({ phase: "transcribing" }, { type: "done", now: 0 })).toEqual({ state: { phase: "idle" } });
 });
});

describe("dictation text and audio", () => {
 it("appends to a draft with one space and trims the transcript", () => {
  expect(appendDictation("", "  Hola. ")).toBe("Hola.");
  expect(appendDictation("Revisá esto", "y corré los tests.")).toBe("Revisá esto y corré los tests.");
  expect(appendDictation("Línea\n", "nueva")).toBe("Línea\nnueva");
  expect(appendDictation("algo", "   ")).toBe("algo");
 });
 it("types at the terminal prompt as one bracketed paste, never Enter or control keys", () => {
  expect(new TextDecoder().decode(terminalDictation("git status"))).toBe("\x1b[200~git status\x1b[201~");
  expect(new TextDecoder().decode(terminalDictation("a\nb\r\x1b[201~c\x07"))).toBe("\x1b[200~a b [201~c\x1b[201~");
  expect(terminalDictation("  ").length).toBe(0);
 });
 it("joins PCM chunks and reports seconds of 16 kHz mono audio", () => {
  const { pcm, seconds } = joinPcm([new Uint8Array([1, 2]), new Uint8Array([3, 4, 5, 6])]);
  expect([...pcm]).toEqual([1, 2, 3, 4, 5, 6]); expect(seconds).toBeCloseTo(6 / 32000);
 });
 it("formats the elapsed time like the design (0:04, 1:20)", () => {
  expect([0, 4_200, 80_000].map(formatElapsed)).toEqual(["0:00", "0:04", "1:20"]);
 });
 it("pins the model to an immutable revision and accepts only the exact file", () => {
  expect(DICTATION_MODEL.url).toBe("https://huggingface.co/ggml-org/parakeet-GGUF/resolve/35156454d1a39de06863303dd209fd2bed6ee079/ggml-parakeet-tdt-0.6b-v3-q4_0.bin");
  expect(modelReady({ exists: true, size: 355615679, md5: "6c789286c397aff3cd62c7cc48de3775" })).toBe(true);
  expect(modelReady({ exists: true, size: 355615679, md5: "0".repeat(32) })).toBe(false);
  expect(modelReady({ exists: true, size: 1, md5: "6c789286c397aff3cd62c7cc48de3775" })).toBe(false);
  expect(modelReady({ exists: false })).toBe(false);
 });
});


describe("Parakeet output fixes (L14)", () => {
 it("writes Cyrillic output with Latin letters, keeping case and everything else", () => {
  expect(latinize("Гит статус.")).toBe("Git status.");
  expect(latinize("ПУШ в мастер, щас")).toBe("PUSH v master, shchas");
  expect(latinize("Хорошо: ёж, юг, яма, цирк, жук, чай, шум, эхо, объём, ты")).toBe("Khorosho: ezh, yug, yama, tsirk, zhuk, chai, shum, ekho, obem, ty");
  expect(latinize("Hacé un commit con el mensaje fix del parser.")).toBe("Hacé un commit con el mensaje fix del parser.");
 });
 it("types commands, not sentences, at the terminal: no final period, no sentence capital", () => {
  const typed = (text: string) => new TextDecoder().decode(terminalDictation(text)).slice(6, -6);
  expect(typed("Git status.")).toBe("git status");
  expect(typed("Гит статус.")).toBe("git status");
  expect(typed("README.md")).toBe("README.md");
  expect(typed("Ls -la...")).toBe("ls -la");
  expect(typed("¿Qué hace esto?")).toBe("¿Qué hace esto?");
 });
});
