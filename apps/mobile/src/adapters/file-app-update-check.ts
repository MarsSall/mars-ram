import { File, Paths } from "expo-file-system";
import { parseAppUpdateEntry, type AppUpdateCheckStore } from "../core/app-updates";
import { readDurable, writeDurable } from "./durable-file";

const file = () => new File(Paths.document, "app-update-check.json");
/** Only the last Play check time and its answer; no user data. */
export const fileAppUpdateCheck: AppUpdateCheckStore = {
 read: () => readDurable(file(), parseAppUpdateEntry),
 write: async entry => { await writeDurable(file(), JSON.stringify(entry)); },
};
