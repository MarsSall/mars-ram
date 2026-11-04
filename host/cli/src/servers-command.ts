import { createServersPorts } from './adapters/servers.ts';
import { runServers, serversFailure, type ServersPorts, type ServersResult } from './core/servers.ts';

type Output = { write(chunk: string, done: (error?: Error | null) => void): unknown };
/** Deadline includes discovery and probes. Then wait for the SSH pipe to accept the
 * one versioned JSON line, so a slow reader never gets cut JSON; a reader that never
 * drains it within outputMs gets exit 1 instead of a process that lingers. */
export async function serversCommand(args: string[], out: Output = process.stdout, ports: ServersPorts = createServersPorts(), outputMs = 5000): Promise<number> {
 const controller = new AbortController();
 const stopProbes = setTimeout(() => controller.abort(), 3500);
 let deadline: ReturnType<typeof setTimeout> | undefined;
 let result: ServersResult;
 try {
  result = await Promise.race([
   runServers(args, ports, controller.signal),
   new Promise<ServersResult>(resolve => { deadline = setTimeout(() => { controller.abort(); resolve(serversFailure()); }, 3750); }),
  ]);
 } finally { clearTimeout(stopProbes); clearTimeout(deadline); }
 let outputTimer: ReturnType<typeof setTimeout> | undefined;
 const accepted = await Promise.race([
  new Promise<boolean>((resolve, reject) => { out.write(`${JSON.stringify(result)}\n`, error => error ? reject(error) : resolve(true)); }),
  new Promise<boolean>(resolve => { outputTimer = setTimeout(() => resolve(false), outputMs); }),
 ]).finally(() => clearTimeout(outputTimer));
 return !accepted || 'ok' in result ? 1 : 0;
}
