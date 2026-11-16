import { File, Paths } from "expo-file-system";
import { parseTourFlags, type TourFlagsStore } from "../core/tour";
import { readDurable, writeDurable } from "./durable-file";

const file = () => new File(Paths.document, "tour-flags.json");

/** Only whether the tour and each first-visit tip were seen; no user data. */
export const fileTourFlags: TourFlagsStore = {
 read: async () => {
  try {
   const flags = await readDurable(file(), parseTourFlags);
   return flags ? { kind: "saved", flags } : { kind: "none" };
  } catch { return { kind: "damaged" }; }
 },
 write: async flags => { await writeDurable(file(), JSON.stringify({ version: 1, tourSeen: flags.tourSeen, tips: flags.tips })); },
};
