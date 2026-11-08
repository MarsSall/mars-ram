type NoticeTarget = { hostId: string; bridgeInstanceId: string };
function decode(value: string): string | null {
 if (!value || value.length > 16384 || value.length % 4 || !/^[0-9a-f]+$/.test(value)) return null;
 let result = ""; for (let i = 0; i < value.length; i += 4) result += String.fromCharCode(Number.parseInt(value.slice(i, i + 4), 16));
 return result;
}
/** Raw, exact allowlist: do not URL-normalize, decode twice, or accept extra query fields. */
export function decodeNotificationLink(path: string): NoticeTarget | null {
 const match = /^(?:mars-ram|mars-ram-preview):\/\/notice\?h=([0-9a-f]+)&b=([0-9a-f]+)&encoding=utf16-hex$/.exec(path);
 if (!match) return null;
 const hostId = decode(match[1]), bridgeInstanceId = decode(match[2]);
 return hostId !== null && bridgeInstanceId !== null ? { hostId, bridgeInstanceId } : null;
}
export async function notificationDestination(path: string, live: () => Promise<(NoticeTarget & { key: string })[]>): Promise<string> {
 const target = decodeNotificationLink(path); if (!target) return "/";
 try {
  const session = (await live()).find(s => s.hostId === target.hostId && s.bridgeInstanceId === target.bridgeInstanceId);
  // Unrepresentable URI strings (e.g. lone surrogates) also land safely on Inicio.
  return session ? `/session/open/${encodeURIComponent(session.key)}` : "/";
 } catch { return "/"; }
}
