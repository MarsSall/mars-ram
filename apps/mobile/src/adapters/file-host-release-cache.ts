import { File, Paths } from 'expo-file-system';
import { parseReleaseCache, type HostReleaseCache } from '../core/host-updates';
import { readDurable, writeDurable } from './durable-file';
const file = () => new File(Paths.document, 'host-release-cache.json');
/** Only public release metadata and its last attempt time; never any saved host data. */
export const fileHostReleaseCache: HostReleaseCache = {
 read: async () => await readDurable(file(), parseReleaseCache, true) ?? undefined,
 write: async entry => { await writeDurable(file(), JSON.stringify({ version: 1, ...entry })); },
};
