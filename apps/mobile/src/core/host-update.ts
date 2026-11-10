// R1/R2: release compatibility is independent of the bridge's protocol version.
import { APP_ID } from '@workspace/protocol';
import { hostCliPrefix } from './herdr-switcher';

/** 0.1.5: attachments need `uploads-dir`, ZeroTier needs `pair-zt`. Bump only when the app requires newer host capabilities. */
export const MINIMUM_HOST_VERSION = '0.1.5';
export type HostRelease = string; // semver | missing (legacy CLI) | dev | unknown (no evidence)
export type HostUpdateStatus = 'ok' | 'soft' | 'required';
function semver(value: unknown): { numbers: number[]; pre: string[] } | null {
 if (typeof value !== 'string' || value.length > 128) return null;
 const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
 if (!match) return null;
 const numbers = match.slice(1, 4).map(Number), pre = match[4]?.split('.') ?? [];
 if (numbers.some(n => !Number.isSafeInteger(n)) || pre.some(p => /^\d+$/.test(p) && p.length > 1 && p.startsWith('0'))) return null;
 return { numbers, pre };
}
export function compareSemver(a: string, b: string): -1 | 0 | 1 | null {
 const left = semver(a), right = semver(b);
 if (!left || !right) return null;
 for (let i = 0; i < 3; i++) if (left.numbers[i] !== right.numbers[i]) return left.numbers[i]! < right.numbers[i]! ? -1 : 1;
 if (!left.pre.length || !right.pre.length) return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1;
 for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
  const a = left.pre[i], b = right.pre[i];
  if (a === b) continue;
  if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
  const an = /^\d+$/.test(a), bn = /^\d+$/.test(b);
  if (an !== bn) return an ? -1 : 1;
  if (an && a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a < b ? -1 : 1;
 }
 return 0;
}
export function parseHostVersion(text: string): HostRelease {
 if (text.length > 1024) return 'unknown';
 try {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown';
  const v = value as Record<string, unknown>;
  return v.version === 1 && (v.release === 'dev' || semver(v.release)) ? v.release as string : 'unknown';
 } catch { return 'unknown'; }
}
export function hostUpdateStatus(release: unknown, minimum: string, latest?: string): HostUpdateStatus {
 if (release === 'dev' || typeof release !== 'string' || !semver(minimum)) return 'ok';
 // `missing` = no `version --json`, which first shipped in 0.1.4: such a host is at most 0.1.3.
 if (release === 'missing') return (compareSemver(minimum, '0.1.4') ?? -1) >= 0 ? 'required' : 'ok';
 if (!semver(release)) return 'ok';
 if (compareSemver(release, minimum) === -1) return 'required';
 return latest && compareSemver(release, latest) === -1 ? 'soft' : 'ok';
}
export function buildVersionCommand(record: unknown): string { return `${hostCliPrefix(record)} version --json`; }
export function updateCommand(target: string): string {
 if (!semver(target)) throw Error('Invalid update release');
 return `pnpm add -g ${APP_ID}@${target}\n${APP_ID} install`;
}
export function needsBridgeReload(version: string, app: string): boolean {
 const pattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
 const host = pattern.exec(version), phone = pattern.exec(app);
 return !!host && !!phone && host[1] === phone[1] && Number(host[2]) < Number(phone[2]);
}
export type HostUpdate = { release: HostRelease; status: HostUpdateStatus; target?: string };
export function hostUpdate(release: HostRelease, latest?: string): HostUpdate {
 const status = hostUpdateStatus(release, MINIMUM_HOST_VERSION, latest);
 return { release, status, ...(status === 'ok' ? {} : { target: status === 'soft' ? latest! : MINIMUM_HOST_VERSION }) };
}
