import type { AppInstallEvent, AppInstallProgress, AppUpdateCheck, AppUpdateCheckEntry, AppUpdateCheckStore, AppUpdateSource, AppUpdateStart } from "../src/core/app-updates";

/** Shared fake for the AppUpdateSource port; tests never reach Google Play. */
export function fakeAppUpdateSource() {
 const listeners = new Set<(event: AppInstallEvent) => void>();
 const fake = {
  checks: 0, starts: 0, completes: 0, progressReads: 0,
  next: async (): Promise<AppUpdateCheck> => ({ available: false }),
  progressResult: async (): Promise<AppInstallProgress> => "none",
  startResult: async (): Promise<AppUpdateStart> => ({ started: true, downloaded: false }),
  completeResult: async (): Promise<void> => {},
  emit: (event: AppInstallEvent) => { for (const listener of [...listeners]) listener(event); },
  emitDownloaded: () => fake.emit("downloaded"),
 };
 const source: AppUpdateSource & typeof fake = Object.assign(fake, {
  check: () => { fake.checks += 1; return fake.next(); },
  start: () => { fake.starts += 1; return fake.startResult(); },
  complete: () => { fake.completes += 1; return fake.completeResult(); },
  progress: () => { fake.progressReads += 1; return fake.progressResult(); },
  onInstallEvent: (listener: (event: AppInstallEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
 });
 return source;
}

export function fakeAppUpdateStore(initial: AppUpdateCheckEntry | null) {
 const fake = { writes: [] as AppUpdateCheckEntry[], failRead: false, failWrite: false, entry: initial };
 const store: AppUpdateCheckStore & typeof fake = Object.assign(fake, {
  read: async () => { if (fake.failRead) throw new Error("disk"); return fake.entry; },
  write: async (entry: AppUpdateCheckEntry) => { if (fake.failWrite) throw new Error("disk"); fake.writes.push(entry); fake.entry = entry; },
 });
 return store;
}
