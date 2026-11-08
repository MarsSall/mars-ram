// Dependency-free projection for the standalone host notifier. Shares the registry contract
// with index.ts; intentionally projects no agent content and ignores additive fields.
export type NoticeBridge = { protocolVersion: string; bridgeInstanceId: string; sessionId: string; port: number; token: string; pid: number; cwd: string; startedAt: number };
export const compatibleNoticeBridge = (version: unknown): version is string => typeof version === 'string' && /^(\d+)\.\d+$/.test(version) && Number(version.split('.')[0]) === 1;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
export function noticeBridge(value: unknown): NoticeBridge | null {
 if (!record(value) || !compatibleNoticeBridge(value.protocolVersion) || typeof value.bridgeInstanceId !== 'string' || !value.bridgeInstanceId || typeof value.sessionId !== 'string' || !value.sessionId
  || !integer(value.port, 1, 65535) || !(typeof value.pid === 'number' && Number.isInteger(value.pid) && value.pid >= 1) || typeof value.token !== 'string' || [...value.token].length < 32 || typeof value.cwd !== 'string' || typeof value.startedAt !== 'number' || !Number.isFinite(value.startedAt)) return null;
 return value as NoticeBridge;
}
export function noticeEnvelope(value: unknown, bridge: NoticeBridge): value is Record<string, unknown> {
 return record(value) && compatibleNoticeBridge(value.protocolVersion) && value.bridgeInstanceId === bridge.bridgeInstanceId && value.sessionId === bridge.sessionId;
}
export function noticeSnapshot(value: unknown, bridge: NoticeBridge): number | null {
 if (!noticeEnvelope(value, bridge) || !integer(value.lastSeq, 0) || typeof value.idle !== 'boolean' || !(value.pendingPrompt === null || record(value.pendingPrompt))) return null;
 return value.lastSeq;
}
export type NoticeEvent = { seq: number; type: string; outcome?: string; aborted?: boolean };
export function noticeEvent(value: unknown): NoticeEvent | null {
 if (!record(value) || !integer(value.seq, 0) || typeof value.type !== 'string') return null;
 if (value.type === 'agent_settled' && (typeof value.aborted !== 'boolean' || typeof value.pendingMessages !== 'boolean' || (value.outcome !== undefined && typeof value.outcome !== 'string'))) return null;
 return { seq: value.seq, type: value.type, ...(typeof value.outcome === 'string' ? { outcome: value.outcome } : {}), ...(typeof value.aborted === 'boolean' ? { aborted: value.aborted } : {}) };
}
