import { APP_ID } from '@workspace/protocol';
import { compareSemver } from '../core/host-update';
import type { HostReleaseRegistry } from '../core/host-updates';
const MAX_METADATA = 65_536;
/** Public metadata only: fixed URL, no credentials, host identifiers, telemetry or request body. */
export function createNpmHostRelease(fetcher: typeof fetch = fetch): HostReleaseRegistry {
 return { latest: async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
   const response = await fetcher(`https://registry.npmjs.org/${APP_ID}/latest`, {
    method: 'GET', credentials: 'omit', redirect: 'error', headers: { accept: 'application/json' }, signal: controller.signal,
   });
   if (!response.ok || Number(response.headers.get('content-length')) > MAX_METADATA) return undefined;
   // RN fetch has no streaming reader: reject oversized metadata before parsing it.
   const text = await response.text();
   if (text.length > MAX_METADATA) return undefined;
   const value = JSON.parse(text);
   return value?.name === APP_ID && typeof value.version === 'string' && compareSemver(value.version, value.version) === 0 ? value.version : undefined;
  } catch { return undefined; } finally { clearTimeout(timer); }
 } };
}
