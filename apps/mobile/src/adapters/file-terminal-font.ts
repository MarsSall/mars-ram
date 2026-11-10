import { File, Paths } from "expo-file-system";
import type { TerminalFontStore } from "../core/terminal-font";
import { readDurableSync, writeDurable } from "./durable-file";

const file = () => new File(Paths.document, "terminal-font-size.json");
/** Only the chosen terminal font size; no user data. */
export const fileTerminalFont: TerminalFontStore = {
 read: () => readDurableSync(file(), text => text),
 write: text => writeDurable(file(), text),
};
