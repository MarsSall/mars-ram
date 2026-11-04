import { removeEntry } from "./registry.ts";

export type RunningInstance = { entryPath: string; server: { close(): Promise<void> } };

/** Removes the registry entry and always closes the server, even if removal fails. */
export async function stopInstance(instance: RunningInstance, remove: (path: string) => void = removeEntry): Promise<void> {
	try {
		remove(instance.entryPath);
	} finally {
		await instance.server.close();
	}
}
