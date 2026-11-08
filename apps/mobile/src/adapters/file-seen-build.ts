import { File, Paths } from "expo-file-system";
import { parseSeenBuild, type SeenBuildStore } from "../core/whats-new";
import { readDurable, writeDurable } from "./durable-file";

const file = () => new File(Paths.document, "seen-build.json");
// Any of these means the app was used before «Novedades» existed: an update, not a fresh install.
const earlierData = ["hosts.json", "theme-preference.json", "attachment-retention.json", "notification-mode.json", "shortcuts.json"];

/** Only the last build whose notes were seen; no user data. */
export const fileSeenBuild: SeenBuildStore = {
 read: async () => {
  const seen = await readDurable(file(), parseSeenBuild);
  if (seen) return { kind: "seen", ...seen };
  return earlierData.some(name => new File(Paths.document, name).exists) ? { kind: "unrecorded" } : { kind: "fresh" };
 },
 write: async seen => { await writeDurable(file(), JSON.stringify({ version: 1, build: seen.build, appVersion: seen.version })); },
};
