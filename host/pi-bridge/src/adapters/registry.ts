// Publishes how to reach a running bridge, so a client connected over SSH
// can find it by reading the registry directory.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeRegistryEntry, type RegistryEntry } from "@workspace/protocol";
import type { FilePermissions } from "./file-permissions.ts";

const INSTANCE_ID = /^[A-Za-z0-9-]+$/;
const TEMPORARY = /\.json\.(\d+)\.tmp$/;

export function publishEntry(dir: string, entry: RegistryEntry, permissions: FilePermissions): string {
	if (!INSTANCE_ID.test(entry.bridgeInstanceId)) throw new Error(`Invalid bridge instance id "${entry.bridgeInstanceId}".`);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	permissions.restrictDirectory(dir);
	const path = join(dir, `${entry.bridgeInstanceId}.json`);
	const temporary = `${path}.${process.pid}.tmp`;
	// Restrict the file before it holds the token, then move it into place.
	// On any failure, remove the temporary file so no token is left behind.
	writeFileSync(temporary, "", { mode: 0o600, flag: "wx" });
	try {
		permissions.restrictFile(temporary);
		writeFileSync(temporary, JSON.stringify(entry));
		renameSync(temporary, path);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
	return path;
}

export function removeEntry(path: string): void {
	rmSync(path, { force: true });
}

/** Removes entries and temporary files left behind by bridges whose process no longer runs. */
export function pruneStaleEntries(dir: string, isAlive: (pid: number) => boolean = processIsAlive): void {
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return;
	}
	for (const name of names) {
		const temporary = TEMPORARY.exec(name);
		if (temporary && !isAlive(Number(temporary[1]))) removeEntry(join(dir, name));
	}
	for (const name of names.filter((n) => n.endsWith(".json"))) {
		const path = join(dir, name);
		try {
			const decoded = decodeRegistryEntry(JSON.parse(readFileSync(path, "utf8")));
			if (decoded.ok && !isAlive(decoded.value.pid)) removeEntry(path);
		} catch {
			// Unreadable or not ours: leave it alone.
		}
	}
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}
