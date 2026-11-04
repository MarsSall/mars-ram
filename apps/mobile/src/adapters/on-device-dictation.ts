import AudioRecord from "@fugood/react-native-audio-pcm-stream";
import * as FileSystem from "expo-file-system/legacy";
import { PermissionsAndroid } from "react-native";
import { initParakeet, type ParakeetContext } from "whisper.rn/index";
import { DICTATION_MODEL, joinPcm, latinize, modelReady, type DictationEngine } from "../core/dictation";

// On-device dictation with Parakeet through whisper.rn (whisper.cpp); audio stays in memory
// and never leaves the phone (S1).
const dir = `${FileSystem.documentDirectory}models/`;
const path = `${dir}${DICTATION_MODEL.fileName}`;
const partial = `${path}.part`;
/** An interrupted download, and files left over from the probe and the Whisper trial (L4, L13,
 * L14): removed at start so they do not keep 669 MB (Parakeet q8_0) and 574 MB (Whisper turbo). */
const LEGACY = [partial, `${dir}ggml-parakeet-tdt-0.6b-v3-q8_0.bin`, `${dir}ggml-large-v3-turbo-q5_0.bin`, `${dir}ggml-large-v3-turbo-q5_0.bin.part`, `${FileSystem.documentDirectory}dictation-engine.json`];

function decode(base64: string): Uint8Array {
 const binary = globalThis.atob(base64); const bytes = new Uint8Array(binary.length);
 for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
 return bytes;
}
async function verified(file: string): Promise<boolean> {
 const info = await FileSystem.getInfoAsync(file, { md5: true });
 return modelReady({ exists: info.exists, ...(info.exists ? { size: info.size, md5: info.md5 } : {}) });
}

