import { File, Paths } from "expo-file-system";
import type { TerminalKeysStore } from "../core/terminal-keys";
import { readDurableSync, writeDurable } from "./durable-file";

const file = () => new File(Paths.document, "terminal-keys.json");
/** The chosen bar, D-pad and custom buttons (their text may be a command; never a credential, S5 warns). */
export const fileTerminalKeys: TerminalKeysStore = {
 read: () => readDurableSync(file(), text => text),
 write: text => writeDurable(file(), text),
};
