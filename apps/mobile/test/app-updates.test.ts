import { describe, expect, it } from "vitest";
import { AppUpdates, parseAppUpdateEntry, type AppUpdateCheckEntry } from "../src/core/app-updates";
import { fakeAppUpdateSource, fakeAppUpdateStore } from "./fake-app-updates";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 10 * DAY;

function setup(options: { entry?: AppUpdateCheckEntry | null; build?: number | null; now?: number } = {}) {
 const source = fakeAppUpdateSource();
 const store = fakeAppUpdateStore(options.entry ?? null);
 const updates = new AppUpdates({ source, store, clock: () => options.now ?? NOW, build: options.build === undefined ? 8 : options.build });
 return { source, store, updates };
}

describe("Play update notice", () => {
 it("asks Play once per app start and records the attempt before asking", async () => {
  const { source, store, updates } = setup();
  source.next = async () => { expect(store.writes[0]).toEqual({ checkedAt: NOW, available: false }); return { available: true, versionCode: 9 }; };
  await Promise.all([updates.start(), updates.start()]);
  await updates.start();
  expect(source.checks).toBe(1);
  expect(updates.snapshot()).toEqual({ phase: "available", dismissed: false });
  expect(store.writes.at(-1)).toEqual({ checkedAt: NOW, available: true, versionCode: 9 });
 });

 it("asks at most once a day across app starts, reusing the last answer", async () => {
  const recent = setup({ entry: { checkedAt: NOW - DAY + 1, available: true, versionCode: 9 } });
  await recent.updates.start();
  expect(recent.source.checks).toBe(0);
  expect(recent.updates.snapshot().phase).toBe("available");
  const old = setup({ entry: { checkedAt: NOW - DAY, available: false } });
  await old.updates.start();
  expect(old.source.checks).toBe(1);
 });

 it("a remembered update is ignored once this build already has it", async () => {
  for (const build of [9, 10, null]) {
   const { updates } = setup({ build, entry: { checkedAt: NOW - 1, available: true, versionCode: 9 } });
   await updates.start();
   expect(updates.snapshot().phase).toBe("idle");
  }
 });

 it("is silent when Play has nothing, is unavailable, fails, or the attempt cannot be recorded", async () => {
  const none = setup();
  none.source.next = async () => ({ available: false });
  await none.updates.start();
  expect(none.updates.snapshot().phase).toBe("idle");
  const failing = setup();
  failing.source.next = async () => { throw new Error("no Play"); };
  await expect(failing.updates.start()).resolves.toBeUndefined();
  expect(failing.updates.snapshot().phase).toBe("idle");
  const readOnly = setup();
  readOnly.store.failWrite = true;
  await readOnly.updates.start();
  expect(readOnly.source.checks).toBe(0);
  expect(readOnly.updates.snapshot().phase).toBe("idle");
  const unreadable = setup();
  unreadable.store.failRead = true;
  await unreadable.updates.start();
  expect(unreadable.source.checks).toBe(0);
 });

 it("«Actualizar» starts Play's flexible update and shows the download honestly", async () => {
  const { source, updates } = setup();
  source.next = async () => ({ available: true, versionCode: 9 });
  await updates.start();
  const seen: string[] = [];
  updates.subscribe(() => seen.push(updates.snapshot().phase));
  await updates.update();
  expect(source.starts).toBe(1);
  expect(updates.snapshot().phase).toBe("downloading");
  source.emitDownloaded();
  expect(updates.snapshot().phase).toBe("downloaded");
  expect(seen).toEqual(["downloading", "downloaded"]);
  await updates.restart();
  expect(source.completes).toBe(1);
 });

 it("a cancelled or failed start keeps the offer; an already downloaded update offers restart", async () => {
  const cancelled = setup();
  cancelled.source.next = async () => ({ available: true, versionCode: 9 });
  await cancelled.updates.start();
  cancelled.source.startResult = async () => ({ started: false, downloaded: false });
  await cancelled.updates.update();
  expect(cancelled.updates.snapshot().phase).toBe("available");
  cancelled.source.startResult = async () => { throw new Error("gone"); };
  await expect(cancelled.updates.update()).resolves.toBeUndefined();
  expect(cancelled.updates.snapshot().phase).toBe("available");
  cancelled.source.startResult = async () => ({ started: false, downloaded: true });
  await cancelled.updates.update();
  expect(cancelled.updates.snapshot().phase).toBe("downloaded");
  const ready = setup();
  ready.source.next = async () => ({ available: true, versionCode: 9, downloaded: true });
  await ready.updates.start();
  expect(ready.updates.snapshot().phase).toBe("downloaded");
 });

 it("ignores update and restart unless they match the state shown", async () => {
  const { source, updates } = setup();
  await updates.update();
  await updates.restart();
  expect(source.starts).toBe(0);
  expect(source.completes).toBe(0);
  source.emitDownloaded();
  expect(updates.snapshot().phase).toBe("idle");
 });

 it("dismissing hides the notice for this start, but a finished download shows again", async () => {
  const { source, updates } = setup();
  source.next = async () => ({ available: true, versionCode: 9 });
  await updates.start();
  updates.dismiss();
  expect(updates.snapshot()).toEqual({ phase: "available", dismissed: true });
  await updates.update();
  updates.dismiss();
  source.emitDownloaded();
  expect(updates.snapshot()).toEqual({ phase: "downloaded", dismissed: false });
 });

 it("a failed restart keeps the restart offer", async () => {
  const { source, updates } = setup();
  source.next = async () => ({ available: true, versionCode: 9, downloaded: true });
  await updates.start();
  source.completeResult = async () => { throw new Error("no"); };
  await expect(updates.restart()).resolves.toBeUndefined();
  expect(updates.snapshot().phase).toBe("downloaded");
 });
});

