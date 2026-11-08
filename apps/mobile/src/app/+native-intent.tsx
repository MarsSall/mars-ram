import { allowedSystemPath } from "../core/link-policy";
import { decodeNotificationLink, notificationDestination } from "../core/notification-routing";

export function redirectSystemPath({ path, initial: _initial }: { path: string; initial: boolean }): string | Promise<string> {
	const target = decodeNotificationLink(path);
	if (!target) return allowedSystemPath(path);
	return notificationDestination(path, async () => {
		// Lazy wiring: malformed/unknown system links cannot trigger SSH or key prompts.
		const { catalog, sessions } = await import("../services");
		if (!(await catalog.list()).some(h => h.id === target.hostId)) return [];
		return (await sessions.list()).computers.flatMap(c => c.sessions);
	});
}
