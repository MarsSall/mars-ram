import { File, Paths } from "expo-file-system";
import type { SecretFilesStore } from "../core/secret-files";
import { readDurableSync, writeDurable } from "./durable-file";

const file = () => new File(Paths.document, "hide-secret-files.json");
/** Only the "hide secret files" switch; no user data. */
export const fileSecretFiles: SecretFilesStore = {
 read: () => readDurableSync(file(), text => text),
 write: text => writeDurable(file(), text),
};
