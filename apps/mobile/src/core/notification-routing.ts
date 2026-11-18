export type NoticeTarget = { hostId: string; bridgeInstanceId: string };
function decode(value: string): string | null {
 if (!value || value.length > 16384 || value.length % 4 || !/^[0-9a-f]+$/.test(value)) return null;
 let result = ""; for (let i = 0; i < value.length; i += 4) result += String.fromCharCode(Number.parseInt(value.slice(i, i + 4), 16));
 return result;
}
/**
 * Raw, exact allowlist: do not URL-normalize, decode twice, or accept extra query fields. The optional
 * last `t` is the install's own-notification tap mark (exactly 64 lowercase hex, see NoticeTapTokens.kt);
 * it is never shown, logged or put in a route.
 */
const NOTICE = /^(?:mars-ram|mars-ram-preview):\/\/notice\?h=([0-9a-f]+)&b=([0-9a-f]+)&encoding=utf16-hex(?:&t=([0-9a-f]{64}))?$/;
export function decodeNotificationLink(path: string): NoticeTarget | null {
 const match = NOTICE.exec(path);
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

/** Any app can synthesize a notice link (release-0.1.8 S5); only the app's own taps carry a mark the native module accepts (L6). */
export const LINK_TERMINAL_ROUTE = "/link-terminal";
export type NoticeLinkPorts = {
 savedHosts: () => Promise<{ id: string }[]>;
 /** Native constant-time check of the tap mark; only `true` counts. */
 acceptsOwnTap: (mark: string) => Promise<unknown>;
 live: () => Promise<(NoticeTarget & { key: string })[]>;
};
/** An accepted own-notification tap opens as before the confirmation existed; anything else asks first. */
export async function noticeLinkPath(path: string, ports: NoticeLinkPorts): Promise<string> {
 const target = decodeNotificationLink(path), mark = NOTICE.exec(path)?.[3];
 if (!target) return "/";
 let own = false;
 if (mark) { try { own = (await ports.acceptsOwnTap(mark)) === true; } catch { own = false; } }
 if (!own) return linkConfirmationPath(path, ports.savedHosts);
 return notificationDestination(path, async () => {
  // Unknown/removed computers are rejected before discovery, as before.
  if (!(await ports.savedHosts()).some(h => h.id === target.hostId)) return [];
  return ports.live();
 });
}
/** A notice link only reaches a confirmation: the local saved-computer list is read, nothing is sent to a computer. */
export async function linkConfirmationPath(path: string, savedHosts: () => Promise<{ id: string }[]>): Promise<string> {
 const match = NOTICE.exec(path), target = decodeNotificationLink(path);
 if (!match || !target) return "/";
 try { if (!(await savedHosts()).some(h => h.id === target.hostId)) return "/"; } catch { return "/"; }
 return `${LINK_TERMINAL_ROUTE}?h=${match[1]}&b=${match[2]}`;
}
/** The confirmation route accepts exactly the hex fields it was given, through the same strict decoder. */
export function readLinkTerminalParams(h: unknown, b: unknown): NoticeTarget | null {
 if (typeof h !== "string" || typeof b !== "string" || !/^[0-9a-f]+$/.test(h) || !/^[0-9a-f]+$/.test(b)) return null;
 return decodeNotificationLink(`mars-ram://notice?h=${h}&b=${b}&encoding=utf16-hex`);
}
/**
 * Leaving the confirmation always lands on Inicio, never back to the previous screen (L14): going back
 * would refocus a plain shell underneath, whose blur already closed its channel, and open a fresh PTY.
 * One POP_TO removes the stacked screens without focusing them, or opens Inicio when it is not in the stack.
 */
export function leaveToInicio(router: { dismissTo: (href: "/") => void }): void { router.dismissTo("/"); }
export type LinkTerminalEffects = { live: () => Promise<(NoticeTarget & { key: string })[]>; open: (key: string) => void; home: () => void };
/** Only «Abrir» reaches the computer (discovery, then the ordinary terminal-first open); «Cancelar» only goes to Inicio. */
export async function answerLinkTerminal(answer: "open" | "cancel", target: NoticeTarget, effects: LinkTerminalEffects): Promise<"opened" | "gone" | "cancelled"> {
 if (answer === "cancel") { effects.home(); return "cancelled"; }
 try {
  const found = (await effects.live()).find(s => s.hostId === target.hostId && s.bridgeInstanceId === target.bridgeInstanceId);
  if (!found) return "gone";
  const { key } = found;
  effects.open(key); return "opened";
 } catch { return "gone"; }
}