describe("a flexible download that ends or survives a restart", () => {
 async function downloading() {
  const ctx = setup();
  ctx.source.next = async () => ({ available: true, versionCode: 9 });
  await ctx.updates.start();
  await ctx.updates.update();
  expect(ctx.updates.snapshot().phase).toBe("downloading");
  return ctx;
 }
 const settle = () => new Promise(resolve => setTimeout(resolve, 0));

 it("a failed download offers «Actualizar» again with a short message", async () => {
  const { source, updates } = await downloading();
  updates.dismiss();
  source.emit("failed");
  expect(updates.snapshot()).toEqual({ phase: "available", dismissed: false, failed: true });
  await settle();
  expect(updates.snapshot()).toEqual({ phase: "available", dismissed: false, failed: true });
  await updates.update();
  expect(source.starts).toBe(2);
  expect(updates.snapshot()).toEqual({ phase: "downloading", dismissed: false });
 });

 it("a cancelled download offers «Actualizar» again without an error", async () => {
  const { source, updates } = await downloading();
  source.emit("canceled");
  expect(updates.snapshot()).toEqual({ phase: "available", dismissed: false });
 });

 it("after a failure the notice hides when Play no longer offers the update", async () => {
  const { source, updates } = await downloading();
  source.next = async () => ({ available: false });
  source.emit("failed");
  await settle();
  expect(updates.snapshot().phase).toBe("idle");
  const ready = await downloading();
  ready.source.next = async () => ({ available: true, versionCode: 9, downloaded: true });
  ready.source.emit("canceled");
  await settle();
  expect(ready.updates.snapshot().phase).toBe("downloaded");
 });

 it("a failure re-check that fails itself keeps the offer", async () => {
  const { source, updates } = await downloading();
  source.next = async () => { throw new Error("offline"); };
  source.emit("failed");
  await settle();
  expect(updates.snapshot()).toEqual({ phase: "available", dismissed: false, failed: true });
 });

 it("ignores failure events unless a download is shown", async () => {
  const { source, updates } = setup();
  source.emit("failed");
  source.emit("canceled");
  expect(updates.snapshot().phase).toBe("idle");
  expect(source.checks).toBe(0);
 });

 it("restores a download in progress on every start, despite the daily cache", async () => {
  const { source, updates } = setup({ entry: { checkedAt: NOW - 1, available: false } });
  source.progressResult = async () => "downloading";
  await updates.start();
  expect(source.progressReads).toBe(1);
  expect(source.checks).toBe(0);
  expect(updates.snapshot()).toEqual({ phase: "downloading", dismissed: false });
  source.emitDownloaded();
  expect(updates.snapshot().phase).toBe("downloaded");
 });

 it("a download finished while the app was closed offers «Reiniciar para actualizar» at start", async () => {
  const { source, updates } = setup({ entry: { checkedAt: NOW - 1, available: true, versionCode: 9 } });
  source.progressResult = async () => "downloaded";
  await updates.start();
  expect(updates.snapshot()).toEqual({ phase: "downloaded", dismissed: false });
  expect(source.checks).toBe(0);
 });

 it("without a download the daily limit still applies; a failing install status is ignored", async () => {
  const cached = setup({ entry: { checkedAt: NOW - 1, available: false } });
  await cached.updates.start();
  expect(cached.source.progressReads).toBe(1);
  expect(cached.source.checks).toBe(0);
  expect(cached.updates.snapshot().phase).toBe("idle");
  const broken = setup();
  broken.source.progressResult = async () => { throw new Error("no Play"); };
  broken.source.next = async () => ({ available: true, versionCode: 9 });
  await broken.updates.start();
  expect(broken.source.checks).toBe(1);
  expect(broken.updates.snapshot().phase).toBe("available");
 });
});

