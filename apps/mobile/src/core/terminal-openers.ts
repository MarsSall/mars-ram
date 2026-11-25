// What «Abrir terminal» can open on a computer. New openers are data here, not screen code.
import type { SavedHost } from "./host-catalog";
import type { HostConnections } from "./host-connections";
import { readHostRecord } from "./host-record";
import { validHerdrPath } from "./herdr-terminal";
import type { HostConnection } from "./ports";

export type OpenerId = "herdr" | "shell";
export type OpenerAvailability = { available: true } | { available: false; reason: "herdrMissing" };
/** What the phone knows about the computer: the installer's host record, or null when unreadable. */
export type OpenerFacts = { record: Record<string, unknown> | null };
export type TerminalOpener = {
 id: OpenerId;
 check(facts: OpenerFacts): OpenerAvailability;
 /** Params for TERMINAL_ROUTE. */
 params(computer: Pick<SavedHost, "id" | "name">): Record<string, string> & { id: string };
};

export const TERMINAL_ROUTE = "/session/terminal/[id]";
const available: OpenerAvailability = { available: true };

export const terminalOpeners: readonly TerminalOpener[] = [
 {
  id: "herdr",
  // The installer records Herdr's path when it finds it. A record without it means not installed;
  // no record is unknown, and the terminal reports a missing Herdr exactly like «Abrir Herdr».
  check: ({ record }) => record && typeof record.node === "string" && !validHerdrPath(record.herdr) ? { available: false, reason: "herdrMissing" } : available,
  params: computer => ({ id: computer.id, standalone: "1", computer: computer.name }),
 },
 {
  id: "shell",
  // Every SSH server has a login shell; it starts in the user's home folder.
  check: () => available,
  params: computer => ({ id: computer.id, standalone: "1", computer: computer.name, shell: "1" }),
 },
];

/** Like «Agregar atajo»: one saved computer skips the computer choice. */
export const openerInitialStep = (computers: number): "computer" | "opener" => computers === 1 ? "opener" : "computer";

export type OpenerChoice = { id: OpenerId; availability: OpenerAvailability };
export type OpenerCheck = { ok: true; openers: OpenerChoice[] } | { ok: false; code: string };

export class TerminalOpenerHost {
 constructor(private readonly deps: { host: Pick<HostConnection, "readFile">; connections: Pick<HostConnections, "connection"> }) {}
 /** Connects once, reads the bounded host record and checks every opener. Never installs anything. */
 async check(computer: SavedHost): Promise<OpenerCheck> {
  try {
   const connection = await this.deps.connections.connection(computer);
   if (!connection.ok) return { ok: false, code: connection.code };
   const facts = { record: await readHostRecord(this.deps.host, connection.connectionId) };
   return { ok: true, openers: terminalOpeners.map(opener => ({ id: opener.id, availability: opener.check(facts) })) };
  } catch { return { ok: false, code: "FAILED" }; }
 }
}