export function createOnDeviceDictation(): DictationEngine {
 let context: Promise<ParakeetContext> | null = null;
 let chunks: Uint8Array[] = [];
 let recording = false;
 let ready: boolean | null = null;
 // One mic owns the recorder at a time; `generation` invalidates a start-up its owner cancelled.
 let owner: symbol | null = null;
 let generation = 0;
 // The running transcription, and a counter that voids a finish once it is aborted.
 let job: { stop: () => Promise<void>; promise: Promise<unknown> } | null = null;
 let transcription = 0;
 for (const file of LEGACY) void FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
 AudioRecord.on("data", data => { if (recording) chunks.push(decode(data)); });
 const engine = (): Promise<ParakeetContext> => context ??= (async () => {
  // The MD5 was checked once this run; the size is checked again right before loading.
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists || info.size !== DICTATION_MODEL.bytes) { ready = false; throw Error("Voice model changed."); }
  return initParakeet({ filePath: path, useGpu: false });
 })().catch(error => { context = null; throw error; });
 // The native stop returns nothing; the audio heard so far is already in memory.
 const stopRecording = () => { if (!recording) return; recording = false; try { AudioRecord.stop(); } catch { /* Already stopped. */ } };
 const self: DictationEngine = {
  async modelReady() {
   // The MD5 of 356 MB takes a moment: check once per app run, then trust the cached answer.
   ready ??= await verified(path).catch(() => false);
   return ready;
  },
  async warm() { if (await self.modelReady()) await engine().catch(() => {}); },
  download(progress) {
   const task = FileSystem.createDownloadResumable(DICTATION_MODEL.url, partial, {}, p => progress(p.totalBytesWritten, DICTATION_MODEL.bytes));
   const promise = (async () => {
    try {
     await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
     const result = await task.downloadAsync();
     if (!result || result.status !== 200 || !(await verified(partial))) { await FileSystem.deleteAsync(partial, { idempotent: true }); return { ok: false as const, code: "DOWNLOAD_FAILED" as const }; }
     await FileSystem.moveAsync({ from: partial, to: path });
     ready = true;
     return { ok: true as const };
    } catch { await FileSystem.deleteAsync(partial, { idempotent: true }).catch(() => {}); return { ok: false as const, code: "DOWNLOAD_FAILED" as const }; }
   })();
   return { promise, cancel: async () => { await task.cancelAsync().catch(() => {}); await FileSystem.deleteAsync(partial, { idempotent: true }).catch(() => {}); } };
  },
  async removeModel() {
   const loaded = context; context = null; ready = false;
   if (loaded) await (await loaded.catch(() => null))?.release().catch(() => {});
   await FileSystem.deleteAsync(path, { idempotent: true });
  },
  async start(me) {
   if (owner && owner !== me) return { ok: false, code: "BUSY" };
   owner = me; const mine = ++generation;
   const gone = () => mine !== generation;
   if (!(await self.modelReady())) { if (!gone()) owner = null; return { ok: false, code: "NO_MODEL" }; }
   if (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO) !== PermissionsAndroid.RESULTS.GRANTED) { if (!gone()) owner = null; return { ok: false, code: "PERMISSION" }; }
   // As in the phone probe (L4): the model is loaded before the microphone opens, never while recording.
   try { await engine(); } catch { if (!gone()) owner = null; return { ok: false, code: "ENGINE_FAILED" }; }
   if (gone()) return { ok: false, code: "CANCELLED" };
   // Created after the permission: without it Android's AudioRecord stays uninitialized.
   try { await AudioRecord.init({ sampleRate: 16000, channels: 1, bitsPerSample: 16, audioSource: 6, wavFile: "dictation.wav", bufferSize: 4096 }); }
   catch { if (!gone()) owner = null; return { ok: false, code: "PERMISSION" }; }
   // Cancelled while the recorder was being prepared: never open the microphone.
   if (gone()) return { ok: false, code: "CANCELLED" };
   chunks = []; recording = true; AudioRecord.start();
   return { ok: true };
  },
  async cancel(me) {
   if (owner !== me) return;
   generation++; owner = null; stopRecording(); chunks = [];
  },
  async abortTranscription() {
   transcription++; // A finish still collecting audio or loading the model never transcribes.
   const running = job; job = null;
   if (!running) return;
   // The native stop only requests it: wait until it settles, but never longer than 3 s in total.
   const settled = (async () => { await running.stop().catch(() => {}); await running.promise.catch(() => {}); })();
   await Promise.race([settled, new Promise(resolve => setTimeout(resolve, 3000))]);
  },
  async finish(me, step) {
   if (owner !== me) return { ok: false, code: "NO_AUDIO" };
   // The owner keeps the recorder until its audio is collected: another mic gets BUSY meanwhile,
   // and the owner's cancel still voids this finish.
   const mine = generation; const turn = transcription;
   const voided = () => mine !== generation || turn !== transcription;
   step?.("stopping");
   stopRecording();
   await new Promise(resolve => setTimeout(resolve, 150)); // The last buffer is still on its way.
   if (voided()) return { ok: false, code: "CANCELLED" };
   const { pcm, seconds } = joinPcm(chunks); chunks = [];
   generation++; owner = null;
   if (seconds < 0.3) return { ok: false, code: "NO_AUDIO" };
   try {
    step?.("loading", seconds);
    const parakeet = await engine();
    if (turn !== transcription) return { ok: false, code: "CANCELLED" };
    step?.("transcribing", seconds);
    const running = parakeet.transcribeData(pcm.buffer as ArrayBuffer, { maxThreads: 4 }); job = running;
    const { result } = await running.promise.finally(() => { if (job === running) job = null; });
    if (turn !== transcription) return { ok: false, code: "CANCELLED" };
    const text = latinize(result.trim());
    return text ? { ok: true, text, seconds } : { ok: false, code: "NO_AUDIO" };
   } catch { return { ok: false, code: turn !== transcription ? "CANCELLED" : "ENGINE_FAILED" }; }
  },
 };
 return self;
}
