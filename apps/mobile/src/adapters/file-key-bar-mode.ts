import { File, Paths } from "expo-file-system";
import type { KeyBarModeStore } from "../core/key-bar-visibility";
import { readDurableSync, writeDurable } from "./durable-file";

const file = () => new File(Paths.document, "terminal-key-bar.json");
/** Only how the terminal key bar shows (always, auto-hide, one tap); no user data. */
export const fileKeyBarMode: KeyBarModeStore = {
 read: () => readDurableSync(file(), text => text),
 write: text => writeDurable(file(), text),
};
