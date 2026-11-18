import { allowedSystemPath } from "../core/link-policy";
import { decodeNotificationLink, noticeLinkPath } from "../core/notification-routing";

export function redirectSystemPath({ path, initial: _initial }: { path: string; initial: boolean }): string | Promise<string> {
	if (!decodeNotificationLink(path)) return allowedSystemPath(path);
	// Lazy wiring: malformed/unknown system links cannot trigger SSH or key prompts. A notice link from
	// outside the app only reads the saved-computer list and stops at «¿Abrir la terminal?»; the app's
	// own notification tap (a mark the native module accepts) opens the session directly.
	const services = () => import("../services");
	return noticeLinkPath(path, {
		savedHosts: async () => (await services()).catalog.list(),
		acceptsOwnTap: async mark => (await services()).noticeTaps.accepts(mark),
		live: async () => (await (await services()).sessions.list()).computers.flatMap(c => c.sessions),
	});
}
