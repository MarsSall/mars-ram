// HostCatalog adapter: a JSON file in the app's private documents directory.
import { File, Paths } from "expo-file-system";
import { type HostCatalog, parseSavedHosts, type SavedHost, serializeSavedHosts } from "../core/host-catalog";
import { CredentialMetadataDamaged } from "../core/credential-metadata";
import { hasDurable, readDurable, writeDurable } from "./durable-file";

const file = () => new File(Paths.document, "hosts.json");
let queue: Promise<unknown> = Promise.resolve();
const serialized = <T>(task: () => Promise<T>): Promise<T> => {
 const next = queue.then(task, task);
 queue = next.catch(() => undefined);
 return next;
};
function parse(text: string): SavedHost[] {
 const data: unknown = JSON.parse(text);
 if (!data || typeof data !== "object" || !("version" in data) || ![1, 2].includes(data.version as number)
  || !("hosts" in data) || !Array.isArray(data.hosts)) throw new Error();
 const parsed = parseSavedHosts(text);
 if (parsed.dropped > 0 || new Set(parsed.hosts.map(h => h.id)).size !== parsed.hosts.length) throw new Error();
 return parsed.hosts;
}
async function read(): Promise<SavedHost[]> {
 try {
  const hosts = await readDurable(file(), parse, true);
  if (hosts !== null) return hosts;
  if (hasDurable(new File(Paths.document, "key-security.json"))) throw new Error();
  // Establish an explicit empty catalog BEFORE the first credential generation is
  // persisted, so later missing catalogs can never mean "no dependents".
  await write([]);
  return [];
 } catch { throw new CredentialMetadataDamaged("Host catalog could not be read."); }
}
async function write(hosts: SavedHost[]): Promise<void> {
 await writeDurable(file(), serializeSavedHosts(hosts));
}
export const fileHostCatalog: HostCatalog = {
 list: () => serialized(read),
 save: host => serialized(async () => {
  const hosts = (await read()).filter(h => h.id !== host.id);
  await write([...hosts, host]);
 }),
 remove: id => serialized(async () => write((await read()).filter(h => h.id !== id))),
};