describe("install events that arrive while Play is still answering", () => {
 function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
 }
 const settle = () => new Promise(resolve => setTimeout(resolve, 0));

 async function offered() {
  const ctx = setup();
  ctx.source.next = async () => ({ available: true, versionCode: 9 });
  await ctx.updates.start();
  const start = deferred<{ started: boolean; downloaded: boolean }>();
  ctx.source.startResult = () => start.promise;
  return { ...ctx, start };
 }

 it("a download that fails or is cancelled before «Actualizar» resolves offers it again", async () => {
  for (const event of ["failed", "canceled"] as const) {
   const { source, updates, start } = await offered();
   source.next = async () => ({ available: true, versionCode: 9 });
   const updating = updates.update();
   source.emit(event);
   start.resolve({ started: true, downloaded: false });
   await updating;
   expect(updates.snapshot()).toEqual(event === "failed" ? { phase: "available", dismissed: false, failed: true } : { phase: "available", dismissed: false });
   await settle();
   expect(updates.snapshot().phase).toBe("available");
  }
 });

 it("a download that finishes before «Actualizar» resolves offers the restart", async () => {
  const { source, updates, start } = await offered();
  const updating = updates.update();
  source.emitDownloaded();
  start.resolve({ started: true, downloaded: false });
  await updating;
  expect(updates.snapshot()).toEqual({ phase: "downloaded", dismissed: false });
 });

 it("events after «Actualizar» resolves still end the download, and a failed start keeps the offer", async () => {
  const later = await offered();
  const updating = later.updates.update();
  later.start.resolve({ started: true, downloaded: false });
  await updating;
  later.source.emit("canceled");
  expect(later.updates.snapshot()).toEqual({ phase: "available", dismissed: false });
  const broken = await offered();
  const failing = broken.updates.update();
  broken.source.emit("failed");
  broken.start.reject(new Error("gone"));
  await failing;
  expect(broken.updates.snapshot()).toEqual({ phase: "available", dismissed: false });
 });

 it("a download that ends while the start-up status is read wins over the stale answer", async () => {
  for (const [event, expected] of [["downloaded", { phase: "downloaded", dismissed: false }], ["failed", { phase: "available", dismissed: false, failed: true }], ["canceled", { phase: "available", dismissed: false }]] as const) {
   const { source, updates } = setup({ entry: { checkedAt: NOW - 1, available: false } });
   const progress = deferred<"none" | "downloading" | "downloaded">();
   source.progressResult = () => progress.promise;
   source.next = async () => ({ available: true, versionCode: 9 });
   const starting = updates.start();
   source.emit(event);
   progress.resolve("downloading");
   await starting;
   expect(updates.snapshot()).toEqual(expected);
  }
 });

 it("a download that finishes while Play's availability answer is pending offers the restart", async () => {
  const { source, updates } = setup();
  const check = deferred<{ available: boolean; versionCode?: number }>();
  source.next = () => check.promise;
  const starting = updates.start();
  await settle();
  expect(source.checks).toBe(1);
  source.emitDownloaded();
  check.resolve({ available: true, versionCode: 9 });
  await starting;
  expect(updates.snapshot()).toEqual({ phase: "downloaded", dismissed: false });
 });

 it("a confirmed download received at start-up offers the restart even when Play's answers say nothing", async () => {
  for (const progressAnswer of ["none", "throws"] as const) {
   const { source, updates } = setup({ entry: { checkedAt: NOW - 1, available: false } });
   const progress = deferred<"none" | "downloading" | "downloaded">();
   source.progressResult = () => progress.promise;
   const starting = updates.start();
   source.emitDownloaded();
   if (progressAnswer === "none") progress.resolve("none"); else progress.reject(new Error("play"));
   await starting;
   expect(updates.snapshot()).toEqual({ phase: "downloaded", dismissed: false });
  }
 });

 it("the last event wins and a held event is applied once", async () => {
  const { source, updates } = setup({ entry: { checkedAt: NOW - 1, available: false } });
  const progress = deferred<"none" | "downloading" | "downloaded">();
  source.progressResult = () => progress.promise;
  const starting = updates.start();
  source.emit("failed");
  source.emitDownloaded();
  progress.resolve("downloading");
  await starting;
  expect(updates.snapshot()).toEqual({ phase: "downloaded", dismissed: false });
  await updates.start();
  expect(updates.snapshot()).toEqual({ phase: "downloaded", dismissed: false });
  expect(source.checks).toBe(0);
 });
});

describe("the stored check", () => {
 it("keeps the time, the answer and a whole versionCode; anything else is rejected", () => {
  expect(parseAppUpdateEntry(JSON.stringify({ checkedAt: 5, available: true, versionCode: 9 }))).toEqual({ checkedAt: 5, available: true, versionCode: 9 });
  expect(parseAppUpdateEntry(JSON.stringify({ checkedAt: 5, available: false, versionCode: 9.5 }))).toEqual({ checkedAt: 5, available: false });
  for (const bad of ["null", "{}", JSON.stringify({ checkedAt: "5", available: true }), JSON.stringify({ checkedAt: 5 }), "{"]) expect(() => parseAppUpdateEntry(bad)).toThrow();
 });
});
