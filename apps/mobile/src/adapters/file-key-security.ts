// Credentials metadata, never private keys. Kept in the app's private documents directory.
import { File, Paths } from "expo-file-system";
import { isKeySecurityState, type KeySecurityStore } from "../core/key-security";
import { CredentialMetadataDamaged } from "../core/credential-metadata";
import { readDurable, writeDurable } from "./durable-file";
const file = () => new File(Paths.document, "key-security.json");
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
 const next = queue.then(task, task);
 queue = next.catch(() => undefined);
 return next;
}
export const fileKeySecurity: KeySecurityStore = {
 read: () => serialized(async () => {
  try {
   return await readDurable(file(), text => {
    const value: unknown = JSON.parse(text);
    if (!isKeySecurityState(value)) throw new Error();
    return value;
   }, true);
  } catch { throw new CredentialMetadataDamaged("Key security metadata could not be read."); }
 }),
 write: state => serialized(async () => {
  try {
   if (!isKeySecurityState(state)) throw new Error();
   await writeDurable(file(), JSON.stringify(state));
  } catch { throw new Error("Key security metadata could not be saved."); }
 }),
};
