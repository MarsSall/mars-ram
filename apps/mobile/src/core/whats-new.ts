// «Novedades»: bundled release notes shown once after each update. No network.
import { RELEASE_NOTES, type ReleaseNote } from "./release-notes";

export { RELEASE_NOTES, type ReleaseNote };

/** The installed app: Android versionCode and version name; either can be unknown. */
export type AppBuild = { build: number | null; version: string | null };

export type LastSeenBuild =
 /** No record and no saved app data: a fresh install. */
 | { kind: "fresh" }
 /** No record, but the app was used before this feature existed. */
 | { kind: "unrecorded" }
 | ({ kind: "seen" } & AppBuild);

/** The last build whose notes were seen or skipped (architecture: SeenBuildStore). */
export interface SeenBuildStore {
 read(): Promise<LastSeenBuild>;
 write(seen: AppBuild): Promise<void>;
}

export function parseBuild(raw: string | number | null | undefined): number | null {
 const value = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
 return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

const text = (raw: string | null | undefined) => raw?.trim() ? raw.trim() : null;

/** The native versionCode wins; some builds report an empty Expo build number. */
export function currentAppBuild(
 native: { versionCode: number | null; versionName: string | null } | null,
 expo: { nativeBuildVersion: string | null | undefined; nativeApplicationVersion: string | null | undefined },
): AppBuild {
 return {
  build: parseBuild(native?.versionCode) ?? parseBuild(expo.nativeBuildVersion),
  version: text(native?.versionName) ?? text(expo.nativeApplicationVersion),
 };
}

const known = (b: AppBuild) => b.build !== null || b.version !== null;

export class WhatsNew {
 private readonly notes: ReleaseNote[];

 constructor(private readonly deps: { store: SeenBuildStore; current: AppBuild; notes?: ReleaseNote[] }) {
  this.notes = [...(deps.notes ?? RELEASE_NOTES)].sort((a, b) => b.build - a.build);
 }

 /** Every bundled entry, newest first, for Ajustes → Acerca de. */
 all(): ReleaseNote[] { return this.notes; }

 /** Notes to show now; an empty list records this build when nothing will be shown. */
 async pending(): Promise<ReleaseNote[]> {
  const current = this.deps.current;
  if (!known(current)) return [];
  let last: LastSeenBuild;
  try { last = await this.deps.store.read(); } catch { return []; }
  const shown = this.select(last);
  if (shown.length === 0 && !this.same(last)) await this.dismiss();
  return shown;
 }

 /** «Entendido»: this build's notes do not come back. Failures are silent. */
 async dismiss(): Promise<void> {
  if (!known(this.deps.current)) return;
  try { await this.deps.store.write(this.deps.current); } catch { /* It may show once more; never block the app. */ }
 }

 private same(last: LastSeenBuild): boolean {
  if (last.kind !== "seen") return false;
  const current = this.deps.current;
  if (current.build !== null && last.build !== null) return current.build === last.build;
  return current.version !== null && current.version === last.version;
 }

 private select(last: LastSeenBuild): ReleaseNote[] {
  const current = this.deps.current;
  if (last.kind === "fresh" || this.same(last)) return [];
  const own = (n: ReleaseNote) => current.build !== null ? n.build === current.build : n.version === current.version;
  if (last.kind === "unrecorded") return this.notes.filter(own);
  if (current.build !== null && last.build !== null) return this.notes.filter(n => n.build > last.build! && n.build <= current.build!);
  return this.notes.filter(own);
 }
}

/** The stored record; anything malformed counts as a build seen with nothing known. */
export function parseSeenBuild(text: string): AppBuild {
 const value: unknown = JSON.parse(text);
 const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
 return { build: parseBuild(typeof record.build === "number" ? record.build : null), version: typeof record.appVersion === "string" ? text_(record.appVersion) : null };
}
const text_ = (raw: string) => raw.trim() || null;
