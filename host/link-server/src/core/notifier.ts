import type { SessionNotice } from '../../../../packages/protocol/src/session-notice.ts';
export class NoticeRules {
 private sessions = new Map<string, { seq: number; version: string }>();
 snapshot(id: string, seq: number, version: string): void {
  const old = this.sessions.get(id);
  this.sessions.set(id, { seq: Math.max(seq, old?.seq ?? 0), version });
 }
 remove(id: string): void { this.sessions.delete(id); }
 event(id: string, seq: number, type: string, outcome?: string, aborted = false): SessionNotice['kind'] | null {
  const session = this.sessions.get(id);
  if (!session || !Number.isSafeInteger(seq) || seq <= session.seq) return null;
  session.seq = seq;
  if (type === 'prompt_start') return 'needs-answer';
  if (type !== 'agent_settled' || aborted || outcome === 'aborted') return null;
  if (outcome === 'failed') return 'failed';
  if (outcome === 'completed') return 'finished';
  const version = /^(\d+)\.(\d+)$/.exec(session.version);
  return outcome === undefined && version && Number(version[1]) === 1 && Number(version[2]) < 6 ? 'finished' : null;
 }
}
export interface NoticeDelivery {
 send(line: string, timeoutMs: number): Promise<void>;
 sleep(ms: number): Promise<void>;
}
/** Caller admits bounded in-flight work; persistent failures are dropped, never queued. */
export async function deliverNotice(line: string, ports: NoticeDelivery): Promise<boolean> {
 for (let attempt = 0; attempt < 3; attempt++) {
  try { await ports.send(line, 2000); return true; }
  catch { if (attempt < 2) await ports.sleep(250 * (attempt + 1)); }
 }
 return false;
}
