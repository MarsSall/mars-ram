import { afterEach, describe, expect, it, vi } from "vitest";
import { DICTATION_MODEL, ModelDownload } from "../src/core/dictation";
import { fakeDictationEngine } from "./fake-dictation-engine";

// The voice model downloads in the system download (Android DownloadManager): it outlives the
// sheet, the screen and the app. Only the explicit «Cancelar descarga» stops it.
const notice = { title: "Voice model", description: "Mars-RAM" };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); });

describe("ModelDownload", () => {
 it("attaches to a download already running instead of starting a second one", async () => {
  const engine = fakeDictationEngine(); engine.status = { state: "downloading", written: 120e6, total: DICTATION_MODEL.bytes, waiting: false };
  const download = new ModelDownload(engine);
  const off = download.subscribe(() => {}); await flush();
  expect(download.view).toEqual({ phase: "downloading", written: 120e6, total: DICTATION_MODEL.bytes, waiting: false });
  off();
  // Reopened: it shows the same download again, and a press of «Descargar» only attaches.
  const again = download.subscribe(() => {}); await flush();
  expect(download.view.phase).toBe("downloading");
  again();
  expect(engine.starts).toBe(0);
 });
 it("keeps downloading when nobody watches any more; only an explicit cancel stops it", async () => {
  const engine = fakeDictationEngine(); const download = new ModelDownload(engine);
  const off = download.subscribe(() => {}); await flush();
  await download.start(notice);
  expect(engine.notices).toEqual([notice]);
  off(); await flush();
  expect(engine.cancels).toBe(0);
  expect(engine.status.state).toBe("downloading");
  await download.cancel();
  expect(engine.cancels).toBe(1);
  expect(download.view).toEqual({ phase: "missing", failed: false });
 });
 it("runs a cancel pressed during the start after it, so nothing keeps downloading", async () => {
  const engine = fakeDictationEngine(); const download = new ModelDownload(engine);
  const starting = download.start(notice); const cancelling = download.cancel();
  await Promise.all([starting, cancelling]);
  expect(engine.calls).toEqual(["download", "cancel"]);
  expect(download.view).toEqual({ phase: "missing", failed: false });
 });
 it("follows the progress while watched and stops polling when nobody watches", async () => {
  vi.useFakeTimers();
  const engine = fakeDictationEngine(); const download = new ModelDownload(engine, 1000);
  const seen: string[] = [];
  const off = download.subscribe(() => { if (download.view.phase === "downloading") seen.push(`${download.view.written}`); });
  await download.start(notice);
  engine.status = { state: "downloading", written: 50e6, total: DICTATION_MODEL.bytes, waiting: false };
  await vi.advanceTimersByTimeAsync(1000);
  expect(seen).toContain("50000000");
  off(); const reads = engine.statusReads;
  await vi.advanceTimersByTimeAsync(5000);
  expect(engine.statusReads).toBe(reads);
 });
 it("is ready once the finished download was verified and put in place", async () => {
  const engine = fakeDictationEngine(); engine.status = { state: "ready" };
  const download = new ModelDownload(engine);
  await download.refresh();
  expect(download.view).toEqual({ phase: "ready" });
 });
 it("shows DOWNLOAD_FAILED for a failed or mismatching download, and a retry starts a new one", async () => {
  const engine = fakeDictationEngine(); engine.status = { state: "failed" };
  const download = new ModelDownload(engine);
  await download.refresh();
  expect(download.view).toEqual({ phase: "missing", failed: true });
  await download.start(notice);
  expect(engine.starts).toBe(1);
  expect(download.view.phase).toBe("downloading");
 });
 it("reports a model already on the phone as ready and a missing one as missing", async () => {
  const engine = fakeDictationEngine(); const download = new ModelDownload(engine);
  await download.refresh();
  expect(download.view).toEqual({ phase: "missing", failed: false });
  engine.ready = true; await download.refresh();
  expect(download.view).toEqual({ phase: "ready" });
 });
});
