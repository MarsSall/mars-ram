import { DICTATION_MODEL, type DictationEngine, type ModelDownloadStatus } from "../src/core/dictation";

/** Shared fake for the DictationEngine port; the model download behaves like the system one:
 * it keeps going without anyone watching, a start attaches to a running one, and a failure is
 * reported once and then cleared. */
export function fakeDictationEngine(overrides: Partial<DictationEngine> = {}) {
 const fake = {
  ready: false, starts: 0, cancels: 0, statusReads: 0, calls: [] as string[],
  status: { state: "none" } as ModelDownloadStatus,
  notices: [] as { title: string; description: string }[],
 };
 const engine: DictationEngine & typeof fake = Object.assign(fake, {
  modelReady: async () => fake.ready,
  warm: async () => {},
  removeModel: async () => { fake.ready = false; },
  download: async (notice: { title: string; description: string }) => {
   fake.calls.push("download"); fake.starts++; fake.notices.push(notice);
   if (fake.status.state === "none" || fake.status.state === "failed") fake.status = { state: "downloading", written: 0, total: DICTATION_MODEL.bytes, waiting: true };
   return fake.status;
  },
  downloadStatus: async () => {
   fake.statusReads++; const now = fake.status;
   if (now.state === "failed") fake.status = { state: "none" };
   if (now.state === "ready") { fake.ready = true; fake.status = { state: "none" }; }
   return now;
  },
  cancelDownload: async () => { fake.calls.push("cancel"); fake.cancels++; fake.status = { state: "none" }; },
  start: async () => ({ ok: true as const }),
  cancel: async () => {},
  abortTranscription: async () => {},
  finish: async () => ({ ok: true as const, text: "", seconds: 0 }),
 }, overrides);
 return engine;
}
