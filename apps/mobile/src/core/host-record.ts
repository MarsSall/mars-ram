import { APP_ID } from "@workspace/protocol";
import type { HostConnection } from "./ports";

/** Shared bounded installer record reader. Missing, unreadable and malformed records are absent. */
export async function readHostRecord(host: Pick<HostConnection, "readFile">, connectionId: string): Promise<Record<string, unknown> | null> {
 try {
  const result = await host.readFile(connectionId, `.${APP_ID}/host.json`, 4096);
  if (!result.ok) return null;
  const value: unknown = JSON.parse(result.content);
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
 } catch { return null; }
}
